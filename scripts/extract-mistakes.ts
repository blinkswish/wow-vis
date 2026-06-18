import type { BossConfig, WclFight, VizData, PullData, PlayerStat, PlayerInfo } from "../src/types";

/** Per-fight, per-mechanic, per-player tallies, as built by the fetch layer. */
export type MechanicPlayerStats = Record<string, Record<string, PlayerStat>>;

/** WCL v2 ReportFight percentages are 0..100 floats. The `> 100` branch is a
 * defensive guard in case a legacy/hundredths value ever slips through. */
export function normalizePercent(v: number | null | undefined): number {
  if (v == null) return 100;
  return v > 100 ? v / 100 : v;
}

export function extractMistakes(
  config: BossConfig,
  fights: WclFight[],
  byFight: Map<number, MechanicPlayerStats>,
  players: string[],
  playerInfo: Record<string, PlayerInfo> = {},
  now: string = new Date().toISOString(),
): VizData {
  const matching = fights
    .filter((f) => f.encounterID === config.encounterID)
    .sort((a, b) => a.startTime - b.startTime);

  const pulls: PullData[] = matching.map((f, i) => {
    const stats = byFight.get(f.id) ?? {};
    const byMechanic: MechanicPlayerStats = {};
    for (const m of config.mechanics) byMechanic[m.id] = stats[m.id] ?? {};
    return {
      pull: i + 1,
      fightId: f.id,
      startTime: f.startTime,
      durationMs: f.endTime - f.startTime,
      kill: f.kill === true,
      bossPercent: f.kill === true ? 0 : normalizePercent(f.bossPercentage ?? f.fightPercentage),
      byMechanic,
    };
  });

  return {
    zone: config.zone,
    boss: config.displayName,
    encounterID: config.encounterID,
    reportCode: config.reportCode,
    generatedAt: now,
    mechanics: config.mechanics.map((m) => ({ id: m.id, label: m.label, color: m.color })),
    players: [...players].sort((a, b) => a.localeCompare(b)),
    playerInfo,
    voidAfterDeaths: config.voidAfterDeaths,
    pulls,
  };
}
