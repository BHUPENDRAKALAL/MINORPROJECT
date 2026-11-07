import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests read the root .env (for TEST_DATABASE_URL). Database tests are skipped when it isn't set.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {
  // no .env: database tests will be skipped
}

export default defineConfig({
  test: {
    // The first app build loads every plugin; on a cold, synced disk that can take a few seconds.
    testTimeout: 20_000,
    hookTimeout: 120_000,
    include: ["src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // Database tests share one test database, so files run one after another.
    fileParallelism: false,
  },
});
