import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Env } from "../config/env.ts";
import type { Db } from "../lib/db.ts";
import { errorHandler, notFound } from "./errors.ts";
import { mountRoutes } from "./define-route.ts";
import { routeTiming } from "./timing.ts";
import { healthRoutes } from "../modules/health/routes.ts";

export interface AppDeps {
  env: Env;
  log: Logger;
  db?: Db;
  redis?: Redis;
}

const PREFIX = "/api/v1";

/** Builds the Express app. Kept separate from start-up so tests can use supertest. */
export function buildApp(deps: AppDeps): Express {
  const { env, log } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(pinoHttp({ logger: log, genReqId: (req) => (req.headers["x-request-id"] as string) || crypto.randomUUID() }));
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      // If Redis is down, let requests through (and /ready reports it) instead of failing every request.
      passOnStoreError: true,
      ...(deps.redis
        ? { store: new RedisStore({ sendCommand: (command: string, ...args: string[]) => deps.redis!.call(command, ...args) as Promise<RedisReply> }) }
        : {}),
    }),
  );
  app.use(routeTiming(log));

  // Routes. Feature modules are added here as they are built (auth, companies, students, drives, ...).
  const registry = new OpenAPIRegistry();
  const v1 = express.Router();
  mountRoutes(v1, registry, PREFIX, [
    ...healthRoutes({ db: deps.db, redis: deps.redis, log, showErrors: env.NODE_ENV !== "production" }),
  ]);
  app.use(PREFIX, v1);

  if (env.NODE_ENV !== "production") {
    const doc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
      openapi: "3.0.3",
      info: { title: "PlaceSync API", version: "0.1.0", description: "See BACKEND-DESIGN.md for the full design." },
    });
    app.get("/api/openapi.json", (_req, res) => void res.json(doc));
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(doc));
  }

  app.use(notFound);
  app.use(errorHandler(log));
  return app;
}
