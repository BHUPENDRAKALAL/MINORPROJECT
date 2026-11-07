import { loadEnv } from "../config/env.ts";
import { buildApp } from "../http/app.ts";
import { createDb } from "../lib/db.ts";
import { createLogger } from "../lib/logger.ts";
import { createRedis } from "../lib/redis.ts";
import { onShutdown } from "./shutdown.ts";

/** Process 1 of 4: the HTTP API (Light, Hot and Light + background routes; Heavy routes only enqueue). */
const env = loadEnv();
const log = createLogger(env, "api");
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const app = buildApp({ env, log, db, redis });

const server = app.listen(env.API_PORT, () => log.info(`API listening on :${env.API_PORT} (docs: /api/docs)`));

onShutdown((m) => log.info(m), async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await db.$disconnect();
  redis.disconnect();
});
