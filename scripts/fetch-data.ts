import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { loadBossConfig } from "./config";
import { getAccessToken, fetchReportFights, fetchPlayers, fetchPlayerInfo, fetchEventsByType, fetchGuildReports } from "./wcl-client";
import { extractMistakes, type MechanicPlayerStats } from "./extract-mistakes";
import { loadReportCache, saveReportCache, newCache, eventsKey, type CachedEvent, type ReportCache } from "./cache";
import type { WclFight, EventType, PlayerInfo } from "../src/types";

const VALUE_FLAGS = new Set(["boss", "reports"]); // flags that take a following value

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** First positional argument (ignoring flags and their values). */
function positional(): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a.slice(2))) i++; // skip this flag's value
      continue;
    }
    return a;
  }
  return undefined;
}

async function main() {
  // Boss config name: `npm run fetch -- midnight` or `--boss midnight`.
  const boss = arg("boss") ?? positional();
  if (!boss) throw new Error("usage: npm run fetch -- <boss>   (e.g. npm run fetch -- midnight)");
  if (!/^[a-z0-9-]+$/.test(boss)) throw new Error("boss must be a slug: lowercase letters, digits, hyphens");

  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing WCL_CLIENT_ID / WCL_CLIENT_SECRET in " + "." + "env");

  const config = await loadBossConfig(`config/bosses/${boss}.json`);
  console.log(`[fetch] config: ${config.displayName} (encounter ${config.encounterID})`);

  const token = await getAccessToken(id, secret);

  // Decide which reports to aggregate, in priority order:
  //   --reports a,b,c  (override)  >  config.reportCodes  (pinned)  >
  //   config.guild     (auto-discover all of the guild's reports for this boss) >
  //   config.reportCode (single).
  const override = arg("reports")?.split(",").map((s) => s.trim()).filter(Boolean);
  let codes: string[] | undefined = override ?? config.reportCodes;
  if (!codes && config.guild) {
    console.log(`[fetch] discovering reports for "${config.guild.name}" (${config.guild.serverSlug}-${config.guild.serverRegion})…`);
    const discovered = await fetchGuildReports(token, config.guild, config.encounterID, config.difficulty);
    console.log(`[fetch] discovered ${discovered.length} reports with encounter ${config.encounterID}`);
    codes = discovered;
  }
  const reportCodes = [...new Set(codes ?? [config.reportCode])];
  console.log(`[fetch] aggregating ${reportCodes.length} report(s)`);

  // Combined, globally-unique fights with absolute (epoch) timing so pulls from
  // different reports sort into one chronological progression.
  const combinedFights: WclFight[] = [];
  const byFight = new Map<number, MechanicPlayerStats>();
  const allPlayers = new Set<string>();
  // Players can be classified differently across reports (off-spec pulls), so we
  // resolve each player's role by MAJORITY vote rather than last-report-wins.
  const roleVotes = new Map<string, Map<string, number>>();
  const classByName = new Map<string, string>();
  let uid = 0;

  // Group mechanics by event type so we can fetch all of one type in a single
  // query per fight, then map each event back to its mechanic by ability id.
  // A death mechanic with no ability ids is the "all deaths" catch-all.
  const typesUsed = [...new Set(config.mechanics.map((m) => m.eventType))] as EventType[];
  const byType = new Map<EventType, { abilityIds: number[]; abilityToMech: Map<number, string>; matchAllMechId?: string }>();
  for (const t of typesUsed) {
    const abilityToMech = new Map<number, string>();
    let matchAllMechId: string | undefined;
    for (const m of config.mechanics) {
      if (m.eventType !== t) continue;
      if (t === "death" && m.abilityIds.length === 0) matchAllMechId = m.id;
      for (const a of m.abilityIds) if (!abilityToMech.has(a)) abilityToMech.set(a, m.id);
    }
    byType.set(t, { abilityIds: [...abilityToMech.keys()], abilityToMech, matchAllMechId });
  }
  // We need every death (for the cutoff and/or the deaths mechanic) when either
  // a void-after-N rule or a death mechanic is configured.
  const needDeaths = config.voidAfterDeaths != null || byType.has("death");

  // Mechanics with a debounce window collapse rapid repeat hits per player.
  const debounceByMech = new Map<string, number>();
  for (const m of config.mechanics) if (m.debounceMs != null) debounceByMech.set(m.id, m.debounceMs);

  // Mechanics that never count specific abilities (for death: by killing ability).
  const excludeByMech = new Map<string, Set<number>>();
  for (const m of config.mechanics) if (m.excludeAbilityIds?.length) excludeByMech.set(m.id, new Set(m.excludeAbilityIds));

  const noCache = process.argv.includes("--no-cache");
  const diffNote = config.difficulty != null ? ` (difficulty ${config.difficulty})` : "";

  // ---- Pass 1: metadata for every report (cheap, cached). Collect matching pulls. ----
  interface ReportState { cache: ReportCache; players: Map<number, string>; dirty: boolean; }
  interface Pull { code: string; fight: WclFight; absStart: number; }
  const reportStates = new Map<string, ReportState>();
  const pulls: Pull[] = [];

  for (const code of reportCodes) {
    const cache = (!noCache && await loadReportCache(code)) || newCache(code);
    let dirty = false;
    if (cache.fights.length === 0 || noCache) {
      const meta = await fetchReportFights(token, code);
      const pl = await fetchPlayers(token, code);
      cache.reportStart = meta.reportStart; cache.zoneName = meta.zoneName;
      cache.fights = meta.fights; cache.players = [...pl.entries()];
      dirty = true;
    }
    const players = new Map(cache.players);
    const matching = cache.fights.filter((f) =>
      f.encounterID === config.encounterID && (config.difficulty == null || f.difficulty === config.difficulty));
    if ((cache.playerInfo == null || noCache) && matching.length > 0) {
      const info = await fetchPlayerInfo(token, code, matching.map((f) => f.id));
      cache.playerInfo = [...info.entries()];
      dirty = true;
    }
    for (const [name, info] of cache.playerInfo ?? []) {
      if (info.class) classByName.set(name, info.class);
      if (info.role) {
        const v = roleVotes.get(name) ?? new Map<string, number>();
        v.set(info.role, (v.get(info.role) ?? 0) + 1);
        roleVotes.set(name, v);
      }
    }
    reportStates.set(code, { cache, players, dirty });
    for (const f of matching) pulls.push({ code, fight: f, absStart: cache.reportStart + f.startTime });
    const cacheNote = cache.fetchedAt && !noCache ? " [cache]" : "";
    console.log(`[fetch] ${code}: ${matching.length}/${cache.fights.length} pulls match encounter ${config.encounterID}${diffNote}${cacheNote}`);
  }

  // Chronological order across all reports.
  pulls.sort((a, b) => a.absStart - b.absStart);

  // Progression cutoff: keep only pulls up to & including the first kill (drop farm).
  let kept = pulls;
  if (config.progressionOnly) {
    const killIdx = pulls.findIndex((p) => p.fight.kill === true);
    if (killIdx >= 0) {
      kept = pulls.slice(0, killIdx + 1);
      console.log(`[fetch] progression-only: kept ${kept.length}/${pulls.length} pulls (through first kill, dropped ${pulls.length - kept.length} farm pulls)`);
    } else {
      console.log(`[fetch] progression-only: no kill found, keeping all ${pulls.length} pulls`);
    }
  }
  if (kept.length === 0) throw new Error("No matching fights — check encounterID / difficulty / report codes.");

  // ---- Pass 2: fetch events for the kept pulls only, and aggregate. ----
  let voidedPulls = 0;
  let prevCode: string | undefined;
  for (let pi = 0; pi < kept.length; pi++) {
    const p = kept[pi];
    // Pulls are time-sorted; reports are sequential, so a code change means the
    // previous report is done — persist it now (crash-resilient incremental save).
    if (prevCode && prevCode !== p.code) {
      const prs = reportStates.get(prevCode)!;
      if (prs.dirty) { await saveReportCache({ ...prs.cache, fetchedAt: new Date().toISOString() }); prs.dirty = false; }
    }
    prevCode = p.code;
    const rs = reportStates.get(p.code)!;
    const { cache, players } = rs;
    const f = p.fight;

    const getEvents = async (ff: WclFight, eventType: EventType, abilityIds: number[]): Promise<CachedEvent[]> => {
      const key = eventsKey(ff.id, eventType, abilityIds);
      if (!noCache && cache.events[key]) return cache.events[key];
      const evs = await fetchEventsByType(token, p.code, ff, eventType, abilityIds);
      cache.events[key] = evs.map((e) => ({
        timestamp: e.timestamp, targetID: e.targetID, abilityGameID: e.abilityGameID,
        amount: e.amount, unmitigatedAmount: e.unmitigatedAmount, killingAbilityGameID: e.killingAbilityGameID,
      }));
      rs.dirty = true;
      return cache.events[key];
    };

    const stats: MechanicPlayerStats = {};
    for (const m of config.mechanics) stats[m.id] = {};

    // A wipe is called once N deaths have occurred, so only the first N deaths are
    // "real". SIMULTANEOUS deaths (same timestamp) are dropped — a raid-wide hit /
    // the wipe trigger, not individual blame. Damage after the Nth death is voided.
    const deathEvents = needDeaths ? await getEvents(f, "death", []) : [];
    const sortedDeaths = deathEvents.filter((e) => e.timestamp != null).sort((a, b) => a.timestamp - b.timestamp);
    const voidN = config.voidAfterDeaths;
    let cutoffTs = Infinity;
    let validDeaths: Set<CachedEvent> | null = null;
    if (voidN != null && sortedDeaths.length >= voidN) {
      cutoffTs = sortedDeaths[voidN - 1].timestamp;
      voidedPulls += 1;
      const tsFreq = new Map<number, number>();
      for (const e of sortedDeaths) tsFreq.set(e.timestamp, (tsFreq.get(e.timestamp) ?? 0) + 1);
      validDeaths = new Set(sortedDeaths.slice(0, voidN).filter((e) => tsFreq.get(e.timestamp) === 1));
    }

    const lastHit = new Map<string, Map<string, number>>();
    for (const [eventType, { abilityIds, abilityToMech, matchAllMechId }] of byType) {
      const raw = eventType === "death" ? deathEvents : await getEvents(f, eventType, abilityIds);
      const evs = debounceByMech.size ? [...raw].sort((a, b) => a.timestamp - b.timestamp) : raw;
      for (const e of evs) {
        if (eventType === "death") {
          if (validDeaths && !validDeaths.has(e)) continue;
        } else if (e.timestamp != null && e.timestamp > cutoffTs) {
          continue;
        }
        const abil = eventType === "death" ? e.killingAbilityGameID : e.abilityGameID;
        const mechId = eventType === "death"
          ? (matchAllMechId ?? (abil != null ? abilityToMech.get(abil) : undefined))
          : (abil != null ? abilityToMech.get(abil) : undefined);
        if (!mechId) continue;
        const excl = excludeByMech.get(mechId);
        if (excl && abil != null && excl.has(abil)) continue; // omitted ability (e.g. unavoidable wipe mechanic)
        const name = e.targetID != null ? players.get(e.targetID) : undefined;
        if (!name) continue;

        const window = debounceByMech.get(mechId);
        if (window != null) {
          if ((e.unmitigatedAmount ?? e.amount ?? 0) <= 0) continue;
          const seen = lastHit.get(mechId) ?? new Map<string, number>();
          const last = seen.get(name);
          if (last != null && e.timestamp - last < window) continue;
          seen.set(name, e.timestamp);
          lastHit.set(mechId, seen);
        }

        const perPlayer = stats[mechId];
        const cur = perPlayer[name] ?? { count: 0, damage: 0 };
        cur.count += 1;
        cur.damage += e.amount ?? 0;
        perPlayer[name] = cur;
        allPlayers.add(name); // roster = only players who actually appear in the prog
      }
    }

    const gid = uid++;
    combinedFights.push({ ...f, id: gid, startTime: p.absStart, endTime: cache.reportStart + f.endTime });
    byFight.set(gid, stats);
  }

  // Persist any caches that gained data this run.
  for (const rs of reportStates.values()) {
    if (rs.dirty) await saveReportCache({ ...rs.cache, fetchedAt: new Date().toISOString() });
  }

  if (combinedFights.length === 0) {
    throw new Error("No matching fights across any report — check encounterID / report codes.");
  }
  const voidNote = config.voidAfterDeaths != null ? `, ${voidedPulls} capped at death #${config.voidAfterDeaths}` : "";
  console.log(`[fetch] aggregated ${combinedFights.length} pulls${voidNote}`);

  const playerInfo: Record<string, PlayerInfo> = {};
  for (const n of allPlayers) {
    const votes = roleVotes.get(n);
    let role: string | undefined, best = -1;
    if (votes) for (const [r, c] of votes) if (c > best) { best = c; role = r; }
    const cls = classByName.get(n);
    if (cls || role) playerInfo[n] = { class: cls, role };
  }
  const viz = extractMistakes(config, combinedFights, byFight, [...allPlayers], playerInfo);
  await mkdir("public/data", { recursive: true });
  const outPath = `public/data/${boss}.json`;
  await writeFile(outPath, JSON.stringify(viz, null, 2));
  console.log(`[fetch] wrote ${outPath} (${viz.pulls.length} pulls, ${allPlayers.size} players, ${reportCodes.length} reports)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
