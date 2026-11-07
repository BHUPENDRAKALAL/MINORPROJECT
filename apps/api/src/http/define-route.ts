import type { Request, Response, Router } from "express";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, type ZodType } from "zod";
import { ROUTE_CLASSES, type RouteClass } from "@placesync/shared";
import { ApiError } from "./errors.ts";

type Method = "get" | "post" | "put" | "patch" | "delete";

/**
 * One API route. `routeClass` is required, so a route without a weight class
 * doesn't compile (BACKEND-DESIGN.md §9.17). The same zod schemas validate the
 * request and generate the OpenAPI docs at /api/docs.
 */
export interface RouteDef<
  P extends ZodType = ZodType,
  Q extends ZodType = ZodType,
  B extends ZodType = ZodType,
> {
  method: Method;
  /** Express-style path relative to /api/v1, e.g. "/drives/:id" */
  path: string;
  routeClass: RouteClass;
  summary: string;
  tags: string[];
  request?: { params?: P; query?: Q; body?: B };
  responses: Record<number, { description: string; schema?: ZodType }>;
  handler: (
    input: { params: z.infer<P>; query: z.infer<Q>; body: z.infer<B>; req: Request; res: Response },
  ) => Promise<unknown> | unknown;
}

/** Helper that keeps the generic types when writing a route. */
export function defineRoute<P extends ZodType, Q extends ZodType, B extends ZodType>(def: RouteDef<P, Q, B>): RouteDef<P, Q, B> {
  return def;
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

/** Mounts routes on a router and records them in the OpenAPI registry. */
export function mountRoutes(router: Router, registry: OpenAPIRegistry, prefix: string, defs: RouteDef[]): void {
  for (const def of defs) {
    if (!(def.routeClass in ROUTE_CLASSES)) throw new Error(`Route ${def.method} ${def.path} has an invalid routeClass`);

    router[def.method](def.path, async (req, res) => {
      res.locals["routeClass"] = def.routeClass;
      res.setHeader("x-route-class", def.routeClass);
      const params = parse(def.request?.params, req.params, "params");
      const query = parse(def.request?.query, req.query, "query");
      const body = parse(def.request?.body, req.body, "body");
      const result = await def.handler({ params, query, body, req, res });
      if (!res.headersSent) {
        if (result === undefined) res.status(204).end();
        else res.json(result);
      }
    });

    registry.registerPath({
      method: def.method,
      path: prefix + def.path.replace(/:(\w+)/g, "{$1}"),
      summary: def.summary,
      tags: def.tags,
      description: `Weight class: ${ROUTE_CLASSES[def.routeClass].label}`,
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
