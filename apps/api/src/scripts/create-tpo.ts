/**
 * Creates the first TPO account (there is no public signup for TPOs).
 *
 *   pnpm --filter @cyrus/api create-tpo --email tpo@example.com --name "Placement Officer"
 *
 * Prints a one-time password to the terminal. Sign in with it and change it right away
 * (PATCH /api/v1/me/password). Running it again for an existing email only adds the TPO role.
 */
import { parseArgs } from "node:util";
import { loadEnv } from "../config/env.ts";
import { createDb } from "../lib/db.ts";
import { hashPassword, randomToken } from "../lib/crypto.ts";
import { audit } from "../lib/audit.ts";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
if (!values.email) {
  console.error('Usage: pnpm --filter @cyrus/api create-tpo --email tpo@example.com --name "Placement Officer"');
  process.exit(1);
}

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const email = values.email.trim().toLowerCase();

try {
  const existing = await db.user.findUnique({ where: { email } });
  const tempPassword = existing ? null : randomToken(12);
  const user =
    existing ??
    (await db.user.create({
      data: { email, name: values.name ?? "Placement Officer", passwordHash: await hashPassword(tempPassword!), emailVerifiedAt: new Date() },
    }));
  await db.$transaction(async (tx) => {
    await tx.roleGrant.upsert({
      where: { userId_role: { userId: user.id, role: "TPO" } },
      create: { userId: user.id, role: "TPO", capabilities: [] },
      update: { expiresAt: null },
    });
    await audit(tx, { actorId: null, action: "tpo.created_by_script", entityType: "User", entityId: user.id, after: { email } });
  });
  console.log(`✔ TPO role given to ${email}`);
  if (tempPassword) console.log(`  One-time password: ${tempPassword}\n  Sign in and change it right away.`);
  else console.log("  The account already existed; its password is unchanged.");
} finally {
  await db.$disconnect();
}
