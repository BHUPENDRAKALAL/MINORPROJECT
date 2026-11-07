import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The first app build loads every Fastify plugin; on a cold, synced disk that can take a few seconds.
    testTimeout: 20_000,
    include: ["src/**/*.test.ts"],
  },
});
