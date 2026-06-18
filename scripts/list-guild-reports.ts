import "dotenv/config";
import { getAccessToken } from "./wcl-client";

const GQL_URL = "https://www.warcraftlogs.com/api/v2/client";

async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

interface Report {
  code: string;
  title: string;
  startTime: number;
  zone: { id: number; name: string } | null;
  fights: { id: number; kill: boolean | null }[];
}

const Q = `
query($name:String!,$slug:String!,$region:String!,$enc:Int!,$page:Int!){
  reportData{
    reports(guildName:$name, guildServerSlug:$slug, guildServerRegion:$region, limit:25, page:$page){
      total
      has_more_pages
      data{ code title startTime zone{ id name } fights(encounterID:$enc){ id kill } }
    }
  }
}`;

async function main() {
  const [name, slug, region = "US", encArg] = process.argv.slice(2);
  if (!name || !slug || !encArg) {
    throw new Error('usage: npx tsx scripts/list-guild-reports.ts "<Guild>" <serverSlug> <region> <encounterID>');
  }
  const enc = Number(encArg);
  const token = await getAccessToken(process.env.WCL_CLIENT_ID!, process.env.WCL_CLIENT_SECRET!);

  console.log(`guild="${name}" server=${slug}-${region}  encounter=${enc}`);
  const hits: { code: string; title: string; startTime: number; pulls: number; kills: number }[] = [];
  let page = 1, totalReports = 0;
  while (page <= 8) {
    const d = await gql<{ reportData: { reports: { total: number; has_more_pages: boolean; data: Report[] } } }>(
      token, Q, { name, slug, region, enc, page });
    const r = d.reportData.reports;
    totalReports = r.total;
    for (const rep of r.data) {
      if (rep.fights.length > 0) {
        hits.push({ code: rep.code, title: rep.title, startTime: rep.startTime,
          pulls: rep.fights.length, kills: rep.fights.filter((f) => f.kill === true).length });
      }
    }
    if (!r.has_more_pages) break;
    page += 1;
  }

  hits.sort((a, b) => a.startTime - b.startTime);
  console.log(`scanned ${page} page(s), ${totalReports} total guild reports`);
  console.log(`reports containing encounter ${enc}: ${hits.length}`);
  let totalPulls = 0;
  for (const h of hits) {
    totalPulls += h.pulls;
    const date = new Date(h.startTime).toISOString().slice(0, 10);
    console.log(`  ${h.code.padEnd(18)} | ${date} | ${String(h.pulls).padStart(3)} pulls | ${h.kills} kill | ${h.title}`);
  }
  console.log(`TOTAL Midnight Falls pulls across all reports: ${totalPulls}`);
  console.log(`reportCodes JSON: ${JSON.stringify(hits.map((h) => h.code))}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
