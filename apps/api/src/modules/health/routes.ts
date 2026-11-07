import { z } from "zod";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Db } from "../../lib/db.ts";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";

export interface HealthDeps {
  db?: Db;
  redis?: Redis;
  log: Logger;
  /** Include error text in /ready (development only; never leak internals in production). */
  showErrors?: boolean;
}

const CheckResult = z.object({ ok: z.boolean(), ms: z.number(), error: z.string().optional() });
type Check = z.infer<typeof CheckResult>;
const ReadyBody = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.object({ database: CheckResult, redis: CheckResult }),
});

export function healthRoutes(deps: HealthDeps): RouteDef[] {
  async function timed(fn: () => Promise<unknown>): Promise<Check> {
    const start = performance.now();
    try {
      await fn();
      return { ok: true, ms: Math.round(performance.now() - start) };
    } catch (e) {
      const ms = Math.round(performance.now() - start);
      deps.log.warn({ err: e }, "readiness check failed");
      const firstLine = String((e as Error).message ?? "").split("\n").map((s) => s.trim()).find(Boolean) ?? "failed";
      return deps.showErrors ? { ok: false, ms, error: firstLine.slice(0, 200) } : { ok: false, ms };
    }
  }
  const missing: Check = { ok: false, ms: 0, error: "not configured" };

  return [
    defineRoute({
      method: "get",
      path: "/health",
      routeClass: "LIGHT",
      access: "public",
      summary: "Process is alive",
      tags: ["system"],
      responses: { 200: { description: "Alive", schema: z.object({ status: z.literal("ok"), uptimeSeconds: z.number() }) } },
      handler: () => ({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }),
    }),
    defineRoute({
      method: "get",
      path: "/ready",
      routeClass: "LIGHT",
      access: "public",
      summary: "Database and Redis are reachable",
      tags: ["system"],
      responses: {
        200: { description: "Ready", schema: ReadyBody },
        503: { description: "A dependency is down", schema: ReadyBody },
      },
      handler: async ({ res }) => {
        const [database, redis] = await Promise.all([
          deps.db ? timed(() => deps.db!.$queryRaw`SELECT 1`) : Promise.resolve(missing),
          deps.redis ? timed(() => deps.redis!.ping()) : Promise.resolve(missing),
        ]);
        const ok = database.ok && redis.ok;
        res.status(ok ? 200 : 503);
        return { status: ok ? "ready" : "not_ready", checks: { database, redis } };
      },
    }),
  ];
}
