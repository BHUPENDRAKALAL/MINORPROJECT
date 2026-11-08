import { z } from "zod";

/**
 * All configuration comes from environment variables, checked once at start-up.
 * A missing or wrong value stops the process with a clear message instead of
 * failing later in the middle of a request.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  REALTIME_PORT: z.coerce.number().int().positive().default(4001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  APP_SECRET: z
    .string()
    .min(32, "APP_SECRET must be at least 32 characters")
    .refine((s) => !s.startsWith("change-me"), "APP_SECRET still has the example value; generate a random one"),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Where the web app runs; used to build links in emails (invites). */
  WEB_APP_URL: z.string().url().default("http://localhost:5173"),
  /** console = print in the worker log; smtp = send through SMTP (Mailpit in dev, Brevo/Gmail for real). */
  MAIL_MODE: z.enum(["console", "smtp"]).default("console"),
  MAIL_FROM: z.string().default("Cyrus <no-reply@cyrus.local>"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  /** S3-compatible file storage (SeaweedFS in dev; R2, Supabase Storage or S3 in production). */
  S3_ENDPOINT: z.string().url().default("http://localhost:8333"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("cyrus-files"),
  S3_ACCESS_KEY: z.string().default("cyrus-dev-key"),
  S3_SECRET_KEY: z.string().default("cyrus-dev-secret"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /**
   * "off" turns off the per-route limits (login, signup, codes) so automated end-to-end tests can run
   * many sign-ins in a row. Development only: ignored in production.
   */
  ROUTE_LIMITS: z.enum(["on", "off"]).default("on"),
  /** Largest upload accepted, in megabytes. */
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(50).default(10),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example in the project root.`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}
