import { defineConfig } from "tsup";

// One bundle per process type. The shared workspace package is bundled in.
export default defineConfig({
  entry: {
    api: "src/main/api.ts",
    realtime: "src/main/realtime.ts",
    worker: "src/main/worker.ts",
    relay: "src/main/relay.ts",
    // Started by the worker, one fresh process per uploaded file (must sit next to worker.js)
    "sanitize-child": "src/sanitizer/sanitize-child.ts",
    sanitizer: "src/sanitizer/server.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["@cyrus/shared"],
});
