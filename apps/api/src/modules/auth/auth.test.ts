import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createAuthService } from "./service.ts";
import { hasTestDb, lastCode, resetDb, testApp, testDb } from "../../../test/helpers.ts";

const student = {
  email: "Asha.Student@Example.com",
  password: "campus-pass-1",
  rollNo: "24ucse4001",
  name: "Asha Verma",
  branch: "CSE",
  batch: 2027,
};
const email = student.email.toLowerCase();

function refreshCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith("cy_refresh="));
  if (!c) throw new Error("no refresh cookie");
  return c.split(";")[0]!;
}

async function signupAndVerify(t: ReturnType<typeof testApp>) {
  await request(t.app).post("/api/v1/auth/student/signup").send(student).expect(201);
  const res = await request(t.app)
    .post("/api/v1/auth/student/verify-email")
    .send({ email, code: lastCode(t.mailer.sent, email) })
    .expect(200);
  return res;
}

describe.skipIf(!hasTestDb)("auth (database)", () => {
  beforeEach(async () => {
    await resetDb(testDb());
  });
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it("signs a student up, confirms the email and returns who they are", async () => {
    const t = testApp();
    const signup = await request(t.app).post("/api/v1/auth/student/signup").send(student).expect(201);
    expect(signup.body).toEqual({ email, next: "verify-email" });
    expect(t.mailer.sent).toHaveLength(1);

    // Can't sign in before confirming the email
    const early = await request(t.app).post("/api/v1/auth/login").send({ email, password: student.password }).expect(403);
    expect(early.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    // Wrong code is refused and counted
    const code = lastCode(t.mailer.sent, email);
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await request(t.app).post("/api/v1/auth/student/verify-email").send({ email, code: wrong }).expect(400);
    expect(bad.body.error.code).toBe("CODE_WRONG");

    const ok = await request(t.app).post("/api/v1/auth/student/verify-email").send({ email, code }).expect(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.refreshToken).toBeUndefined(); // web clients get it only as a cookie
    expect(refreshCookie(ok)).toMatch(/^cy_refresh=/);

    const me = await request(t.app).get("/api/v1/me").set("authorization", `Bearer ${ok.body.accessToken}`).expect(200);
    expect(me.body.roles).toEqual(["STUDENT"]);
    expect(me.body.student.rollNo).toBe("24UCSE4001");
    expect(me.body.student.status).toBe("PROFILE_INCOMPLETE");

    // Password is never stored in plain text
    const user = await t.db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(await t.db.auditLog.count({ where: { action: "student.signed_up" } })).toBe(1);
  });

  it("refuses a second account for the same email or roll number", async () => {
    const t = testApp();
    await request(t.app).post("/api/v1/auth/student/signup").send(student).expect(201);
    const sameEmail = await request(t.app).post("/api/v1/auth/student/signup").send({ ...student, rollNo: "24UCSE4002" }).expect(409);
    expect(sameEmail.body.error.code).toBe("EMAIL_TAKEN");
    const sameRoll = await request(t.app)
      .post("/api/v1/auth/student/signup")
      .send({ ...student, email: "other@example.com", rollNo: " 24UCSE4001 " })
      .expect(409);
    expect(sameRoll.body.error.code).toBe("ROLL_TAKEN");
  });

  it("locks the code after too many wrong tries", async () => {
    const t = testApp();
    await request(t.app).post("/api/v1/auth/student/signup").send(student).expect(201);
    const code = lastCode(t.mailer.sent, email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await request(t.app).post("/api/v1/auth/student/verify-email").send({ email, code: wrong }).expect(400);
    const locked = await request(t.app).post("/api/v1/auth/student/verify-email").send({ email, code }).expect(429);
    expect(locked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("signs in, rotates refresh tokens and ends every session when an old token is reused", async () => {
    const t = testApp();
    await signupAndVerify(t);
    const bad = await request(t.app).post("/api/v1/auth/login").send({ email, password: "wrong-password" }).expect(401);
    expect(bad.body.error.code).toBe("INVALID_CREDENTIALS");

    const login = await request(t.app).post("/api/v1/auth/login").send({ email, password: student.password }).expect(200);
    const first = refreshCookie(login);

    const r1 = await request(t.app).post("/api/v1/auth/refresh").set("cookie", first).expect(200);
    const second = refreshCookie(r1);
    expect(second).not.toBe(first);

    // The first token was already used: treat as stolen, end all sessions
    await request(t.app).post("/api/v1/auth/refresh").set("cookie", first).expect(401);
    await request(t.app).post("/api/v1/auth/refresh").set("cookie", second).expect(401);
    await request(t.app).get("/api/v1/me").set("authorization", `Bearer ${r1.body.accessToken}`).expect(401);
    // Recorded for the reused token (and again for the second token, which was revoked by then)
    expect(await t.db.auditLog.count({ where: { action: "auth.refresh_reuse_detected" } })).toBeGreaterThanOrEqual(1);
  });

  it("gives the app its refresh token in the body when asked", async () => {
    const t = testApp();
    await signupAndVerify(t);
    const login = await request(t.app)
      .post("/api/v1/auth/login")
      .set("x-refresh-delivery", "body")
      .send({ email, password: student.password })
      .expect(200);
    expect(login.body.refreshToken).toBeTruthy();
    const r = await request(t.app).post("/api/v1/auth/refresh").set("x-refresh-delivery", "body").send({ refreshToken: login.body.refreshToken }).expect(200);
    expect(r.body.refreshToken).toBeTruthy();
  });

  it("signs out", async () => {
    const t = testApp();
    const verified = await signupAndVerify(t);
    const cookie = refreshCookie(verified);
    await request(t.app).post("/api/v1/auth/logout").set("cookie", cookie).expect(204);
    await request(t.app).post("/api/v1/auth/refresh").set("cookie", cookie).expect(401);
    await request(t.app).get("/api/v1/me").set("authorization", `Bearer ${verified.body.accessToken}`).expect(401);
  });

  it("resets a forgotten password and ends old sessions", async () => {
    const t = testApp();
    const verified = await signupAndVerify(t);

    // Unknown email: same answer, no email sent
    const before = t.mailer.sent.length;
    await request(t.app).post("/api/v1/auth/password/forgot").send({ email: "nobody@example.com" }).expect(202);
    expect(t.mailer.sent.length).toBe(before);

    await request(t.app).post("/api/v1/auth/password/forgot").send({ email }).expect(202);
    const code = lastCode(t.mailer.sent, email);
    await request(t.app).post("/api/v1/auth/password/reset").send({ email, code, newPassword: "brand-new-pass-2" }).expect(204);

    await request(t.app).get("/api/v1/me").set("authorization", `Bearer ${verified.body.accessToken}`).expect(401);
    await request(t.app).post("/api/v1/auth/login").send({ email, password: student.password }).expect(401);
    await request(t.app).post("/api/v1/auth/login").send({ email, password: "brand-new-pass-2" }).expect(200);
  });

  it("lets an invited HR set a password and join their company, once", async () => {
    const t = testApp();
    const company = await t.db.company.create({ data: { name: "Acme Software", domain: "acme.example" } });
    const tpo = await t.db.user.create({ data: { email: "tpo@mbm.example", emailVerifiedAt: new Date() } });
    const service = createAuthService({ db: t.db, mailer: t.mailer, env: t.env });
    const { token } = await service.createInvite({ email: "hr@acme.example", role: "COMPANY_HR", companyId: company.id, invitedById: tpo.id });
    expect(t.mailer.sent.at(-1)?.text).toContain(`/invite/${token}`);

    const info = await request(t.app).get(`/api/v1/auth/invites/${token}`).expect(200);
    expect(info.body).toMatchObject({ email: "hr@acme.example", role: "COMPANY_HR", companyName: "Acme Software", hasAccount: false });

    const accepted = await request(t.app)
      .post(`/api/v1/auth/invites/${token}/accept`)
      .send({ name: "Riya HR", password: "hr-pass-1234" })
      .expect(200);
    const me = await request(t.app).get("/api/v1/me").set("authorization", `Bearer ${accepted.body.accessToken}`).expect(200);
    expect(me.body.roles).toEqual(["COMPANY_HR"]);
    expect(me.body.companyMembers[0].company.name).toBe("Acme Software");

    await request(t.app).post(`/api/v1/auth/invites/${token}/accept`).send({ password: "hr-pass-1234" }).expect(410);
  });

  it("blocks requests from a paused account right away", async () => {
    const t = testApp();
    const verified = await signupAndVerify(t);
    await request(t.app).get("/api/v1/me").expect(401);
    await t.db.user.update({ where: { email }, data: { status: "BLOCKED" } });
    const res = await request(t.app).get("/api/v1/me").set("authorization", `Bearer ${verified.body.accessToken}`).expect(403);
    expect(res.body.error.code).toBe("ACCOUNT_NOT_ACTIVE");
  });

  it("changes the password and signs out other devices only", async () => {
    const t = testApp();
    const deviceA = await signupAndVerify(t);
    const deviceB = await request(t.app).post("/api/v1/auth/login").send({ email, password: student.password }).expect(200);
    await request(t.app)
      .patch("/api/v1/me/password")
      .set("authorization", `Bearer ${deviceA.body.accessToken}`)
      .send({ currentPassword: student.password, newPassword: "another-pass-3" })
      .expect(204);
    await request(t.app).get("/api/v1/me").set("authorization", `Bearer ${deviceA.body.accessToken}`).expect(200);
    await request(t.app).get("/api/v1/me").set("authorization", `Bearer ${deviceB.body.accessToken}`).expect(401);
  });
});
