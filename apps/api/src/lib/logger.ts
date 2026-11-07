import { pino, type Logger } from "pino";
import type { Env } from "../config/env.ts";

/** Structured JSON logs, one logger per process. */
export function createLogger(env: Pick<Env, "LOG_LEVEL" | "NODE_ENV">, name: string): Logger {
  return pino({ name, level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL });
}
