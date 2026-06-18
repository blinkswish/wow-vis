import type { VizData } from "./types";

export type Metric = "count" | "damage";

export interface RankedPlayer {
  name: string;
  value: number;
}

export function assertVizData(raw: unknown): VizData {
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.pulls)) throw new Error("data: pulls must be an array");
  if (!Array.isArray(d.mechanics)) throw new Error("data: mechanics must be an array");
  if (!Array.isArray(d.players)) throw new Error("data: players must be an array");
  if (typeof d.boss !== "string") throw new Error("data: boss must be a string");
  return d as unknown as VizData;
}

export async function loadVizData(boss: string, fetchImpl: typeof fetch = fetch): Promise<VizData> {
  const res = await fetchImpl(`${import.meta.env.BASE_URL}data/${boss}.json`);
  if (!res.ok) throw new Error(`Failed to load data for ${boss}: ${res.status}`);
  return assertVizData(await res.json());
}

/**
 * Cumulative per-player value for one mechanic + metric, summed through the
 * fractional animation `head` (a pull cursor in [0, pulls.length]). The pull
 * currently being revealed contributes a partial (eased-in) increment so bars
 * grow smoothly within a pull. Returns players sorted descending by value
 * (ties broken by name), so index 0 is the current leader.
 */
/** Player names whose role is tank, from playerInfo (empty if unknown). */
export function tankNames(data: VizData): Set<string> {
  const tanks = new Set<string>();
  for (const [name, info] of Object.entries(data.playerInfo ?? {})) {
    if (info.role === "tank") tanks.add(name);
  }
  return tanks;
}

export function cumulativeRanking(
  data: VizData,
  mechanicId: string,
  metric: Metric,
  head: number,
  exclude?: Set<string>,
): RankedPlayer[] {
  const totals = new Map<string, number>();
  for (const name of data.players) if (!exclude?.has(name)) totals.set(name, 0);

  const n = data.pulls.length;
  const headClamped = Math.max(0, Math.min(head, n));
  const lastFull = Math.floor(headClamped);
  const frac = headClamped - lastFull;

  for (let i = 0; i < n; i++) {
    const weight = i < lastFull ? 1 : i === lastFull ? frac : 0;
    if (weight === 0) continue;
    const perPlayer = data.pulls[i].byMechanic[mechanicId] ?? {};
    for (const [name, stat] of Object.entries(perPlayer)) {
      if (exclude?.has(name)) continue;
      const inc = metric === "count" ? stat.count : stat.damage;
      totals.set(name, (totals.get(name) ?? 0) + inc * weight);
    }
  }

  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/** Largest single-player cumulative total over the whole prog — a stable axis bound. */
export function maxCumulative(data: VizData, mechanicId: string, metric: Metric): number {
  const final = cumulativeRanking(data, mechanicId, metric, data.pulls.length);
  return Math.max(1, final.length ? final[0].value : 1);
}
