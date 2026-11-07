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
  MAIL_MODE: z.enum(["console"]).default("console"),
  MAIL_FROM: z.string().default("Cyrus <no-reply@cyrus.local>"),
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
