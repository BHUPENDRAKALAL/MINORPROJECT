import { execSync } from "node:child_process";
import path from "node:path";

/** Fresh demo accounts before every run, and an empty Mailpit inbox. */
export default async function globalSetup() {
  const root = path.resolve(import.meta.dirname, "../../..");
  execSync("pnpm --filter @cyrus/api seed:demo", { cwd: root, stdio: "inherit" });
  // Remove students that earlier e2e runs signed up (their emails end in @e2e.test).
  execSync("pnpm --filter @cyrus/api exec tsx --env-file-if-exists=../../.env src/scripts/cleanup-e2e.ts", { cwd: root, stdio: "inherit" });
  await fetch("http://localhost:8025/api/v1/messages", { method: "DELETE" }).catch(() => undefined);
}
