import { loadVizData, type Metric } from "./data";
import { Playback } from "./animation";
import { renderFrame, newRenderState, LOGICAL_WIDTH, LOGICAL_HEIGHT, type RenderOpts, type RenderState } from "./render";
import { exportMp4 } from "./export-video";
import type { VizData } from "./types";

const SCALE = 3; // 320x180 -> 960x540 chunky pixels
const FPS = 30;
const TARGET_DURATION_SEC = 30; // whole prog plays in ~this long, regardless of pull count

/** Adapt speed to the dataset so 24 pulls and 300 pulls both watch comfortably. */
function pullsPerSecond(pullCount: number): number {
  return Math.max(1, pullCount / TARGET_DURATION_SEC);
}

const canvas = document.getElementById("view") as HTMLCanvasElement;
canvas.width = LOGICAL_WIDTH * SCALE;
canvas.height = LOGICAL_HEIGHT * SCALE;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;
ctx.scale(SCALE, SCALE);

const bossSel = document.getElementById("boss") as HTMLSelectElement;
const mechSel = document.getElementById("mechanic") as HTMLSelectElement;
const metricBtn = document.getElementById("metric") as HTMLButtonElement;
const tanksChk = document.getElementById("omit-tanks") as HTMLInputElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const exportBtn = document.getElementById("export") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;

// Bosses available. Add entries as more configs are fetched.
const BOSSES = [{ id: "midnight", label: "Midnight Falls" }];
for (const b of BOSSES) {
  const o = document.createElement("option");
  o.value = b.id; o.textContent = b.label; bossSel.appendChild(o);
}

let data: VizData;
let playback: Playback;
let renderState: RenderState = newRenderState();
let playing = false;
let lastTs = 0;
let mechanicId = "";
let metric: Metric = "count";

function opts(): RenderOpts {
  return { mechanicId, metric, omitTanks: tanksChk.checked };
}

/** Live frame: animate with the shared render state for smoothing. */
function draw(head: number) {
  renderFrame(ctx, data, head, opts(), renderState);
}

/** A control changed while paused: snap to the new view (fresh state, no lag). */
function redrawStatic() {
  renderState = newRenderState();
  if (data) draw(playback.head);
}

function loop(ts: number) {
  if (!playing) return;
  const dt = lastTs ? ts - lastTs : 0;
  lastTs = ts;
  playback.advance(dt);
  draw(playback.head);
  if (playback.done) { playing = false; playBtn.textContent = "↻ Replay"; return; }
  requestAnimationFrame(loop);
}

function populateMechanics() {
  mechSel.replaceChildren();
  for (const m of data.mechanics) {
    const o = document.createElement("option");
    o.value = m.id; o.textContent = m.label; mechSel.appendChild(o);
  }
  mechanicId = data.mechanics[0]?.id ?? "";
  mechSel.value = mechanicId;
}

async function load(boss: string) {
  status.textContent = "loading…";
  data = await loadVizData(boss);
  populateMechanics();
  playback = new Playback(data.pulls.length, pullsPerSecond(data.pulls.length));
  renderState = newRenderState();
  playing = false;
  playBtn.textContent = "▶ Play";
  draw(0);
  const tankCount = Object.values(data.playerInfo ?? {}).filter((p) => p.role === "tank").length;
  status.textContent = `${data.players.length} players (${tankCount} tanks) · ${data.pulls.length} pulls`;
  (window as unknown as Record<string, unknown>).__wowvis = { data, playback, draw, redrawStatic };
}

mechSel.onchange = () => { mechanicId = mechSel.value; redrawStatic(); };

metricBtn.onclick = () => {
  metric = metric === "count" ? "damage" : "count";
  metricBtn.textContent = metric === "count" ? "Count" : "Damage";
  redrawStatic();
};

tanksChk.onchange = () => redrawStatic();

playBtn.onclick = () => {
  if (playback.done) { playback.reset(); renderState = newRenderState(); }
  playing = !playing;
  playBtn.textContent = playing ? "⏸ Pause" : "▶ Play";
  if (playing) { lastTs = 0; requestAnimationFrame(loop); }
};

exportBtn.onclick = async () => {
  playing = false;
  exportBtn.disabled = true;
  try {
    await exportMp4(data, FPS, pullsPerSecond(data.pulls.length), opts(), (msg) => (status.textContent = msg));
  } catch (e) {
    status.textContent = "export failed: " + String((e as Error)?.message ?? e);
    console.error("export failed:", e);
  } finally {
    exportBtn.disabled = false;
  }
};

bossSel.onchange = () => load(bossSel.value);
load(BOSSES[0].id).catch((e) => (status.textContent = "load failed: " + e.message));
