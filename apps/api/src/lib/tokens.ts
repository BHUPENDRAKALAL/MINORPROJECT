import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@cyrus/shared";
import { keyedHash } from "./crypto.ts";

export interface AccessClaims {
  /** user id */
  sub: string;
  /** session id (refresh token row) */
  sid: string;
  roles: Role[];
}

const ISSUER = "cyrus";
const AUDIENCE = "cyrus-api";

function signingKey(appSecret: string): Uint8Array {
  // Derived key: the raw app secret is never used directly for JWTs.
  return new TextEncoder().encode(keyedHash(appSecret, "jwt-access", "v1"));
}

export async function signAccessToken(appSecret: string, claims: AccessClaims, minutes: number): Promise<string> {
  return new SignJWT({ sid: claims.sid, roles: claims.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${minutes}m`)
    .sign(signingKey(appSecret));
}

/** Returns the claims, or null if the token is missing, expired or forged. */
export async function verifyAccessToken(appSecret: string, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(appSecret), { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload["sid"] !== "string" || !Array.isArray(payload["roles"])) return null;
    return { sub: payload.sub, sid: payload["sid"] as string, roles: payload["roles"] as Role[] };
  } catch {
    return null;
  }
}
