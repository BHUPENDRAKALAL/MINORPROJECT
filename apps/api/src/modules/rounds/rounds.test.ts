import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Capability, Role } from "@cyrus/shared";
import { hashPassword } from "../../lib/crypto.ts";
import { hasTestDb, resetDb, testApp, testDb } from "../../../test/helpers.ts";
import { distanceM, parseCsv, parseResultWord } from "./service.ts";

type T = ReturnType<typeof testApp>;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
let seq = 0;

/** A movable clock for the rotating QR. */
const clock = { t: Date.now() };

async function account(t: T, email: string, roles: Role[], capabilities: Capability[] = []) {
  const user = await t.db.user.create({ data: { email, passwordHash: await hashPassword("round-pass-123"), emailVerifiedAt: new Date(), pledgeAcceptedAt: new Date() } });
  for (const role of roles) await t.db.roleGrant.create({ data: { userId: user.id, role, capabilities } });
  const res = await request(t.app).post("/api/v1/auth/login").send({ email, password: "round-pass-123" }).expect(200);
  return { userId: user.id, token: res.body.accessToken as string };
}

async function student(t: T, cgpa = 8) {
  const n = ++seq;
  const a = await account(t, `r${n}@example.com`, ["STUDENT"]);
  const p = await t.db.studentProfile.create({
    data: { userId: a.userId, rollNo: `24UCSE8${String(n).padStart(3, "0")}`, name: `Student ${n}`, branch: "CSE", batch: 2027, status: "VERIFIED", cgpa, activeBacklogs: 0, tenthPercent: 80, twelfthPercent: 80 },
  });
  return { ...a, profileId: p.id, rollNo: p.rollNo };
}

describe("round helpers", () => {
  it("reads result words and CSV, and measures distance", () => {
    expect(parseResultWord(" Qualified ")).toBe("SELECTED");
    expect(parseResultWord("FAIL")).toBe("REJECTED");
    expect(parseResultWord("on hold")).toBe("ON_HOLD");
    expect(parseResultWord("maybe")).toBeNull();
    expect(parseCsv('Roll,Result\n"24UCSE1","pass, with ""note"""\n\n')).toEqual([["Roll", "Result"], ["24UCSE1", 'pass, with "note"']]);
    // MBM main gate to ~110 m east
    expect(distanceM({ lat: 26.2697, lng: 73.0352 }, { lat: 26.2697, lng: 73.0363 })).toBeGreaterThan(100);
    expect(distanceM({ lat: 26.2697, lng: 73.0352 }, { lat: 26.2697, lng: 73.0352 })).toBe(0);
  });
});

describe.skipIf(!hasTestDb)("rounds: start, check-in, results, publish (database)", () => {
  beforeEach(async () => {
    await resetDb(testDb());
    clock.t = Date.now();
  });
  afterAll(async () => {
    await testDb().$disconnect();
  });

  /** A published drive with OA (online) → Technical (on campus, venue location) → HR; three students joined, one only invited. */
  async function setup() {
    const t = testApp({ now: () => clock.t });
    const company = await t.db.company.create({ data: { name: "Acme", domain: "acme.example" } });
    const tpo = await account(t, "tpo@college.example", ["TPO"]);
    const hr = await account(t, "hr@acme.example", ["COMPANY_HR"]);
    await t.db.companyMember.create({ data: { companyId: company.id, userId: hr.userId, role: "HR" } });
    const d = await request(t.app)
      .post("/api/v1/drives")
      .set(as(hr.token))
      .send({ roleTitle: "Engineer", description: "Backend services for retail stores, Java and SQL.", jobType: "FULL_TIME", ctcLpa: 10, optInDeadline: inDays(3), eligibility: {} })
      .expect(201);
    const id = d.body.id as string;
    await request(t.app)
      .put(`/api/v1/drives/${id}/rounds`)
      .set(as(hr.token))
      .send({ rounds: [{ type: "OA", title: "Online assessment", mode: "ONLINE" }, { type: "TECHNICAL", title: "Technical round 1", mode: "OFFLINE", venue: "Lab 2" }, { type: "HR", title: "HR round", mode: "OFFLINE" }] })
      .expect(200);
    await request(t.app).post(`/api/v1/drives/${id}/submit`).set(as(hr.token)).expect(200);
    await request(t.app).post(`/api/v1/admin/drives/${id}/approve`).set(as(tpo.token)).expect(200);
    const s = [await student(t, 9), await student(t, 8.5), await student(t, 8), await student(t, 7.5)];
    await request(t.app).post(`/api/v1/drives/${id}/invitations`).set(as(hr.token)).send({ all: true }).expect(200);
    for (const x of s.slice(0, 3)) await request(t.app).post(`/api/v1/me/drives/${id}/opt-in`).set(as(x.token)).send({ consent: true }).expect(200);
    const drive = await request(t.app).get(`/api/v1/drives/${id}`).set(as(hr.token)).expect(200);
    const [oa, tech, hrRound] = drive.body.rounds.map((r: { id: string }) => r.id) as [string, string, string];
    return { t, tpo, hr, id, s, oa, tech, hrRound };
  }

  const pid = (round: { students: { id: string; participationId: string }[] }, profileId: string) => round.students.find((x) => x.id === profileId)!.participationId;

  it("runs a drive from the first round to the final selection", async () => {
    const { t, tpo, hr, id, s, oa, tech, hrRound } = await setup();

    // Rounds go in order
    const blocked = await request(t.app).post(`/api/v1/rounds/${tech}/start`).set(as(hr.token)).expect(409);
    expect(blocked.body.error.message).toContain("earlier rounds");

    // Starting the first round closes joining: the unanswered invite expires
    const started = await request(t.app).post(`/api/v1/rounds/${oa}/start`).set(as(hr.token)).expect(200);
    expect(started.body.status).toBe("IN_PROGRESS");
    expect(started.body.students).toHaveLength(3);
    expect((await t.db.participation.findFirst({ where: { studentId: s[3]!.profileId } }))!.status).toBe("EXPIRED");
    expect((await t.db.drive.findUnique({ where: { id } }))!.status).toBe("ONGOING");
    await request(t.app).post(`/api/v1/me/drives/${id}/opt-in`).set(as(s[3]!.token)).send({ consent: true }).expect(409);

    // OA results from a test platform's CSV
    const csv = `Candidate,Roll Number,Score,Result\nA,${s[0]!.rollNo},88,Qualified\nB,${s[1]!.rollNo},71,Qualified\nC,${s[2]!.rollNo},40,Not qualified\nX,24UXXX0000,99,Qualified\nD,${s[0]!.rollNo},1,maybe`;
    const imp = await request(t.app).post(`/api/v1/rounds/${oa}/results/import`).set(as(hr.token)).send({ csv }).expect(200);
    expect(imp.body.imported).toBe(3);
    expect(imp.body.unknownRolls).toEqual(["24UXXX0000"]);
    expect(imp.body.badValues).toEqual([{ row: 6, value: "maybe" }]);
    expect(imp.body.round.counts).toMatchObject({ pending: 0, selected: 2 });

    // Students don't see results before publishing
    const before = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(s[2]!.token)).expect(200);
    expect(before.body.rounds[0].my.result).toBeNull();

    const pub = await request(t.app).post(`/api/v1/rounds/${oa}/results/publish`).set(as(hr.token)).expect(200);
    expect(pub.body.status).toBe("RESULTS_PUBLISHED");
    const out = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(s[2]!.token)).expect(200);
    expect(out.body.me.status).toBe("ELIMINATED");
    expect(out.body.rounds[0].my).toMatchObject({ result: "REJECTED", out: "NOT_SELECTED" });
    const through = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(s[0]!.token)).expect(200);
    expect(through.body.rounds[0].my.result).toBe("SELECTED");
    expect((await t.db.notification.findFirst({ where: { userId: s[0]!.userId, title: { contains: "cleared Online assessment" } } }))?.body).toContain("Technical round 1");

    // Technical round: on campus, check-in with the rotating QR at the venue
    const techRound = await request(t.app).post(`/api/v1/rounds/${tech}/start`).set(as(hr.token)).expect(200);
    expect(techRound.body.students).toHaveLength(2);
    const venue = { lat: 26.2697, lng: 73.0352 };
    const session = await request(t.app).post(`/api/v1/rounds/${tech}/attendance/sessions`).set(as(hr.token)).send({ ...venue, radiusM: 100 }).expect(200);
    const qr = await request(t.app).get(`/api/v1/attendance/sessions/${session.body.id}/qr`).set(as(hr.token)).expect(200);
    expect(qr.body.url).toContain("/check-in?t=");

    // Wrong place, missing location, outsider, tampered code
    await request(t.app).post("/api/v1/attendance/check-in").set(as(s[0]!.token)).send({ token: qr.body.token }).expect(400);
    const far = await request(t.app).post("/api/v1/attendance/check-in").set(as(s[0]!.token)).send({ token: qr.body.token, lat: 26.28, lng: 73.0352 }).expect(403);
    expect(far.body.error.code).toBe("TOO_FAR");
    await request(t.app).post("/api/v1/attendance/check-in").set(as(s[2]!.token)).send({ token: qr.body.token, ...venue }).expect(403);
    await request(t.app).post("/api/v1/attendance/check-in").set(as(s[0]!.token)).send({ token: qr.body.token.slice(0, -2) + "xx", ...venue }).expect(400);

    const ok = await request(t.app).post("/api/v1/attendance/check-in").set(as(s[0]!.token)).send({ token: qr.body.token, ...venue }).expect(200);
    expect(ok.body).toMatchObject({ checkedIn: true, alreadyCheckedIn: false, round: "Technical round 1" });
    const again = await request(t.app).post("/api/v1/attendance/check-in").set(as(s[0]!.token)).send({ token: qr.body.token, ...venue }).expect(200);
    expect(again.body.alreadyCheckedIn).toBe(true);
    const mine = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(s[0]!.token)).expect(200);
    expect(mine.body.rounds[1].my).toMatchObject({ attended: true, checkInOpen: true });

    // A photo of the code stops working after two windows
    clock.t += 31_000;
    const old = await request(t.app).post("/api/v1/attendance/check-in").set(as(s[1]!.token)).send({ token: qr.body.token, ...venue }).expect(410);
    expect(old.body.error.code).toBe("CODE_EXPIRED");

    // s[1] never checks in. HR can't mark by hand; the TPO can (with a reason) and can undo it
    const v = await request(t.app).get(`/api/v1/rounds/${tech}`).set(as(hr.token)).expect(200);
    const p1 = pid(v.body, s[1]!.profileId);
    await request(t.app).post(`/api/v1/rounds/${tech}/attendance/manual`).set(as(hr.token)).send({ participationId: p1, present: true, reason: "Phone died" }).expect(403);
    await request(t.app).post(`/api/v1/rounds/${tech}/attendance/manual`).set(as(tpo.token)).send({ participationId: p1, present: true, reason: "Phone died" }).expect(200);
    const undone = await request(t.app).post(`/api/v1/rounds/${tech}/attendance/manual`).set(as(tpo.token)).send({ participationId: p1, present: false, reason: "Was not in the room" }).expect(200);
    expect(undone.body.counts.present).toBe(1);

    // Publishing waits for check-in to close
    const open = await request(t.app).post(`/api/v1/rounds/${tech}/results/publish`).set(as(hr.token)).expect(409);
    expect(open.body.error.code).toBe("CHECK_IN_OPEN");
    await request(t.app).post(`/api/v1/attendance/sessions/${session.body.id}/close`).set(as(hr.token)).expect(200);

    // Results: only the present student needs one; on-hold blocks publishing
    const p0 = pid(v.body, s[0]!.profileId);
    await request(t.app).put(`/api/v1/rounds/${tech}/results`).set(as(hr.token)).send({ results: [{ participationId: p0, result: "ON_HOLD" }] }).expect(200);
    const held = await request(t.app).post(`/api/v1/rounds/${tech}/results/publish`).set(as(hr.token)).expect(409);
    expect(held.body.error.code).toBe("ON_HOLD_LEFT");
    await request(t.app).put(`/api/v1/rounds/${tech}/results`).set(as(hr.token)).send({ results: [{ participationId: p0, result: "SELECTED" }] }).expect(200);
    await request(t.app).post(`/api/v1/rounds/${tech}/results/publish`).set(as(hr.token)).expect(200);

    // The absent student is out and their no-show is counted
    const absent = await t.db.participation.findFirst({ where: { studentId: s[1]!.profileId } });
    expect(absent!.status).toBe("NO_SHOW");
    expect((await t.db.studentProfile.findUnique({ where: { id: s[1]!.profileId } }))!.noShowCount).toBe(1);

    // Last round: HR round, selected = selected for the job, drive results declared
    const last = await request(t.app).post(`/api/v1/rounds/${hrRound}/start`).set(as(hr.token)).expect(200);
    expect(last.body.isLast).toBe(true);
    await request(t.app).put(`/api/v1/rounds/${hrRound}/results`).set(as(hr.token)).send({ results: [{ participationId: p0, result: "SELECTED" }] }).expect(200);
    await request(t.app).post(`/api/v1/rounds/${hrRound}/results/publish`).set(as(hr.token)).expect(200);
    expect((await t.db.participation.findFirst({ where: { studentId: s[0]!.profileId } }))!.status).toBe("SELECTED");
    expect((await t.db.drive.findUnique({ where: { id } }))!.status).toBe("RESULTS_DECLARED");
    expect(t.mailer.sent.some((m) => m.to === "r1@example.com" || m.subject.includes("you're selected"))).toBe(true);
  });

  it("guards: other companies, online rounds, results before start, students on office routes", async () => {
    const { t, hr, oa, s } = await setup();
    const other = await t.db.company.create({ data: { name: "Other", domain: "other.example" } });
    const stranger = await account(t, "hr@other.example", ["COMPANY_HR"]);
    await t.db.companyMember.create({ data: { companyId: other.id, userId: stranger.userId, role: "HR" } });
    await request(t.app).get(`/api/v1/rounds/${oa}`).set(as(stranger.token)).expect(404);
    await request(t.app).post(`/api/v1/rounds/${oa}/start`).set(as(stranger.token)).expect(404);
    await request(t.app).get(`/api/v1/rounds/${oa}`).set(as(s[0]!.token)).expect(403);

    const early = await request(t.app).post(`/api/v1/rounds/${oa}/results/import`).set(as(hr.token)).send({ csv: "Roll,Result\nx,pass" }).expect(409);
    expect(early.body.error.message).toContain("Start the round");
    await request(t.app).post(`/api/v1/rounds/${oa}/start`).set(as(hr.token)).expect(200);
    const online = await request(t.app).post(`/api/v1/rounds/${oa}/attendance/sessions`).set(as(hr.token)).send({}).expect(409);
    expect(online.body.error.code).toBe("ONLINE_ROUND");
    const cols = await request(t.app).post(`/api/v1/rounds/${oa}/results/import`).set(as(hr.token)).send({ csv: "Name,Score\nA,10" }).expect(400);
    expect(cols.body.error.code).toBe("COLUMNS_NOT_FOUND");
    const missing = await request(t.app).post(`/api/v1/rounds/${oa}/results/publish`).set(as(hr.token)).expect(409);
    expect(missing.body.error.code).toBe("RESULTS_MISSING");
  });

  it("a staff member with drive-day attendance can run check-in but not results", async () => {
    const { t, hr, tech, oa, s } = await setup();
    const helper = await account(t, "helper@college.example", ["STAFF"], ["drive.attendance"]);
    await request(t.app).post(`/api/v1/rounds/${oa}/start`).set(as(hr.token)).expect(200);
    const v = await request(t.app).get(`/api/v1/rounds/${oa}`).set(as(hr.token)).expect(200);
    await request(t.app)
      .put(`/api/v1/rounds/${oa}/results`)
      .set(as(hr.token))
      .send({ results: s.slice(0, 3).map((x) => ({ participationId: pid(v.body, x.profileId), result: "SELECTED" })) })
      .expect(200);
    await request(t.app).post(`/api/v1/rounds/${oa}/results/publish`).set(as(hr.token)).expect(200);
    await request(t.app).post(`/api/v1/rounds/${tech}/start`).set(as(hr.token)).expect(200);

    const opened = await request(t.app).post(`/api/v1/rounds/${tech}/attendance/sessions`).set(as(helper.token)).send({}).expect(200);
    await request(t.app).get(`/api/v1/attendance/sessions/${opened.body.id}/qr`).set(as(helper.token)).expect(200);
    await request(t.app).put(`/api/v1/rounds/${tech}/results`).set(as(helper.token)).send({ results: [{ participationId: pid(v.body, s[0]!.profileId), result: "SELECTED" }] }).expect(403);
    await request(t.app).post(`/api/v1/attendance/sessions/${opened.body.id}/close`).set(as(helper.token)).expect(200);
  });
});
