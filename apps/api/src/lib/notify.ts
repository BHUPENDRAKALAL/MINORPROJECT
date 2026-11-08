import type { Prisma } from "../generated/prisma/client.ts";
import type { Mailer } from "./mail.ts";

type Tx = Prisma.TransactionClient;

export interface Notice {
  userId: string;
  channel: "QUEUE" | "DRIVES" | "OFFERS" | "GENERAL";
  title: string;
  body: string;
  link?: string;
}

/**
 * In-app notification, written in the caller's transaction so it exists exactly when the change does.
 * Returns the email to send after commit (important notices also go by email; push comes with the app).
 */
export async function notifyInApp(tx: Tx, n: Notice): Promise<{ to: string; subject: string; text: string } | null> {
  await tx.notification.create({ data: { userId: n.userId, channel: n.channel, title: n.title, body: n.body, link: n.link } });
  const user = await tx.user.findUnique({ where: { id: n.userId }, select: { email: true } });
  return user ? { to: user.email, subject: n.title, text: n.body } : null;
}

export async function sendAfterCommit(mailer: Mailer, emails: ({ to: string; subject: string; text: string } | null)[]) {
  for (const e of emails) if (e) await mailer.send(e);
}
