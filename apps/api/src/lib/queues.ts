import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUES, type QueueKey } from "@cyrus/shared";

export type Queues = Record<QueueKey, Queue>;

/** Producers for every queue. Used by the API (heavy routes) and the relay. */
export function createQueues(connection: Redis): Queues {
  const entries = (Object.keys(QUEUES) as QueueKey[]).map((key) => [
    key,
    new Queue(QUEUES[key].name, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    }),
  ]);
  return Object.fromEntries(entries) as Queues;
}

export async function closeQueues(queues: Queues): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}
