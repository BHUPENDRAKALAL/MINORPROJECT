import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Env } from "../config/env.ts";
import type { Db } from "../lib/db.ts";
import type { Mailer } from "../lib/mail.ts";
import { errorHandler, notFound } from "./errors.ts";
import { mountRoutes, type MountContext } from "./define-route.ts";
import { routeTiming } from "./timing.ts";
import { healthRoutes } from "../modules/health/routes.ts";
import { createAuthService } from "../modules/auth/service.ts";
import { authRoutes } from "../modules/auth/routes.ts";

export interface AppDeps {
  env: Env;
  log: Logger;
  db?: Db;
  redis?: Redis;
  /** How emails leave the API (queue in production, memory in tests). Needed for auth routes. */
  mailer?: Mailer;
}

const PREFIX = "/api/v1";

/** Builds the Express app. Kept separate from start-up so tests can use supertest. */
export function buildApp(deps: AppDeps): Express {
  const { env, log } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const redisStore = (prefix: string) =>
    new RedisStore({ prefix, sendCommand: (command: string, ...args: string[]) => deps.redis!.call(command, ...args) as Promise<RedisReply> });

  app.use(pinoHttp({ logger: log, genReqId: (req) => (req.headers["x-request-id"] as string) || crypto.randomUUID() }));
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      // If Redis is down, let requests through (and /ready reports it) instead of failing every request.
      passOnStoreError: true,
      ...(deps.redis ? { store: redisStore("rl:global:") } : {}),
    }),
  );
  app.use(routeTiming(log));

  // Routes. Feature modules are added here as they are built.
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer", bearerFormat: "JWT" });
  const ctx: MountContext = { db: deps.db, appSecret: env.APP_SECRET, ...(deps.redis ? { makeStore: redisStore } : {}) };
  const v1 = express.Router();
  mountRoutes(v1, registry, PREFIX, healthRoutes({ db: deps.db, redis: deps.redis, log, showErrors: env.NODE_ENV !== "production" }), ctx);
  if (deps.db && deps.mailer) {
    const service = createAuthService({ db: deps.db, mailer: deps.mailer, env });
    mountRoutes(v1, registry, PREFIX, authRoutes({ service, cookieSecure: env.COOKIE_SECURE }), ctx);
  }
  app.use(PREFIX, v1);

  if (env.NODE_ENV !== "production") {
    const doc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
      openapi: "3.0.3",
      info: { title: "Cyrus API", version: "0.1.0", description: "See BACKEND-DESIGN.md for the full design." },
    });
    app.get("/api/openapi.json", (_req, res) => void res.json(doc));
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(doc));
  }

  app.use(notFound);
  app.use(errorHandler(log));
  return app;
}
