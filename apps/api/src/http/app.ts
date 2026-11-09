import express, { type Express } from "express";
import { createHash } from "node:crypto";
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
import { clientIpKey, mountRoutes, type MountContext } from "./define-route.ts";
import { routeTiming } from "./timing.ts";
import { healthRoutes } from "../modules/health/routes.ts";
import { createAuthService } from "../modules/auth/service.ts";
import { authRoutes } from "../modules/auth/routes.ts";
import type { Storage } from "../lib/storage.ts";
import type { Enqueue } from "../lib/enqueue.ts";
import { createFilesService } from "../modules/files/service.ts";
import { filesRoutes } from "../modules/files/routes.ts";
import { createStudentsService } from "../modules/students/service.ts";
import { studentRoutes } from "../modules/students/routes.ts";
import { createReviewService } from "../modules/review/service.ts";
import { reviewRoutes } from "../modules/review/routes.ts";
import { teamRoutes } from "../modules/team/routes.ts";
import { createDrivesService } from "../modules/drives/service.ts";
import { driveRoutes } from "../modules/drives/routes.ts";
import { createRoundsService } from "../modules/rounds/service.ts";
import { roundRoutes } from "../modules/rounds/routes.ts";
import { createInterviewsService } from "../modules/interviews/service.ts";
import { interviewRoutes } from "../modules/interviews/routes.ts";
import { createOffersService } from "../modules/offers/service.ts";
import { offerRoutes } from "../modules/offers/routes.ts";
import { notificationRoutes } from "../modules/notifications/routes.ts";

export interface AppDeps {
  env: Env;
  log: Logger;
  db?: Db;
  redis?: Redis;
  /** Connection used by the rate limiters (see RedisMode "limits"). Falls back to `redis`. */
  limitsRedis?: Redis;
  /** How emails leave the API (queue in production, memory in tests). Needed for auth routes. */
  mailer?: Mailer;
  /** Private file storage (S3-compatible; memory in tests). Needed for uploads and reviews. */
  storage?: Storage;
  /** Hands background jobs to the workers (queues in production, a recorder in tests). */
  enqueue?: Enqueue;
  /** Tests can fix the "random" spot-check roll. */
  random?: () => number;
  /** Tests can fix the clock (rotating check-in QR). */
  now?: () => number;
}

const PREFIX = "/api/v1";

/** Rate-limit bucket: a hash of the bearer token when there is one (one per session), else the client IP. */
export function globalLimitKey(req: express.Request): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && auth.length > 20) return `s:${createHash("sha256").update(auth.slice(7)).digest("base64url").slice(0, 22)}`;
  return `ip:${clientIpKey(req)}`;
}

/** Builds the Express app. Kept separate from start-up so tests can use supertest. */
export function buildApp(deps: AppDeps): Express {
  const { env, log } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const limits = deps.limitsRedis ?? deps.redis;
  const redisStore = (prefix: string) =>
    new RedisStore({ prefix, sendCommand: (command: string, ...args: string[]) => limits!.call(command, ...args) as Promise<RedisReply> });

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
      // Signed-in requests count per session, not per IP: a whole campus shares one public IP on
      // college Wi-Fi, and on drive day hundreds of students would otherwise share one bucket.
      // Anonymous requests (sign-in, sign-up…) still count per IP.
      keyGenerator: globalLimitKey,
      // If Redis is down, let requests through (and /ready reports it) instead of failing every request.
      passOnStoreError: true,
      ...(deps.redis ? { store: redisStore("rl:global:") } : {}),
    }),
  );
  app.use(routeTiming(log));

  // Routes. Feature modules are added here as they are built.
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer", bearerFormat: "JWT" });
  const routeLimits = !(env.ROUTE_LIMITS === "off" && env.NODE_ENV !== "production");
  if (!routeLimits) log.warn("Per-route rate limits are OFF (ROUTE_LIMITS=off). Only for automated tests in development.");
  const ctx: MountContext = { db: deps.db, appSecret: env.APP_SECRET, routeLimits, ...(deps.redis ? { makeStore: redisStore } : {}) };
  const v1 = express.Router();
  mountRoutes(v1, registry, PREFIX, healthRoutes({ db: deps.db, redis: deps.redis, log, showErrors: env.NODE_ENV !== "production" }), ctx);
  if (deps.db && deps.mailer) {
    const service = createAuthService({ db: deps.db, mailer: deps.mailer, env });
    mountRoutes(v1, registry, PREFIX, authRoutes({ service, cookieSecure: env.COOKIE_SECURE }), ctx);
    mountRoutes(v1, registry, PREFIX, teamRoutes(deps.db, service), ctx);
    const interviews = createInterviewsService({ db: deps.db, mailer: deps.mailer, env, now: deps.now });
    const offers = deps.storage ? createOffersService({ db: deps.db, mailer: deps.mailer, storage: deps.storage, env, now: deps.now }) : null;
    mountRoutes(v1, registry, PREFIX, driveRoutes(createDrivesService({ db: deps.db, mailer: deps.mailer, env, myLine: interviews.myLine, myOffer: offers?.mine })), ctx);
    if (offers) mountRoutes(v1, registry, PREFIX, offerRoutes(offers), ctx);
    mountRoutes(v1, registry, PREFIX, notificationRoutes(deps.db, env.WEB_APP_URL), ctx);
    mountRoutes(v1, registry, PREFIX, roundRoutes(createRoundsService({ db: deps.db, mailer: deps.mailer, env, now: deps.now })), ctx);
    mountRoutes(v1, registry, PREFIX, interviewRoutes(interviews, service, deps.db), ctx);
    if (deps.storage && deps.enqueue) {
      const files = createFilesService({ db: deps.db, storage: deps.storage, enqueue: deps.enqueue });
      mountRoutes(v1, registry, PREFIX, filesRoutes(files, env.UPLOAD_MAX_MB), ctx);
      mountRoutes(v1, registry, PREFIX, studentRoutes(createStudentsService({ db: deps.db })), ctx);
      const review = createReviewService({ db: deps.db, mailer: deps.mailer, storage: deps.storage, env, random: deps.random });
      mountRoutes(v1, registry, PREFIX, reviewRoutes(review), ctx);
    }
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
