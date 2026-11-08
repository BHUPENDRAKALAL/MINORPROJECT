import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: a real browser against the real API, worker, database, file storage and Mailpit.
 *
 *   pnpm infra:up                  (Docker: Postgres, Redis, SeaweedFS, Mailpit)
 *   pnpm --filter @cyrus/web e2e
 *
 * Playwright starts the API (with per-route limits off, development only), the worker and the
 * web dev server, unless they are already running. Demo accounts are re-seeded before the run.
 * Tests run one at a time because they share one database.
 */
const ROOT = "../..";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  outputDir: "e2e-results",
  use: {
    baseURL: "http://localhost:5173",
    // Uses the Google Chrome already installed on this machine (no browser download needed).
    // Set E2E_BROWSER=bundled to use Playwright's own Chromium instead (after `pnpm exec playwright install chromium`).
    ...(process.env.E2E_BROWSER === "bundled" ? {} : { channel: "chrome" }),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 }, ...(process.env.E2E_BROWSER === "bundled" ? {} : { channel: "chrome" }) }, testIgnore: /mobile\.spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"], ...(process.env.E2E_BROWSER === "bundled" ? {} : { channel: "chrome" }) }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    {
      command: "pnpm --filter @cyrus/api dev:api",
      cwd: ROOT,
      url: "http://localhost:4000/api/v1/health",
      env: { ROUTE_LIMITS: "off" },
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @cyrus/api dev:worker",
      cwd: ROOT,
      // The worker's own health port, so Playwright knows it is really running (emails, file scans).
      url: "http://localhost:4002/health",
      env: { WORKER_HEALTH_PORT: "4002" },
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @cyrus/web dev",
      cwd: ROOT,
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
