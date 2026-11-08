import { Worker } from "bullmq";
import { QUEUES, type QueueKey } from "@cyrus/shared";
import { loadEnv } from "../config/env.ts";
import { createDb } from "../lib/db.ts";
import { createRedis } from "../lib/redis.ts";
import { s3Storage } from "../lib/storage.ts";
import { resolveProcessor, type JobPayload } from "../workers/processors.ts";
import { onShutdown } from "./shutdown.ts";

/**
 * Process 3 of 4: background workers (heavy work and follow-ups).
 *
 * Which queues this copy serves is chosen with WORKER_QUEUES (comma-separated keys),
 * so on drive day you can run e.g. three copies with WORKER_QUEUES=notify.
 * Default: all queues.
 */
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const connection = createRedis(env.REDIS_URL, "queue");
const storage = s3Storage(env);

const allKeys = Object.keys(QUEUES) as QueueKey[];
const wanted = (process.env["WORKER_QUEUES"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const keys = wanted.length ? allKeys.filter((k) => wanted.includes(k)) : allKeys;

const workers = keys.map((key) => {
  const worker = new Worker<JobPayload>(
    QUEUES[key].name,
    async (job) => {
      const handler = resolveProcessor(key, job.data.type);
      if (!handler) throw new Error(`No handler for job type "${job.data.type}" on queue "${key}"`);
      if (job.data.jobId) {
        await db.job.update({ where: { id: job.data.jobId }, data: { status: "RUNNING", startedAt: new Date() } });
      }
      const result = await handler(job, { db, env, storage });
      if (job.data.jobId) {
        await db.job.update({
          where: { id: job.data.jobId },
          data: { status: "DONE", progress: 100, result: (result ?? null) as never, finishedAt: new Date() },
        });
      }
      return result;
    },
    { connection, concurrency: QUEUES[key].concurrency },
  );
  worker.on("failed", async (job, err) => {
    console.error(`[worker:${key}] job ${job?.id} (${job?.data.type}) failed: ${err.message}`);
    const finalAttempt = job && job.attemptsMade >= (job.opts.attempts ?? 1);
    if (job?.data.jobId && finalAttempt) {
      await db.job.update({ where: { id: job.data.jobId }, data: { status: "FAILED", error: err.message, finishedAt: new Date() } });
    }
  });
  return worker;
});

console.log(`[worker] serving queues: ${keys.join(", ")}`);

onShutdown((m) => console.log(`[worker] ${m}`), async () => {
  await Promise.all(workers.map((w) => w.close()));
  await db.$disconnect();
  connection.disconnect();
});
