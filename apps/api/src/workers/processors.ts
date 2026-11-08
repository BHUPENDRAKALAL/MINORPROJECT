import type { Job as BullJob } from "bullmq";
import type { QueueKey } from "@cyrus/shared";
import type { Db } from "../lib/db.ts";
import type { Env } from "../config/env.ts";
import { createTransport, type Transporter } from "nodemailer";
import type { EmailMessage } from "../lib/mail.ts";
import type { Storage } from "../lib/storage.ts";
import { scanFile } from "./file-scan.ts";

export type MailEnv = Pick<Env, "MAIL_MODE" | "MAIL_FROM" | "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER" | "SMTP_PASS">;

export interface ProcessorContext {
  db: Db;
  env: MailEnv;
  storage: Storage;
}

let transport: Transporter | undefined;
function smtp(env: MailEnv): Transporter {
  transport ??= createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } } : {}),
  });
  return transport;
}

/**
 * Sends one email. "smtp": Mailpit in development (http://localhost:8025), Brevo/Gmail for real.
 * "console": prints it in the worker log.
 */
const sendEmail: Processor = async (job, ctx) => {
  const msg = job.data.data as unknown as EmailMessage;
  if (ctx.env.MAIL_MODE === "smtp") {
    const info = await smtp(ctx.env).sendMail({ from: ctx.env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
    return { delivered: "smtp", messageId: info.messageId };
  }
  console.log(
    ["", "──────── email (console mode) ────────", `From:    ${ctx.env.MAIL_FROM}`, `To:      ${msg.to}`, `Subject: ${msg.subject}`, "", msg.text, "──────────────────────────────────────", ""].join("\n"),
  );
  return { delivered: "console" };
};

/** Payload every queued job carries. `jobId` links to the user-visible Job row (if any). */
export interface JobPayload {
  type: string;
  jobId?: string;
  data: Record<string, unknown>;
}

export type Processor = (job: BullJob<JobPayload>, ctx: ProcessorContext) => Promise<unknown>;

/**
 * Handlers per queue and job type. Feature modules add their handlers here
 * (e.g. imports: "official-sheet.match", company-checks: "company.run-checks").
 * `system.ping` exists in every queue to test the pipeline end to end.
 */
const ping: Processor = async (job) => ({ pong: true, queue: job.queueName, at: new Date().toISOString() });

/** Events with no handler on a queue yet are acknowledged, so they don't retry forever. */
const unhandledEvent: Processor = async (job) => ({ skipped: true, reason: `no handler yet for ${job.data.type}` });

export function resolveProcessor(queue: QueueKey, type: string): Processor | undefined {
  return PROCESSORS[queue][type] ?? (type.startsWith("event:") ? unhandledEvent : undefined);
}

export const PROCESSORS: Record<QueueKey, Record<string, Processor>> = {
  notify: { "system.ping": ping, "email.send": sendEmail },
  webhooks: { "system.ping": ping },
  imports: { "system.ping": ping },
  documents: { "system.ping": ping, "file.scan": (job, ctx) => scanFile(ctx.db, ctx.storage, String(job.data.data["fileId"])) },
  companyChecks: { "system.ping": ping },
  reports: { "system.ping": ping },
};
