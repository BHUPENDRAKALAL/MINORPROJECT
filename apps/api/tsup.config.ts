import { defineConfig } from "tsup";

// One bundle per process type. The shared workspace package is bundled in.
export default defineConfig({
  entry: {
    api: "src/main/api.ts",
    realtime: "src/main/realtime.ts",
    worker: "src/main/worker.ts",
    relay: "src/main/relay.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["@placesync/shared"],
});
