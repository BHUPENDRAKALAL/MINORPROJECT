import type { Request, RequestHandler, Response, Router } from "express";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import { z, type ZodType } from "zod";
import { ROUTE_CLASSES, type RouteClass } from "@cyrus/shared";
import type { Db } from "../lib/db.ts";
import { ApiError } from "./errors.ts";
import { checkAccess, loadAuth, type Access, type AuthContext } from "./auth-context.ts";

type Method = "get" | "post" | "put" | "patch" | "delete";

export interface RouteLimit {
  windowMs: number;
  max: number;
  /** Extra part of the key, added to the client IP (e.g. the email being tried). Default: IP only. */
  key?: (req: Request) => string;
}

/** IPv6 addresses are grouped by /56 so one user can't dodge limits by rotating addresses. */
export const clientIpKey = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

/**
 * One API route. `routeClass` and `access` are required, so a route that forgets
 * its weight class or who may call it doesn't compile (BACKEND-DESIGN.md §8, §9.17).
 * The same zod schemas validate the request and generate the OpenAPI docs.
 */
export interface RouteDef<P extends ZodType = ZodType, Q extends ZodType = ZodType, B extends ZodType = ZodType> {
  method: Method;
  /** Express-style path relative to /api/v1, e.g. "/drives/:id" */
  path: string;
  routeClass: RouteClass;
  access: Access;
  summary: string;
  tags: string[];
  /** Extra per-route limit on top of the global one (login, OTP, signup…). */
  limit?: RouteLimit;
  /** Extra middleware run after the access check, before validation (e.g. multipart upload parsing). */
  before?: RequestHandler[];
  request?: { params?: P; query?: Q; body?: B };
  responses: Record<number, { description: string; schema?: ZodType }>;
  handler: (input: {
    params: z.infer<P>;
    query: z.infer<Q>;
    body: z.infer<B>;
    /** Present on every route that isn't "public". */
    auth: AuthContext;
    req: Request;
    res: Response;
  }) => Promise<unknown> | unknown;
}

/** Helper that keeps the generic types when writing a route. */
export function defineRoute<P extends ZodType, Q extends ZodType, B extends ZodType>(def: RouteDef<P, Q, B>): RouteDef {
  return def as unknown as RouteDef;
}

export interface MountContext {
  db?: Db;
  appSecret: string;
  /** Rate-limit store per route (Redis in production, memory in tests). */
  makeStore?: (prefix: string) => Store;
}

function parse<T extends ZodType>(schema: T | undefined, value: unknown, where: string): z.infer<T> {
  if (!schema) return value as z.infer<T>;
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_FAILED", "Some fields are missing or invalid.", {
      in: where,
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

const NO_AUTH = new Proxy({} as AuthContext, {
  get() {
    throw new Error("This route is public: there is no signed-in user.");
  },
});

/** Mounts routes on a router and records them in the OpenAPI registry. */
export function mountRoutes(router: Router, registry: OpenAPIRegistry, prefix: string, defs: RouteDef[], ctx: MountContext): void {
  for (const def of defs) {
    if (!(def.routeClass in ROUTE_CLASSES)) throw new Error(`Route ${def.method} ${def.path} has an invalid routeClass`);
    if (!def.access) throw new Error(`Route ${def.method} ${def.path} has no access rule`);

    const middlewares: RequestHandler[] = [];
    if (def.limit) {
      const routeKey = `${def.method}:${def.path}`;
      middlewares.push(
        rateLimit({
          windowMs: def.limit.windowMs,
          limit: def.limit.max,
          standardHeaders: "draft-8",
          legacyHeaders: false,
          passOnStoreError: true,
          keyGenerator: (req) => `${routeKey}:${clientIpKey(req)}${def.limit!.key ? `:${def.limit!.key(req)}` : ""}`,
          handler: (_req, res) =>
            void res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a bit and try again." } }),
          ...(ctx.makeStore ? { store: ctx.makeStore(`rl:${routeKey}:`) } : {}),
        }),
      );
    }

    // Who is calling is checked before any `before` middleware (e.g. file upload parsing),
    // so an anonymous caller can't make the server read a large upload.
    const authenticate: RequestHandler = async (req, res, next) => {
      res.locals["routeClass"] = def.routeClass;
      res.setHeader("x-route-class", def.routeClass);
      if (def.access !== "public") {
        if (!ctx.db) throw new ApiError(503, "UNAVAILABLE", "Sign-in is not available right now.");
        const loaded = await loadAuth(req, ctx.db, ctx.appSecret);
        req.auth = loaded;
        if (def.access !== "authenticated") checkAccess(loaded, def.access);
      }
      next();
    };

    router[def.method](def.path, ...middlewares, authenticate, ...(def.before ?? []), async (req, res) => {
      const auth: AuthContext = req.auth ?? NO_AUTH;
      const params = parse(def.request?.params, req.params, "params");
      const query = parse(def.request?.query, req.query, "query");
      const body = parse(def.request?.body, req.body, "body");
      const result = await def.handler({ params, query, body, auth, req, res });
      if (!res.headersSent) {
        if (result === undefined) res.status(204).end();
        else res.json(result);
      }
    });

    const accessText =
      def.access === "public"
        ? "Public"
        : def.access === "authenticated"
          ? "Any signed-in user"
          : [def.access.roles?.length ? `Roles: ${def.access.roles.join(", ")}` : "", def.access.capabilities?.length ? `Capabilities: ${def.access.capabilities.join(", ")}` : ""]
              .filter(Boolean)
              .join(" · ");

    registry.registerPath({
      method: def.method,
      path: prefix + def.path.replace(/:(\w+)/g, "{$1}"),
      summary: def.summary,
      tags: def.tags,
      description: `Weight class: ${ROUTE_CLASSES[def.routeClass].label}. Access: ${accessText}.`,
      ...(def.access === "public" ? {} : { security: [{ bearerAuth: [] }] }),
      request: {
        ...(def.request?.params ? { params: def.request.params as never } : {}),
        ...(def.request?.query ? { query: def.request.query as never } : {}),
        ...(def.request?.body ? { body: { content: { "application/json": { schema: def.request.body } } } } : {}),
      },
      responses: Object.fromEntries(
        Object.entries(def.responses).map(([status, r]) => [
          status,
          r.schema ? { description: r.description, content: { "application/json": { schema: r.schema } } } : { description: r.description },
        ]),
      ),
    });
  }
}
