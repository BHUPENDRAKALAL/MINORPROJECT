import type { EventType } from "@cyrus/shared";
import type { Db } from "../lib/db.ts";
import type { Queues } from "../lib/queues.ts";
import { queuesFor } from "./routing.ts";

interface OutboxRow {
  id: string;
  type: string;
  version: number;
  data: unknown;
  createdAt: Date;
}

/**
 * Moves one batch of committed events from the outbox onto the queues.
 * `FOR UPDATE SKIP LOCKED` lets several relay copies run without sending
 * the same event twice. BullMQ's jobId = event id makes re-sends harmless.
 * Returns how many events were published.
 */
export async function relayBatch(db: Db, queues: Queues, batchSize = 100): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT id, type, version, data, "createdAt"
      FROM "OutboxEvent"
      WHERE "publishedAt" IS NULL
      ORDER BY "createdAt"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;

    for (const row of rows) {
      const event = { id: row.id, type: row.type, version: row.version, createdAt: row.createdAt.toISOString(), data: row.data };
      try {
        await Promise.all(
          queuesFor(row.type as EventType).map((key) =>
            queues[key].add(row.type, { type: `event:${row.type}`, data: { event } }, { jobId: `${row.id}-${key}` }),
          ),
        );
        await tx.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date(), attempts: { increment: 1 } } });
      } catch (e) {
        await tx.outboxEvent.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 }, lastError: (e as Error).message.slice(0, 500) },
        });
      }
    }
    return rows.length;
  });
}
