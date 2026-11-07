import type { Prisma } from "../generated/prisma/client.ts";

type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
}

/** Write an audit row inside the caller's transaction (every state change gets one). */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
    },
  });
}
