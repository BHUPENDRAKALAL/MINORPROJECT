import { Redis } from "ioredis";

/**
 * How a connection is used decides how it behaves while Redis is unreachable:
 *  - "request": API requests (cache, rate limits, /ready). Fail fast, so a Redis outage never hangs a request.
 *  - "queue":   BullMQ producers/workers. Wait and retry; BullMQ needs maxRetriesPerRequest = null.
 *  - "pubsub":  Socket.io adapter. Wait and retry; subscriptions are re-sent on reconnect.
 *  - "limits":  rate limiting. Commands may wait for the connection (so the limiter's start-up script
 *               loads even if Redis connects a moment after the API), but never longer than 500 ms.
 */
export type RedisMode = "request" | "queue" | "pubsub" | "limits";

export function createRedis(url: string, mode: RedisMode = "request"): Redis {
  const failFast = mode === "request";
  const redis = new Redis(url, {
    maxRetriesPerRequest: failFast ? 1 : mode === "limits" ? 1 : null,
    enableOfflineQueue: !failFast,
    ...(mode === "limits" ? { commandTimeout: 500 } : {}),
  });
  let down = false;
  redis.on("error", (err: Error) => {
    if (!down) console.warn(`[redis:${mode}] connection problem (${url.replace(/\/\/.*@/, "//***@")}): ${err.message || err.name}`);
    down = true;
  });
  redis.on("ready", () => {
    if (down) console.info(`[redis:${mode}] connection restored`);
    down = false;
  });
  return redis;
}
