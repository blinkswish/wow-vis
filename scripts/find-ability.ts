import "dotenv/config";
import { getAccessToken } from "./wcl-client";

const GQL = "https://www.warcraftlogs.com/api/v2/client";

async function gql(token: string, q: string, v: Record<string, unknown>) {
  const r = await fetch(GQL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables: v }) });
  const j = (await r.json()) as { data?: any; errors?: unknown[] };
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function main() {
  const code = process.argv[2];
  const needle = (process.argv[3] ?? "").toLowerCase();
  if (!code) throw new Error("usage: npx tsx scripts/find-ability.ts <reportCode> [nameSubstring]");
  const token = await getAccessToken(process.env.WCL_CLIENT_ID!, process.env.WCL_CLIENT_SECRET!);
  const data = await gql(token, `query($c:String!){reportData{report(code:$c){masterData{abilities{gameID name type}}}}}`, { c: code });
  const abilities = (data.reportData.report.masterData.abilities ?? []) as { gameID: number; name: string }[];
  const hits = abilities.filter((a) => a.name && (!needle || a.name.toLowerCase().includes(needle)));
  console.log(`${hits.length} ability match(es) for "${needle}":`);
  for (const a of hits.sort((x, y) => x.name.localeCompare(y.name))) console.log(`  ${String(a.gameID).padStart(8)}  ${a.name}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
