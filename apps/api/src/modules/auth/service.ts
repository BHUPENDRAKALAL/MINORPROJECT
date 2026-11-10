import type { Role } from "@cyrus/shared";
import type { Env } from "../../config/env.ts";
import type { Db } from "../../lib/db.ts";
import type { Mailer } from "../../lib/mail.ts";
import { audit } from "../../lib/audit.ts";
import {
  DUMMY_PASSWORD_HASH,
  generateOtp,
  hashPassword,
  keyedHash,
  randomToken,
  safeEqualHex,
  sha256,
  verifyPassword,
} from "../../lib/crypto.ts";
import { signAccessToken } from "../../lib/tokens.ts";
import { ApiError } from "../../http/errors.ts";
import { Prisma, type OtpPurpose } from "../../generated/prisma/client.ts";

export interface AuthDeps {
  db: Db;
  mailer: Mailer;
  env: Pick<Env, "APP_SECRET" | "ACCESS_TOKEN_MINUTES" | "REFRESH_TOKEN_DAYS" | "WEB_APP_URL">;
}

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: { id: string; email: string; name: string | null; roles: Role[] };
}

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const INVITE_DAYS = 7;

export const normEmail = (e: string) => e.trim().toLowerCase();
export const normRoll = (r: string) => r.trim().toUpperCase().replace(/\s+/g, "");

function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export function createAuthService(deps: AuthDeps) {
  const { db, mailer, env } = deps;

  const otpHash = (purpose: OtpPurpose, email: string, code: string) => keyedHash(env.APP_SECRET, `otp:${purpose}`, `${email}:${code}`);

  async function activeRoles(userId: string): Promise<Role[]> {
    const now = new Date();
    const grants = await db.roleGrant.findMany({ where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
    return grants.map((g) => g.role as Role);
  }

  async function issueSession(userId: string, meta: ClientMeta): Promise<IssuedTokens> {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true } });
    const roles = await activeRoles(userId);
    const refreshToken = randomToken();
    const refreshTokenExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);
    const session = await db.session.create({
      data: { userId, tokenHash: sha256(refreshToken), expiresAt: refreshTokenExpiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) },
    });
    const accessToken = await signAccessToken(env.APP_SECRET, { sub: userId, sid: session.id, roles }, env.ACCESS_TOKEN_MINUTES);
    return { accessToken, accessTokenExpiresIn: env.ACCESS_TOKEN_MINUTES * 60, refreshToken, refreshTokenExpiresAt, user: { ...user, roles } };
  }

  /** Creates a fresh code (older unused codes stop working) and emails it. */
  async function issueOtp(email: string, purpose: OtpPurpose): Promise<void> {
    const code = generateOtp();
    await db.$transaction([
      db.emailOtp.updateMany({ where: { email, purpose, consumedAt: null }, data: { expiresAt: new Date() } }),
      db.emailOtp.create({ data: { email, purpose, codeHash: otpHash(purpose, email, code), expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000) } }),
    ]);
    const what = purpose === "PASSWORD_RESET" ? "reset your password" : "confirm your email";
    await mailer.send({
      to: email,
      subject: `Your Cyrus code: ${code}`,
      text: `Use this code to ${what}: ${code}\n\nIt expires in ${OTP_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
    });
  }

  async function consumeOtp(email: string, purpose: OtpPurpose, code: string): Promise<void> {
    const otp = await db.emailOtp.findFirst({
      where: { email, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) throw new ApiError(400, "CODE_EXPIRED", "This code has expired. Ask for a new one.");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Too many wrong codes. Ask for a new one.");
    if (!safeEqualHex(otp.codeHash, otpHash(purpose, email, code))) {
      const updated = await db.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      const left = Math.max(0, OTP_MAX_ATTEMPTS - updated.attempts);
      throw new ApiError(400, "CODE_WRONG", left ? `That code is not right. ${left} tries left.` : "Too many wrong codes. Ask for a new one.");
    }
    await db.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  }

  async function recentlySent(email: string, purpose: OtpPurpose): Promise<boolean> {
    const last = await db.emailOtp.findFirst({ where: { email, purpose }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    return !!last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000;
  }

  return {
    /** Student signup → account + profile + email code. The profile is filled and verified later. */
    async signupStudent(input: { email: string; password: string; rollNo: string; name: string; branch: string; batch: number }) {
      const email = normEmail(input.email);
      const rollNo = normRoll(input.rollNo);
      const [emailTaken, rollTaken] = await Promise.all([
        db.user.findUnique({ where: { email }, select: { id: true } }),
        db.studentProfile.findUnique({ where: { rollNo }, select: { id: true } }),
      ]);
      if (emailTaken) {
        throw new ApiError(409, "EMAIL_TAKEN", "This email already has an account. Sign in, or ask for a new code if you haven't confirmed it yet.");
      }
      if (rollTaken) {
        throw new ApiError(409, "ROLL_TAKEN", "This roll number already has an account. If it isn't yours, contact the placement cell.");
      }
      const passwordHash = await hashPassword(input.password);
      try {
        await db.$transaction(async (tx) => {
          const user = await tx.user.create({ data: { email, passwordHash, name: input.name.trim() } });
          await tx.roleGrant.create({ data: { userId: user.id, role: "STUDENT", capabilities: [] } });
          const profile = await tx.studentProfile.create({
            data: { userId: user.id, rollNo, name: input.name.trim(), branch: input.branch.trim(), batch: input.batch },
          });
          await audit(tx, { actorId: user.id, action: "student.signed_up", entityType: "StudentProfile", entityId: profile.id, after: { rollNo, email } });
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new ApiError(409, "ALREADY_REGISTERED", "This email or roll number was just registered. Try signing in.");
        throw e;
      }
      await issueOtp(email, "STUDENT_SIGNUP");
      return { email, next: "verify-email" as const };
    },

    /** Confirms the email code and signs the student in. */
    async verifySignupEmail(input: { email: string; code: string }, meta: ClientMeta): Promise<IssuedTokens> {
      const email = normEmail(input.email);
      const user = await db.user.findUnique({ where: { email } });
      if (!user) throw new ApiError(400, "CODE_EXPIRED", "This code has expired. Ask for a new one.");
      if (user.emailVerifiedAt) throw new ApiError(409, "ALREADY_VERIFIED", "This email is already confirmed. Please sign in.");
      await consumeOtp(email, "STUDENT_SIGNUP", input.code);
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
        await audit(tx, { actorId: user.id, action: "user.email_verified", entityType: "User", entityId: user.id });
      });
      return issueSession(user.id, meta);
    },

    /** Always answers the same way, so it can't be used to find out which emails exist. */
    async resendSignupCode(input: { email: string }): Promise<void> {
      const email = normEmail(input.email);
      const user = await db.user.findUnique({ where: { email }, select: { emailVerifiedAt: true } });
      if (!user || user.emailVerifiedAt) return;
      if (await recentlySent(email, "STUDENT_SIGNUP")) return;
      await issueOtp(email, "STUDENT_SIGNUP");
    },

    async login(input: { email: string; password: string }, meta: ClientMeta): Promise<IssuedTokens> {
      const email = normEmail(input.email);
      const user = await db.user.findUnique({ where: { email } });
      // Hash even when the user doesn't exist, so response time doesn't reveal it.
      const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!user || !ok) throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is wrong.");
      if (!user.emailVerifiedAt) throw new ApiError(403, "EMAIL_NOT_VERIFIED", "Please confirm your email first. We can send a new code.");
      if (user.status !== "ACTIVE") throw new ApiError(403, "ACCOUNT_NOT_ACTIVE", "This account is paused or blocked. Contact the placement cell.");
      const tokens = await issueSession(user.id, meta);
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await audit(tx, { actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, after: { ip: meta.ip ?? null } });
      });
      return tokens;
    },

    /**
     * Swaps a refresh token for a new pair (rotation). If an already-used token comes back,
     * someone may have copied it: every session of that user is ended.
     */
    async refresh(refreshToken: string, meta: ClientMeta): Promise<IssuedTokens> {
      const session = await db.session.findUnique({ where: { tokenHash: sha256(refreshToken) } });
      if (!session) throw new ApiError(401, "SESSION_ENDED", "Your session has ended. Please sign in again.");
      if (session.revokedAt) {
        await db.$transaction(async (tx) => {
          await tx.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
          await audit(tx, { actorId: null, action: "auth.refresh_reuse_detected", entityType: "User", entityId: session.userId, after: { ip: meta.ip ?? null } });
        });
        throw new ApiError(401, "SESSION_ENDED", "Your session has ended. Please sign in again.");
      }
      if (session.expiresAt < new Date()) throw new ApiError(401, "SESSION_ENDED", "Your session has ended. Please sign in again.");
      const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { status: true } });
      if (user.status !== "ACTIVE") throw new ApiError(403, "ACCOUNT_NOT_ACTIVE", "This account is paused or blocked. Contact the placement cell.");

      const next = await issueSession(session.userId, meta);
      const nextRow = await db.session.findUniqueOrThrow({ where: { tokenHash: sha256(next.refreshToken) }, select: { id: true } });
      // Only one request can retire the old token; a parallel second refresh loses and is treated as reuse.
      const retired = await db.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(), replacedById: nextRow.id } });
      if (retired.count === 0) {
        await db.session.update({ where: { id: nextRow.id }, data: { revokedAt: new Date() } });
        throw new ApiError(401, "SESSION_ENDED", "Your session has ended. Please sign in again.");
      }
      return next;
    },

    async logout(refreshToken: string | undefined, sessionId?: string): Promise<void> {
      if (refreshToken) {
        await db.session.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
      }
      if (sessionId) {
        await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    },

    /** Same answer whether or not the email exists. */
    async forgotPassword(input: { email: string }): Promise<void> {
      const email = normEmail(input.email);
      const user = await db.user.findUnique({ where: { email }, select: { emailVerifiedAt: true, status: true } });
      if (!user || !user.emailVerifiedAt || user.status !== "ACTIVE") return;
      if (await recentlySent(email, "PASSWORD_RESET")) return;
      await issueOtp(email, "PASSWORD_RESET");
    },

    async resetPassword(input: { email: string; code: string; newPassword: string }): Promise<void> {
      const email = normEmail(input.email);
      const user = await db.user.findUnique({ where: { email } });
      if (!user) throw new ApiError(400, "CODE_EXPIRED", "This code has expired. Ask for a new one.");
      await consumeOtp(email, "PASSWORD_RESET", input.code);
      const passwordHash = await hashPassword(input.newPassword);
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await audit(tx, { actorId: user.id, action: "auth.password_reset", entityType: "User", entityId: user.id });
      });
    },

    async changePassword(userId: string, sessionId: string, input: { currentPassword: string; newPassword: string }): Promise<void> {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new ApiError(400, "WRONG_PASSWORD", "Your current password is not right.");
      }
      const passwordHash = await hashPassword(input.newPassword);
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { passwordHash } });
        // Sign out everywhere else; keep this device signed in.
        await tx.session.updateMany({ where: { userId, revokedAt: null, NOT: { id: sessionId } }, data: { revokedAt: new Date() } });
        await audit(tx, { actorId: userId, action: "auth.password_changed", entityType: "User", entityId: userId });
      });
    },

    /**
     * Creates an invite link (HR, interviewer, coordinator, staff, volunteer) and emails it.
     * Used by the admin and company modules. Returns the raw token only so tests can use it.
     */
    async createInvite(input: {
      email: string;
      role: Role;
      invitedById: string;
      companyId?: string;
      capabilities?: string[];
      scope?: Prisma.InputJsonValue;
    }): Promise<{ inviteId: string; token: string }> {
      const email = normEmail(input.email);
      const token = randomToken();
      const invite = await db.$transaction(async (tx) => {
        await tx.invite.updateMany({ where: { email, role: input.role, status: "SENT" }, data: { status: "REVOKED" } });
        const created = await tx.invite.create({
          data: {
            email,
            role: input.role,
            companyId: input.companyId,
            capabilities: input.capabilities ?? [],
            scope: input.scope,
            tokenHash: sha256(token),
            invitedById: input.invitedById,
            expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
          },
        });
        await audit(tx, { actorId: input.invitedById, action: "invite.sent", entityType: "Invite", entityId: created.id, after: { email, role: input.role } });
        return created;
      });
      await mailer.send({
        to: email,
        subject: "You're invited to Cyrus",
        text: `You've been invited to Cyrus as ${input.role.replace("_", " ").toLowerCase()}.\n\nOpen this link to set your password (valid for ${INVITE_DAYS} days):\n${env.WEB_APP_URL}/invite/${token}`,
      });
      return { inviteId: invite.id, token };
    },

    async getInvite(token: string) {
      const invite = await db.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { company: { select: { name: true } } } });
      if (!invite || invite.status !== "SENT" || invite.expiresAt < new Date()) {
        throw new ApiError(410, "INVITE_INVALID", "This invite link has expired or was already used. Ask for a new one.");
      }
      const existing = await db.user.findUnique({ where: { email: invite.email }, select: { id: true } });
      return { email: invite.email, role: invite.role as Role, companyName: invite.company?.name ?? null, hasAccount: !!existing };
    },

    /** New person: creates the account. Existing account: adds the role (password must match). */
    async acceptInvite(token: string, input: { name?: string; password: string }, meta: ClientMeta): Promise<IssuedTokens> {
      const invite = await db.invite.findUnique({ where: { tokenHash: sha256(token) } });
      if (!invite || invite.status !== "SENT" || invite.expiresAt < new Date()) {
        throw new ApiError(410, "INVITE_INVALID", "This invite link has expired or was already used. Ask for a new one.");
      }
      const user = await db.user.findUnique({ where: { email: invite.email } });
      if (user) {
        if (!(await verifyPassword(input.password, user.passwordHash))) {
          throw new ApiError(400, "WRONG_PASSWORD", "This email already has an account. Enter that account's password to accept.");
        }
      }
      const passwordHash = user ? null : await hashPassword(input.password);
      const userId = await db.$transaction(async (tx) => {
        const u =
          user ??
          (await tx.user.create({
            data: { email: invite.email, passwordHash, name: input.name?.trim() || null, emailVerifiedAt: new Date() },
          }));
        await tx.roleGrant.upsert({
          where: { userId_role: { userId: u.id, role: invite.role } },
          create: { userId: u.id, role: invite.role, capabilities: invite.capabilities, scope: invite.scope ?? undefined, grantedById: invite.invitedById },
          update: { capabilities: invite.capabilities, scope: invite.scope ?? undefined, expiresAt: null, grantedById: invite.invitedById },
        });
        if (invite.companyId && (invite.role === "COMPANY_HR" || invite.role === "INTERVIEWER")) {
          const role = invite.role === "COMPANY_HR" ? "HR" : "INTERVIEWER";
          await tx.companyMember.upsert({
            where: { companyId_userId: { companyId: invite.companyId, userId: u.id } },
            create: { companyId: invite.companyId, userId: u.id, role, invitedById: invite.invitedById },
            update: { role, active: true },
          });
        }
        const accepted = await tx.invite.updateMany({ where: { id: invite.id, status: "SENT" }, data: { status: "ACCEPTED", acceptedAt: new Date(), userId: u.id } });
        if (accepted.count === 0) throw new ApiError(410, "INVITE_INVALID", "This invite link was already used.");
        await audit(tx, { actorId: u.id, action: "invite.accepted", entityType: "Invite", entityId: invite.id, after: { role: invite.role } });
        return u.id;
      });
      return issueSession(userId, meta);
    },

    async me(userId: string) {
      const user = await db.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          pledgeAcceptedAt: true,
          student: { select: { id: true, rollNo: true, branch: true, batch: true, status: true, placementStatus: true } },
          companyMembers: { where: { active: true }, select: { role: true, company: { select: { id: true, name: true, status: true } } } },
        },
      });
      const roles = await activeRoles(userId);
      return { ...user, createdAt: (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true } })).createdAt, roles };
    },

    /** The name shown to others. A student's name also changes on their student record. */
    async updateMe(userId: string, input: { name: string }) {
      const name = input.name.trim();
      await db.$transaction(async (tx) => {
        const before = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
        await tx.user.update({ where: { id: userId }, data: { name } });
        await tx.studentProfile.updateMany({ where: { userId }, data: { name } });
        await audit(tx, { actorId: userId, action: "account.name_changed", entityType: "User", entityId: userId, before: { name: before.name }, after: { name } });
      });
      return this.me(userId);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
