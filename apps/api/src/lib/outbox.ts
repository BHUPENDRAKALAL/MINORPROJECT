import type { EventType } from "@cyrus/shared";
import type { Prisma } from "../generated/prisma/client.ts";

type Tx = Prisma.TransactionClient;

/**
 * Record a domain event inside the caller's transaction (BACKEND-DESIGN.md §2).
 * If the transaction rolls back, the event disappears with it; if it commits,
 * the relay is guaranteed to pick the event up, even after a crash.
 *
 *   await db.$transaction(async (tx) => {
 *     await tx.drive.update(...);
 *     await emit(tx, "drive.published", { driveId });
 *   });
 */
export async function emit<T extends Prisma.InputJsonValue>(tx: Tx, type: EventType, data: T): Promise<void> {
  await tx.outboxEvent.create({ data: { type, data } });
}
