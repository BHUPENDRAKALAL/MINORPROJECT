import type { Request } from "express";
import type { Capability, Role } from "@cyrus/shared";
import type { Db } from "../lib/db.ts";
import { verifyAccessToken } from "../lib/tokens.ts";
import { ApiError } from "./errors.ts";

export interface ActiveGrant {
  role: Role;
  capabilities: Capability[];
  scope: unknown;
}

/** Who is calling. Built once per request, only for routes that need it. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  roles: Role[];
  grants: ActiveGrant[];
  has(role: Role): boolean;
  can(capability: Capability): boolean;
}

/**
 * Who may call a route (every route must say):
 *  - "public"        anyone
 *  - "authenticated" any signed-in, active account
 *  - { roles }       signed in with at least one of these roles
 *  - { capabilities } signed in with a grant that has at least one of these capabilities
 * Ownership (e.g. "only this company's drives") is checked in the service, not here.
 */
export type Access = "public" | "authenticated" | { roles?: Role[]; capabilities?: Capability[] };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

/**
 * Checks the access token, then the database: the session must not be revoked and
 * the account must be active, so blocking a user takes effect immediately.
 */
export async function loadAuth(req: Request, db: Db, appSecret: string): Promise<AuthContext> {
  const token = bearer(req);
  if (!token) throw new ApiError(401, "NOT_SIGNED_IN", "Please sign in.");
  const claims = await verifyAccessToken(appSecret, token);
  if (!claims) throw new ApiError(401, "TOKEN_INVALID", "Your session has expired. Please sign in again.");

  const session = await db.session.findUnique({
    where: { id: claims.sid },
    select: { revokedAt: true, expiresAt: true, user: { select: { id: true, email: true, status: true, roles: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.id !== claims.sub) {
    throw new ApiError(401, "SESSION_ENDED", "Your session has ended. Please sign in again.");
  }
  if (session.user.status !== "ACTIVE") {
    throw new ApiError(403, "ACCOUNT_NOT_ACTIVE", "This account is paused or blocked. Contact the placement cell.");
  }
  const now = new Date();
  const grants: ActiveGrant[] = session.user.roles
    .filter((g) => !g.expiresAt || g.expiresAt > now)
    .map((g) => ({ role: g.role as Role, capabilities: g.capabilities as Capability[], scope: g.scope }));
  const roles = grants.map((g) => g.role);
  return {
    userId: session.user.id,
    sessionId: claims.sid,
    email: session.user.email,
    roles,
    grants,
    has: (role) => roles.includes(role),
    can: (cap) => roles.includes("TPO") || grants.some((g) => g.capabilities.includes(cap)),
  };
}

export function checkAccess(auth: AuthContext, access: Exclude<Access, "public" | "authenticated">): void {
  const roleOk = !access.roles?.length || access.roles.some((r) => auth.has(r));
  const capOk = !access.capabilities?.length || access.capabilities.some((c) => auth.can(c));
  if (!roleOk || !capOk) throw new ApiError(403, "FORBIDDEN", "You don't have permission to do this.");
}
