import type { Request, Response } from "express";
import { z } from "zod";
import { ROLES } from "@cyrus/shared";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import { ApiError } from "../../http/errors.ts";
import { normEmail, type AuthService, type ClientMeta, type IssuedTokens } from "./service.ts";

export interface AuthRouteOptions {
  service: AuthService;
  cookieSecure: boolean;
}

/** Refresh token cookie: httpOnly so page scripts can't read it, sent only to /api/v1/auth. */
const REFRESH_COOKIE = "cy_refresh";
const COOKIE_PATH = "/api/v1/auth";

// ── Shared field rules ──
const Email = z.string().trim().email("Enter a valid email address.").max(254);
const Password = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "Use at most 128 characters.")
  .refine((p) => !/^\d+$/.test(p), "Don't use only numbers.");
const Code = z.string().trim().regex(/^\d{6}$/, "The code has 6 digits.");
const RollNo = z
  .string()
  .trim()
  .min(4)
  .max(20)
  .regex(/^[A-Za-z0-9 ]+$/, "Roll number can only have letters and digits.");

const TokensBody = z.object({
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().describe("seconds"),
  refreshToken: z.string().optional().describe("Only when the request sends x-refresh-delivery: body (Tauri app)"),
  user: z.object({ id: z.string(), email: z.string(), name: z.string().nullable(), roles: z.array(z.enum(ROLES)) }),
});
const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });

function meta(req: Request): ClientMeta {
  return { ip: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

/** The web app keeps the refresh token in a cookie; the Tauri app asks for it in the body instead. */
function sendTokens(req: Request, res: Response, tokens: IssuedTokens, cookieSecure: boolean) {
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: COOKIE_PATH,
    expires: tokens.refreshTokenExpiresAt,
  });
  const wantsBody = req.get("x-refresh-delivery") === "body";
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
    ...(wantsBody ? { refreshToken: tokens.refreshToken } : {}),
    user: tokens.user,
  };
}

function readRefresh(req: Request, bodyToken?: string): string | undefined {
  return bodyToken || (req.cookies?.[REFRESH_COOKIE] as string | undefined);
}

/** Combined with the client IP by the limiter: limits tries per email from one network. */
const byEmail = (req: Request) => (typeof req.body?.email === "string" ? normEmail(req.body.email) : "");

export function authRoutes({ service, cookieSecure }: AuthRouteOptions): RouteDef[] {
  return [
    defineRoute({
      method: "post",
      path: "/auth/student/signup",
      routeClass: "BACKGROUND",
      access: "public",
      summary: "Create a student account and email a 6-digit code",
      tags: ["auth"],
      limit: { windowMs: 60 * 60_000, max: 10 },
      request: {
        body: z.object({
          email: Email,
          password: Password,
          rollNo: RollNo,
          name: z.string().trim().min(2).max(100),
          branch: z.string().trim().min(2).max(60),
          batch: z.coerce.number().int().min(2020).max(2040).describe("Graduation year"),
        }),
      },
      responses: {
        201: { description: "Account created, code sent", schema: z.object({ email: z.string(), next: z.literal("verify-email") }) },
        409: { description: "Email or roll number already registered", schema: ErrorBody },
      },
      handler: async ({ body, res }) => {
        res.status(201);
        return service.signupStudent(body);
      },
    }),

    defineRoute({
      method: "post",
      path: "/auth/student/verify-email",
      routeClass: "LIGHT",
      access: "public",
      summary: "Confirm the signup code and sign in",
      tags: ["auth"],
      limit: { windowMs: 15 * 60_000, max: 20, key: byEmail },
      request: { body: z.object({ email: Email, code: Code }) },
      responses: { 200: { description: "Signed in", schema: TokensBody }, 400: { description: "Wrong or expired code", schema: ErrorBody } },
      handler: async ({ body, req, res }) => sendTokens(req, res, await service.verifySignupEmail(body, meta(req)), cookieSecure),
    }),

    defineRoute({
      method: "post",
      path: "/auth/student/resend-code",
      routeClass: "BACKGROUND",
      access: "public",
      summary: "Send a new signup code (same answer whether or not the email exists)",
      tags: ["auth"],
      limit: { windowMs: 10 * 60_000, max: 5, key: byEmail },
      request: { body: z.object({ email: Email }) },
      responses: { 202: { description: "If the email is waiting for confirmation, a new code was sent" } },
      handler: async ({ body, res }) => {
        await service.resendSignupCode(body);
        res.status(202).end();
      },
    }),

    defineRoute({
      method: "post",
      path: "/auth/login",
      routeClass: "LIGHT",
      access: "public",
      summary: "Sign in with email and password",
      tags: ["auth"],
      limit: { windowMs: 15 * 60_000, max: 10, key: byEmail },
      request: { body: z.object({ email: Email, password: z.string().min(1).max(128) }) },
      responses: {
        200: { description: "Signed in", schema: TokensBody },
        401: { description: "Wrong email or password", schema: ErrorBody },
        403: { description: "Email not confirmed, or account blocked", schema: ErrorBody },
      },
      handler: async ({ body, req, res }) => sendTokens(req, res, await service.login(body, meta(req)), cookieSecure),
    }),

    defineRoute({
      method: "post",
      path: "/auth/refresh",
      routeClass: "LIGHT",
      access: "public",
      summary: "Get a new access token (refresh token from the cookie, or the body for the app)",
      tags: ["auth"],
      limit: { windowMs: 60_000, max: 30 },
      request: { body: z.object({ refreshToken: z.string().optional() }).optional() },
      responses: { 200: { description: "New tokens", schema: TokensBody }, 401: { description: "Session ended", schema: ErrorBody } },
      handler: async ({ body, req, res }) => {
        const token = readRefresh(req, body?.refreshToken);
        if (!token) throw new ApiError(401, "SESSION_ENDED", "Your session has ended. Please sign in again.");
        return sendTokens(req, res, await service.refresh(token, meta(req)), cookieSecure);
      },
    }),

    defineRoute({
      method: "post",
      path: "/auth/logout",
      routeClass: "LIGHT",
      access: "public",
      summary: "Sign out on this device",
      tags: ["auth"],
      request: { body: z.object({ refreshToken: z.string().optional() }).optional() },
      responses: { 204: { description: "Signed out" } },
      handler: async ({ body, req, res }) => {
        await service.logout(readRefresh(req, body?.refreshToken));
        res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
        res.status(204).end();
      },
    }),

    defineRoute({
      method: "post",
      path: "/auth/password/forgot",
      routeClass: "BACKGROUND",
      access: "public",
      summary: "Email a password reset code (same answer whether or not the email exists)",
      tags: ["auth"],
      limit: { windowMs: 15 * 60_000, max: 5, key: byEmail },
      request: { body: z.object({ email: Email }) },
      responses: { 202: { description: "If the account exists, a code was sent" } },
      handler: async ({ body, res }) => {
        await service.forgotPassword(body);
        res.status(202).end();
      },
    }),

    defineRoute({
      method: "post",
      path: "/auth/password/reset",
      routeClass: "LIGHT",
      access: "public",
      summary: "Set a new password with the emailed code (signs out everywhere)",
      tags: ["auth"],
      limit: { windowMs: 15 * 60_000, max: 10, key: byEmail },
      request: { body: z.object({ email: Email, code: Code, newPassword: Password }) },
      responses: { 204: { description: "Password changed" }, 400: { description: "Wrong or expired code", schema: ErrorBody } },
      handler: async ({ body, res }) => {
        await service.resetPassword(body);
        res.status(204).end();
      },
    }),

    defineRoute({
      method: "get",
      path: "/auth/invites/:token",
      routeClass: "LIGHT",
      access: "public",
      summary: "Check an invite link",
      tags: ["auth"],
      limit: { windowMs: 15 * 60_000, max: 30 },
      request: { params: z.object({ token: z.string().min(20).max(100) }) },
      responses: {
        200: {
          description: "Invite details",
          schema: z.object({ email: z.string(), role: z.enum(ROLES), companyName: z.string().nullable(), hasAccount: z.boolean() }),
        },
        410: { description: "Expired or used", schema: ErrorBody },
      },
      handler: ({ params }) => service.getInvite(params.token),
    }),

    defineRoute({
      method: "post",
      path: "/auth/invites/:token/accept",
      routeClass: "LIGHT",
      access: "public",
      summary: "Accept an invite: set a password (new account) or confirm the existing one",
      tags: ["auth"],
      limit: { windowMs: 15 * 60_000, max: 10 },
      request: {
        params: z.object({ token: z.string().min(20).max(100) }),
        body: z.object({ name: z.string().trim().min(2).max(100).optional(), password: Password }),
      },
      responses: { 200: { description: "Signed in", schema: TokensBody }, 410: { description: "Expired or used", schema: ErrorBody } },
      handler: async ({ params, body, req, res }) => sendTokens(req, res, await service.acceptInvite(params.token, body, meta(req)), cookieSecure),
    }),

    defineRoute({
      method: "get",
      path: "/me",
      routeClass: "LIGHT",
      access: "authenticated",
      summary: "Who am I: roles, student profile summary, companies",
      tags: ["auth"],
      responses: { 200: { description: "Current user" }, 401: { description: "Not signed in", schema: ErrorBody } },
      handler: ({ auth }) => service.me(auth.userId),
    }),

    defineRoute({
      method: "patch",
      path: "/me/password",
      routeClass: "LIGHT",
      access: "authenticated",
      summary: "Change password (signs out other devices)",
      tags: ["auth"],
      limit: { windowMs: 15 * 60_000, max: 10 },
      request: { body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: Password }) },
      responses: { 204: { description: "Changed" }, 400: { description: "Current password wrong", schema: ErrorBody } },
      handler: async ({ body, auth, res }) => {
        await service.changePassword(auth.userId, auth.sessionId, body);
        res.status(204).end();
      },
    }),
  ];
}
