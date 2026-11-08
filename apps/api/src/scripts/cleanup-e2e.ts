/**
 * Removes accounts created by end-to-end test runs (emails ending in @e2e.test). Development only.
 *   pnpm --filter @cyrus/api exec tsx --env-file-if-exists=../../.env src/scripts/cleanup-e2e.ts
 */
import { loadEnv } from "../config/env.ts";
import { createDb } from "../lib/db.ts";

const env = loadEnv();
if (env.NODE_ENV === "production") {
  console.error("cleanup-e2e refuses to run in production.");
  process.exit(1);
}
const db = createDb(env.DATABASE_URL);
try {
  // Drives made by e2e runs: on companies they added, or with an "E2E" role title
  const companies = await db.company.findMany({ where: { name: { startsWith: "E2E " } }, select: { id: true } });
  const e2eDrives = { OR: [{ companyId: { in: companies.map((c) => c.id) } }, { roleTitle: { startsWith: "E2E " } }] };
  await db.placementRecord.deleteMany({ where: { offer: { drive: e2eDrives } } });
  await db.offer.deleteMany({ where: { drive: e2eDrives } });
  await db.drive.deleteMany({ where: e2eDrives });
  await db.company.deleteMany({ where: { id: { in: companies.map((c) => c.id) } } });
  const users = await db.user.findMany({ where: { email: { endsWith: "@e2e.test" } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const students = await db.studentProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  await db.$transaction(async (tx) => {
    await tx.reviewTask.deleteMany({ where: { studentId: { in: students.map((s) => s.id) } } });
    await tx.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    const files = await tx.fileObject.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
    await tx.fileObject.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
    await tx.emailOtp.deleteMany({ where: { email: { endsWith: "@e2e.test" } } });
    await tx.invite.deleteMany({ where: { email: { endsWith: "@e2e.test" } } });
  });
  console.log(`✔ Removed ${ids.length} e2e test accounts`);
} finally {
  await db.$disconnect();
}
