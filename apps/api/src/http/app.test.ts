import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { loadEnv } from "../config/env.ts";
import { createLogger } from "../lib/logger.ts";
import { buildApp } from "./app.ts";
import { mountRoutes, type RouteDef } from "./define-route.ts";

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://x:y@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  APP_SECRET: "test-secret-test-secret-test-secret-1234",
});
const log = createLogger(env, "test");
const app = buildApp({ env, log });

describe("HTTP app", () => {
  it("answers /api/v1/health with its route class", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.headers["x-route-class"]).toBe("LIGHT");
  });

  it("reports not ready when the database and Redis are missing", async () => {
    const res = await request(app).get("/api/v1/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks.database.ok).toBe(false);
  });

  it("uses the standard error body for unknown routes", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects bad JSON with a clear error", async () => {
    const res = await request(app).post("/api/v1/health").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});

describe("defineRoute", () => {
  it("refuses a route with an invalid weight class", () => {
    const bad = { method: "get", path: "/x", routeClass: "MEDIUM", summary: "", tags: [], responses: {}, handler: () => ({}) };
    expect(() =>
      mountRoutes(express.Router(), new OpenAPIRegistry(), "/api/v1", [bad as unknown as RouteDef], { appSecret: env.APP_SECRET }),
    ).toThrow(/routeClass/);
  });

  it("refuses a route without an access rule", () => {
    const bad = { method: "get", path: "/x", routeClass: "LIGHT", summary: "", tags: [], responses: {}, handler: () => ({}) };
    expect(() =>
      mountRoutes(express.Router(), new OpenAPIRegistry(), "/api/v1", [bad as unknown as RouteDef], { appSecret: env.APP_SECRET }),
    ).toThrow(/access/);
  });
});
