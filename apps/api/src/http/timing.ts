import type { RequestHandler } from "express";
import type { Logger } from "pino";
import { ROUTE_CLASSES, type RouteClass } from "@placesync/shared";

/** Logs a warning when a route is slower than its weight class allows. */
export function routeTiming(log: Logger): RequestHandler {
  return (req, res, next) => {
    const start = performance.now();
    res.on("finish", () => {
      const cls = res.locals["routeClass"] as RouteClass | undefined;
      if (!cls) return;
      const ms = performance.now() - start;
      const target = ROUTE_CLASSES[cls].targetMs;
      if (ms > target) {
        log.warn({ reqId: req.id, route: req.route?.path, routeClass: cls, ms: Math.round(ms), targetMs: target }, "slow route");
      }
    });
    next();
  };
}
