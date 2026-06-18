import type { VizData } from "./types";
import { cumulativeRanking, tankNames, type Metric } from "./data";
import { classColor } from "./classColors";

export const LOGICAL_WIDTH = 320;
export const LOGICAL_HEIGHT = 320; // tall enough for ~20 player rows
const DEFAULT_TOP_N = 20;

export interface RenderOpts {
  mechanicId: string;
  metric: Metric;
  topN?: number;
  omitTanks?: boolean;
}

/** Per-playback animation state for smoothing (eased row positions + bar lengths).
 * Pass the same instance across sequential frames; omit for an instant snap. */
export interface RenderState {
  pos: Map<string, number>;  // player -> eased row index
  len: Map<string, number>;  // player -> eased bar length (px)
}

export function newRenderState(): RenderState {
  return { pos: new Map(), len: new Map() };
}

const BG = "#0d0b1a";
const GRID = "#241f3d";
const TEXT = "#e8e6f0";
const DIM = "#6c6690";
const SHADE = "#00000055";
const EASE = 0.25; // fraction toward target per frame

const PAD_TOP = 24;
const PAD_BOTTOM = 16;  // room for the cutoff footnote
const PAD_LEFT = 54;    // left gutter for player names
const PAD_RIGHT = 34;   // right room for value labels

/** Quantise to a chunky pixel grid for the 8-bit look. */
function q(v: number, step = 1): number {
  return Math.round(v / step) * step;
}

function fmtValue(value: number, metric: Metric): string {
  const v = Math.round(value);
  if (metric === "count") return String(v);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(0) + "k";
  return String(v);
}

/** Move `cur` a fraction toward `target` (or snap if no prior value). */
function ease(map: Map<string, number>, key: string, target: number): number {
  const cur = map.get(key);
  const next = cur == null ? target : cur + (target - cur) * EASE;
  map.set(key, next);
  return next;
}

/**
 * Render one frame of the bar-chart race: cumulative per-player bars for the
 * selected mechanic + metric, ranked descending, growing and reordering as the
 * animation `head` advances. With a RenderState, row swaps and bar growth are
 * smoothed; bars are colored by the player's class.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  data: VizData,
  head: number,
  opts: RenderOpts,
  state?: RenderState,
): void {
  const W = LOGICAL_WIDTH;
  const H = LOGICAL_HEIGHT;
  const n = data.pulls.length;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const mech = data.mechanics.find((m) => m.id === opts.mechanicId) ?? data.mechanics[0];
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const exclude = opts.omitTanks ? tankNames(data) : undefined;
  // Only show players who have actually made this mistake (value > 0).
  const ranking = cumulativeRanking(data, mech.id, opts.metric, head, exclude)
    .filter((p) => p.value > 0)
    .slice(0, topN);
  const frameMax = Math.max(1, ranking.length ? ranking[0].value : 1);

  const plotX = PAD_LEFT;
  const plotW = W - PAD_LEFT - PAD_RIGHT;
  const plotY = PAD_TOP;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const rowH = plotH / topN;
  const barH = Math.max(5, q(rowH - 4));

  // --- HUD ---
  const headClamped = Math.max(0, Math.min(head, n));
  const headIdx = Math.min(Math.floor(headClamped), n - 1);
  const pullNo = data.pulls[Math.max(0, headIdx)].pull;

  ctx.font = "8px monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = TEXT;
  ctx.fillText(data.boss.toUpperCase(), 4, 9);
  ctx.textAlign = "right";
  ctx.fillText(`PULL ${pullNo}/${n}`, W - 4, 9);

  ctx.font = "7px monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = mech.color;
  ctx.fillText(mech.label.toUpperCase(), 4, 19);
  ctx.textAlign = "right";
  ctx.fillStyle = DIM;
  const metricLabel = opts.metric === "count" ? "MISTAKES" : "DMG TAKEN";
  ctx.fillText(opts.omitTanks ? `${metricLabel} (NO TANKS)` : metricLabel, W - 4, 19);

  // Drop eased state for players no longer shown, so re-entry snaps cleanly.
  if (state) {
    const shown = new Set(ranking.map((p) => p.name));
    for (const k of [...state.pos.keys()]) if (!shown.has(k)) { state.pos.delete(k); state.len.delete(k); }
  }

  // --- bars ---
  ctx.font = "7px monospace";
  for (let r = 0; r < ranking.length; r++) {
    const { name, value } = ranking[r];
    const targetLen = (plotW * value) / frameMax;
    const easedRow = state ? ease(state.pos, name, r) : r;
    const easedLen = state ? ease(state.len, name, targetLen) : targetLen;
    const cy = q(plotY + easedRow * rowH);
    const drawLen = value > 0 ? Math.max(2, q(easedLen)) : 0;
    const color = classColor(data.playerInfo?.[name]?.class, mech.color);

    ctx.fillStyle = color;
    ctx.fillRect(plotX, cy, drawLen, barH);
    ctx.fillStyle = SHADE;
    ctx.fillRect(plotX, cy + barH - 2, drawLen, 1);

    // player name in the left gutter (leader brighter)
    ctx.fillStyle = r === 0 ? TEXT : DIM;
    ctx.textAlign = "right";
    ctx.fillText(name.slice(0, 8), plotX - 4, cy + barH - 1);

    // value label at the bar's end
    ctx.fillStyle = value > 0 ? TEXT : DIM;
    ctx.textAlign = "left";
    ctx.fillText(fmtValue(value, opts.metric), plotX + drawLen + 3, cy + barH - 1);
  }

  // baseline axis
  ctx.fillStyle = GRID;
  ctx.fillRect(plotX, plotY, 1, plotH);

  // cutoff footnote
  if (data.voidAfterDeaths != null) {
    ctx.fillStyle = DIM;
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`* ignoring all events after ${data.voidAfterDeaths} deaths/pull`, 4, H - 4);
  }
}
