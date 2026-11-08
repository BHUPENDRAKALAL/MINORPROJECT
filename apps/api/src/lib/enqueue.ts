import type { QueueKey } from "@cyrus/shared";
import type { Queues } from "./queues.ts";

/** Hand background work to a worker queue. Tests use a recorder instead of Redis. */
export type Enqueue = (queue: QueueKey, type: string, data: Record<string, unknown>) => Promise<void>;

export function queueEnqueue(queues: Queues): Enqueue {
  return async (queue, type, data) => {
    await queues[queue].add(type, { type, data });
  };
}

export function recordingEnqueue(): Enqueue & { calls: { queue: QueueKey; type: string; data: Record<string, unknown> }[] } {
  const calls: { queue: QueueKey; type: string; data: Record<string, unknown> }[] = [];
  const fn = (async (queue: QueueKey, type: string, data: Record<string, unknown>) => {
    calls.push({ queue, type, data });
  }) as Enqueue & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}
