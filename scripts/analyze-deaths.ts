import { loadBossConfig } from "./config";
import { loadReportCache } from "./cache";
import { eventsKey } from "./cache";

async function main() {
  const config = await loadBossConfig("config/bosses/midnight.json");
  const codes = config.reportCodes ?? [config.reportCode];
  const N = config.voidAfterDeaths ?? Infinity;

  const raw: Record<string, number> = {};       // every death, no cutoff
  const capped: Record<string, number> = {};    // first N deaths per pull (by order)
  const tsThreshold: Record<string, number> = {}; // current logic: timestamp <= 2nd death ts
  let pulls = 0, leakyPulls = 0;

  for (const code of codes) {
    const cache = await loadReportCache(code);
    if (!cache) { console.log(`(no cache for ${code})`); continue; }
    const players = new Map(cache.players);
    const matching = cache.fights.filter((f) =>
      f.encounterID === config.encounterID && (config.difficulty == null || f.difficulty === config.difficulty));

    for (const f of matching) {
      pulls++;
      const deaths = (cache.events[eventsKey(f.id, "death", [])] ?? [])
        .filter((e) => e.timestamp != null)
        .sort((a, b) => a.timestamp - b.timestamp);
      const cutoffTs = deaths.length >= N ? deaths[N - 1].timestamp : Infinity;
      const tsFreq = new Map<number, number>();
      for (const e of deaths) tsFreq.set(e.timestamp, (tsFreq.get(e.timestamp) ?? 0) + 1);

      let order = 0, ts = 0;
      for (const e of deaths) {
        const name = e.targetID != null ? players.get(e.targetID) : undefined;
        if (!name) continue;
        raw[name] = (raw[name] ?? 0) + 1;                                   // no cutoff
        if (order < N && tsFreq.get(e.timestamp) === 1) capped[name] = (capped[name] ?? 0) + 1; // first N, solo only
        if (e.timestamp <= cutoffTs) { tsThreshold[name] = (tsThreshold[name] ?? 0) + 1; ts++; }
        order++;
      }
      if (ts > N) leakyPulls++;
    }
  }

  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`pulls: ${pulls}  voidAfterDeaths: ${N}  leaky pulls (ts-threshold > N): ${leakyPulls}`);
  console.log(`\nRAW total deaths (no cutoff) — top 8:`);
  for (const [n, c] of top(raw)) console.log(`  ${n.padEnd(14)} ${c}`);
  console.log(`\nCAPPED first-${N}-by-order (correct cutoff) — top 8:`);
  for (const [n, c] of top(capped)) console.log(`  ${n.padEnd(14)} ${c}`);
  console.log(`\nAlexsbussy: raw=${raw["Alexsbussy"] ?? 0}  capped=${capped["Alexsbussy"] ?? 0}  current-ts-logic=${tsThreshold["Alexsbussy"] ?? 0}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
