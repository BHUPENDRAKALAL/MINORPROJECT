/**
 * End-to-end check of the background pipeline. Run with the worker and relay running:
 *
 *   pnpm --filter @placesync/api smoke
 *
 * 1. Writes an outbox event in a transaction  → relay must publish it to the queues.
 * 2. Creates a user-visible Job and queues it → worker must mark it DONE.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { loadEnv } from "../config/env.ts";
import { createDb } from "../lib/db.ts";
import { createQueues, closeQueues } from "../lib/queues.ts";
import { createRedis } from "../lib/redis.ts";
import { emit } from "../lib/outbox.ts";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL, "queue");
const queues = createQueues(redis);

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

let failed = false;
try {
  // 1. Outbox → relay
  const marker = `smoke-${Date.now()}`;
  await db.$transaction(async (tx) => emit(tx, "announcement.created", { marker }));
  const event = await db.outboxEvent.findFirstOrThrow({ where: { data: { path: ["marker"], equals: marker } } });
  const published = await waitFor("relay to publish the event", async () => {
    const e = await db.outboxEvent.findUnique({ where: { id: event.id } });
    return e?.publishedAt ? e : null;
  });
  console.log(`✔ relay published event ${published.id} (${published.type})`);

  // 2. Job → worker
  const job = await db.job.create({ data: { queue: "imports", type: "system.ping", input: { marker } } });
  await queues.imports.add("system.ping", { type: "system.ping", jobId: job.id, data: {} }, { jobId: job.id });
  const done = await waitFor("worker to finish the job", async () => {
    const j = await db.job.findUnique({ where: { id: job.id } });
    if (j?.status === "FAILED") throw new Error(`job failed: ${j.error}`);
    return j?.status === "DONE" ? j : null;
  });
  console.log(`✔ worker finished job ${done.id} → ${JSON.stringify(done.result)}`);
  console.log("Pipeline OK");
} catch (e) {
  failed = true;
  console.error(`✘ ${(e as Error).message}`);
} finally {
  await closeQueues(queues);
  await db.$disconnect();
  redis.disconnect();
  process.exit(failed ? 1 : 0);
}
