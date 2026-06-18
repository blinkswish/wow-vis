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

interface RawEvent { abilityGameID?: number; amount?: number; targetID?: number; }

async function main() {
  const code = process.argv[2];
  const fightId = Number(process.argv[3] ?? "1");
  if (!code) throw new Error("usage: npx tsx scripts/list-abilities.ts <reportCode> [fightId]");
  const token = await getAccessToken(process.env.WCL_CLIENT_ID!, process.env.WCL_CLIENT_SECRET!);

  // 1) ability names + the fight window + player roster
  const meta = await gql<{ reportData: { report: {
    masterData: { abilities: { gameID: number; name: string; type: string }[]; actors: { id: number; name: string; type: string }[] };
    fights: { id: number; startTime: number; endTime: number }[];
  } } }>(token, `
    query($code:String!){ reportData{ report(code:$code){
      masterData{ abilities{ gameID name type } actors(type:"Player"){ id name type } }
      fights{ id startTime endTime }
    }}}`, { code });

  const names = new Map(meta.reportData.report.masterData.abilities.map((a) => [a.gameID, a.name]));
  const playerIds = new Set(meta.reportData.report.masterData.actors.map((a) => a.id));
  const fight = meta.reportData.report.fights.find((f) => f.id === fightId)!;

  // 2) page all DamageTaken events for the fight, tally per ability (players only)
  const tally = new Map<number, { hits: number; dmg: number }>();
  let start = fight.startTime;
  let pages = 0;
  while (pages < 12) {
    const d = await gql<{ reportData: { report: { events: { data: RawEvent[]; nextPageTimestamp: number | null } } } }>(token, `
      query($code:String!,$s:Float!,$e:Float!){ reportData{ report(code:$code){
        events(startTime:$s,endTime:$e,dataType:DamageTaken,limit:10000){ data nextPageTimestamp } }}}`,
      { code, s: start, e: fight.endTime });
    const page = d.reportData.report.events;
    for (const ev of page.data) {
      if (ev.abilityGameID == null) continue;
      if (ev.targetID == null || !playerIds.has(ev.targetID)) continue; // damage taken by players only
      const t = tally.get(ev.abilityGameID) ?? { hits: 0, dmg: 0 };
      t.hits += 1; t.dmg += ev.amount ?? 0;
      tally.set(ev.abilityGameID, t);
    }
    pages += 1;
    if (page.nextPageTimestamp == null) break;
    start = page.nextPageTimestamp;
  }

  const rows = [...tally.entries()]
    .map(([id, t]) => ({ id, name: names.get(id) ?? `#${id}`, ...t }))
    .sort((a, b) => b.dmg - a.dmg)
    .slice(0, 25);

  console.log(`fight ${fightId} damage-taken by players — top abilities (${pages} pages scanned):`);
  console.log("  abilityID  | hits | total dmg | name");
  for (const r of rows) {
    console.log(`  ${String(r.id).padStart(9)} | ${String(r.hits).padStart(4)} | ${String(Math.round(r.dmg)).padStart(9)} | ${r.name}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
