import { defineConfig } from "vite";

export default defineConfig({
  base: "/wow-vis/",
  build: { target: "es2022" },
  // Don't pre-bundle ffmpeg.wasm: Vite's optimizer rewrites it so the worker's
  // `import.meta.url` breaks in dev, hanging ffmpeg.load(). Excluding it lets the
  // worker resolve correctly so MP4 export works on the dev server too.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
});
