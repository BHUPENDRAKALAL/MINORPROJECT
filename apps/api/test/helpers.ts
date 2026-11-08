import { loadEnv, type Env } from "../src/config/env.ts";
import { createDb, type Db } from "../src/lib/db.ts";
import { createLogger } from "../src/lib/logger.ts";
import { memoryMailer } from "../src/lib/mail.ts";
import { buildApp } from "../src/http/app.ts";
import { memoryStorage } from "../src/lib/storage.ts";
import { recordingEnqueue } from "../src/lib/enqueue.ts";

export const TEST_DB_URL = process.env["TEST_DATABASE_URL"];
export const hasTestDb = !!TEST_DB_URL;

export function testEnv(): Env {
  return loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB_URL ?? "postgresql://x:y@localhost:5432/none",
    REDIS_URL: "redis://localhost:6380",
    APP_SECRET: "test-secret-test-secret-test-secret-1234",
    WEB_APP_URL: "http://localhost:5173",
  });
}

let sharedDb: Db | undefined;
export function testDb(): Db {
  sharedDb ??= createDb(TEST_DB_URL!);
  return sharedDb;
}

/** Empties every table (keeps the migrations table). */
export async function resetDb(db: Db): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!rows.length) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * A fresh app per test: fresh rate-limit counters, an inbox to read codes from, in-memory file storage,
 * a recorder for background jobs, and a fixed "random" roll for spot checks (default: no spot check).
 */
export function testApp(opts: { random?: () => number } = {}) {
  const env = testEnv();
  const db = testDb();
  const mailer = memoryMailer();
  const storage = memoryStorage();
  const enqueue = recordingEnqueue();
  const app = buildApp({ env, log: createLogger(env, "test"), db, mailer, storage, enqueue, random: opts.random ?? (() => 0.99) });
  return { app, db, mailer, env, storage, enqueue };
}

/** Pulls the 6-digit code out of the last email sent to `to`. */
export function lastCode(sent: { to: string; text: string }[], to: string): string {
  const mail = [...sent].reverse().find((m) => m.to === to);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No code emailed to ${to}`);
  return code;
}
