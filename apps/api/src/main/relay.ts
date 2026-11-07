import { setTimeout as sleep } from "node:timers/promises";
import { loadEnv } from "../config/env.ts";
import { createDb } from "../lib/db.ts";
import { createQueues, closeQueues } from "../lib/queues.ts";
import { createRedis } from "../lib/redis.ts";
import { relayBatch } from "../relay/relay.ts";
import { onShutdown } from "./shutdown.ts";

/** Process 4 of 4: outbox relay. Polls for committed events and puts them on the queues. */
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL, "queue");
const queues = createQueues(redis);

let running = true;
onShutdown((m) => console.log(`[relay] ${m}`), async () => {
  running = false;
  await closeQueues(queues);
  await db.$disconnect();
  redis.disconnect();
});

console.log("[relay] started");
while (running) {
  try {
    const n = await relayBatch(db, queues);
    // Busy: go again at once. Idle: wait a little before polling again.
    if (n === 0) await sleep(500);
  } catch (e) {
    console.error(`[relay] batch failed: ${(e as Error).message}`);
    await sleep(2000);
  }
}
