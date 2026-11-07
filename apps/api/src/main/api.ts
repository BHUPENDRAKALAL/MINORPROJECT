import { loadEnv } from "../config/env.ts";
import { buildApp } from "../http/app.ts";
import { createDb } from "../lib/db.ts";
import { createLogger } from "../lib/logger.ts";
import { queueMailer } from "../lib/mail.ts";
import { createQueues, closeQueues } from "../lib/queues.ts";
import { createRedis } from "../lib/redis.ts";
import { onShutdown } from "./shutdown.ts";

/** Process 1 of 4: the HTTP API (Light, Hot and Light + background routes; Heavy routes only enqueue). */
const env = loadEnv();
const log = createLogger(env, "api");
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
// Producers need a connection that waits for Redis instead of failing fast.
const queueRedis = createRedis(env.REDIS_URL, "queue");
const queues = createQueues(queueRedis);
const app = buildApp({ env, log, db, redis, mailer: queueMailer(queues) });

const server = app.listen(env.API_PORT, () => log.info(`API listening on :${env.API_PORT} (docs: /api/docs)`));

onShutdown((m) => log.info(m), async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await closeQueues(queues);
  await db.$disconnect();
  redis.disconnect();
  queueRedis.disconnect();
});
