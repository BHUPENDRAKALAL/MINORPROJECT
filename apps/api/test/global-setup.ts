import { execSync } from "node:child_process";

/**
 * Before the test run: bring the separate test database up to date with the migrations.
 * Never touches the development database.
 */
export default function setup(): void {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) {
    console.warn("[tests] TEST_DATABASE_URL not set: database tests are skipped.");
    return;
  }
  if (url === process.env["DATABASE_URL"]) {
    throw new Error("TEST_DATABASE_URL must point to a different database than DATABASE_URL (tests wipe it).");
  }
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
