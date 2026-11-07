import type { Job as BullJob } from "bullmq";
import type { QueueKey } from "@cyrus/shared";
import type { Db } from "../lib/db.ts";
import type { Env } from "../config/env.ts";
import type { EmailMessage } from "../lib/mail.ts";

export interface ProcessorContext {
  db: Db;
  env: Pick<Env, "MAIL_MODE" | "MAIL_FROM">;
}

/**
 * Sends one email. "console" mode prints it to the worker log (development);
 * an SMTP/provider mode is added when we choose an email provider.
 */
const sendEmail: Processor = async (job, ctx) => {
  const msg = job.data.data as unknown as EmailMessage;
  if (ctx.env.MAIL_MODE === "console") {
    console.log(
      ["", "──────── email (console mode) ────────", `From:    ${ctx.env.MAIL_FROM}`, `To:      ${msg.to}`, `Subject: ${msg.subject}`, "", msg.text, "──────────────────────────────────────", ""].join("\n"),
    );
    return { delivered: "console" };
  }
  throw new Error(`MAIL_MODE ${ctx.env.MAIL_MODE} is not implemented yet`);
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
  documents: { "system.ping": ping },
  companyChecks: { "system.ping": ping },
  reports: { "system.ping": ping },
};
