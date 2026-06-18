import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import type { VizData } from "./types";
import { Playback } from "./animation";
import { renderFrame, newRenderState, LOGICAL_WIDTH, LOGICAL_HEIGHT, type RenderOpts } from "./render";

// Single-threaded ESM core. @ffmpeg/ffmpeg's worker is a MODULE worker (no
// importScripts), so it must `import()` the core — that requires the ESM build,
// not UMD. ESM single-thread core needs no COOP/COEP headers (GitHub-Pages-safe).
const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const EXPORT_SCALE = 3;

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("toBlob returned null"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

export async function exportMp4(
  data: VizData,
  fps: number,
  pullsPerSecond: number,
  opts: RenderOpts,
  onProgress: (msg: string) => void,
): Promise<void> {
  // Offscreen render target at export scale.
  const canvas = document.createElement("canvas");
  canvas.width = LOGICAL_WIDTH * EXPORT_SCALE;
  canvas.height = LOGICAL_HEIGHT * EXPORT_SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

  const playback = new Playback(data.pulls.length, pullsPerSecond);
  const total = playback.totalFrames(fps) + fps; // +1s hold on the final frame
  const state = newRenderState(); // smoothing across the exported frames

  // Live status: a phase label + ticking elapsed seconds. The encoder's first
  // load is a ~30MB wasm download with no intrinsic progress, so the timer makes
  // it obvious the export is working rather than hung.
  const startedAt = performance.now();
  const elapsed = () => Math.round((performance.now() - startedAt) / 1000);
  let phase = "loading encoder";
  const tick = () => onProgress(`${phase} · ${elapsed()}s`);
  const ticker = setInterval(tick, 250);

  try {
    tick();
    const ffmpeg = new FFmpeg();
    let lastLog = "";
    ffmpeg.on("log", ({ message }) => { lastLog = message; });
    ffmpeg.on("progress", ({ progress }) => { phase = `encoding ${Math.min(100, Math.max(0, Math.round(progress * 100)))}%`; });

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, "application/wasm"),
      });
    } catch (e) {
      throw new Error(`ffmpeg load failed: ${String((e as Error)?.message ?? e)} ${lastLog}`);
    }

    for (let frame = 0; frame <= total; frame++) {
      const head = playback.headForFrame(Math.min(frame, playback.totalFrames(fps)), fps);
      renderFrame(ctx, data, head, opts, state);
      const bytes = await canvasToPngBytes(canvas);
      const name = `f${String(frame).padStart(4, "0")}.png`;
      await ffmpeg.writeFile(name, bytes);
      phase = `rendering ${Math.round((frame / total) * 100)}%`;
    }

    phase = "encoding 0%";
    const code = await ffmpeg.exec([
      "-framerate", String(fps),
      "-i", "f%04d.png",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "out.mp4",
    ]);
    if (code !== 0) throw new Error(`ffmpeg exec exited ${code}: ${lastLog}`);

    const out = await ffmpeg.readFile("out.mp4");

    // Free MEMFS — PNG frames are large and accumulate; deleting avoids OOM.
    for (let frame = 0; frame <= total; frame++) {
      await ffmpeg.deleteFile(`f${String(frame).padStart(4, "0")}.png`).catch(() => {});
    }

    const bytes = out as Uint8Array;
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Self-describing filename: boss_mechanic_metric[_notanks].mp4
    const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const parts = [slug(data.boss), slug(opts.mechanicId), opts.metric];
    if (opts.omitTanks) parts.push("notanks");
    a.download = `${parts.join("_")}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
    clearInterval(ticker);
    onProgress(`done in ${elapsed()}s — downloaded ${a.download}`);
  } finally {
    clearInterval(ticker);
  }
}
