import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Role } from "@cyrus/shared";
import { hashPassword } from "../../lib/crypto.ts";
import { hasTestDb, lastCode, resetDb, testApp, testDb } from "../../../test/helpers.ts";

type T = ReturnType<typeof testApp>;
const PDF = (tag: string) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

async function student(t: T, n: number, over: Partial<{ branch: string; batch: number }> = {}) {
  const email = `student${n}@example.com`;
  await request(t.app)
    .post("/api/v1/auth/student/signup")
    .send({ email, password: "campus-pass-1", rollNo: `24UCSE40${String(n).padStart(2, "0")}`, name: `Student ${n}`, branch: over.branch ?? "CSE", batch: over.batch ?? 2027 })
    .expect(201);
  const res = await request(t.app).post("/api/v1/auth/student/verify-email").send({ email, code: lastCode(t.mailer.sent, email) }).expect(200);
  return { token: res.body.accessToken as string, email };
}

async function member(t: T, email: string, role: Role, capabilities: string[] = [], opts: { pledge?: boolean; scope?: object; alsoStudentOf?: { branch: string; batch: number } } = {}) {
  const user = await t.db.user.create({
    data: { email, passwordHash: await hashPassword("team-pass-123"), emailVerifiedAt: new Date(), pledgeAcceptedAt: opts.pledge === false ? null : new Date() },
  });
  await t.db.roleGrant.create({ data: { userId: user.id, role, capabilities, scope: opts.scope ?? {} } });
  if (opts.alsoStudentOf) {
    await t.db.roleGrant.create({ data: { userId: user.id, role: "STUDENT", capabilities: [] } });
    await t.db.studentProfile.create({ data: { userId: user.id, rollNo: `VOL${Math.floor(Math.random() * 1e6)}`, name: "Volunteer", ...opts.alsoStudentOf } });
  }
  const res = await request(t.app).post("/api/v1/auth/login").send({ email, password: "team-pass-123" }).expect(200);
  return res.body.accessToken as string;
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });

/** Uploads the three required marksheets, saves marks and submits. Returns the student's token. */
async function completeAndSubmit(t: T, n: number, over: Partial<{ branch: string; batch: number }> = {}, pdfTag = `s${n}`) {
  const s = await student(t, n, over);
  const attach = async (type: string, semester?: number, tag = `${pdfTag}-${type}-${semester ?? ""}`) => {
    const up = await request(t.app).post("/api/v1/files?kind=MARKSHEET").set(as(s.token)).attach("file", PDF(tag), `${type}.pdf`).expect(201);
    await request(t.app).post("/api/v1/students/me/documents").set(as(s.token)).send({ fileId: up.body.id, type, semester }).expect(200);
  };
  await attach("MARKSHEET_10");
  await attach("MARKSHEET_12");
  await attach("SEMESTER_MARKSHEET", 5);
  await request(t.app).put("/api/v1/students/me/academics").set(as(s.token)).send({ cgpa: 8.42, activeBacklogs: 0, totalBacklogs: 1, tenthPercent: 91.2, twelfthPercent: 88, semester: 5 }).expect(200);
  const sub = await request(t.app).post("/api/v1/students/me/submit").set(as(s.token)).expect(200);
  expect(sub.body.profile.status).toBe("PENDING_VERIFICATION");
  await t.db.fileObject.updateMany({ data: { scanStatus: "CLEAN" } });
  return s;
}

describe.skipIf(!hasTestDb)("student profile and verification (database)", () => {
  beforeEach(async () => {
    await resetDb(testDb());
  });
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it("lists what's missing, refuses wrong file types and an early submit", async () => {
    const t = testApp();
    const s = await student(t, 1);
    const me = await request(t.app).get("/api/v1/students/me").set(as(s.token)).expect(200);
    expect(me.body.missing).toHaveLength(4);
    expect(me.body.canEdit).toBe(true);

    const bad = await request(t.app).post("/api/v1/files?kind=MARKSHEET").set(as(s.token)).attach("file", Buffer.from("just text"), "marks.pdf").expect(415);
    expect(bad.body.error.code).toBe("FILE_TYPE_NOT_ALLOWED");

    const early = await request(t.app).post("/api/v1/students/me/submit").set(as(s.token)).expect(400);
    expect(early.body.error.code).toBe("PROFILE_INCOMPLETE");
    expect(early.body.error.details.missing.length).toBe(4);
  });

  it("uploads privately, queues a virus scan and only lets the owner and staff open files", async () => {
    const t = testApp();
    const a = await student(t, 1);
    const b = await student(t, 2);
    const up = await request(t.app).post("/api/v1/files?kind=MARKSHEET").set(as(a.token)).attach("file", PDF("a"), "ten.pdf").expect(201);
    expect(up.body.mimeType).toBe("application/pdf");
    expect(t.enqueue.calls).toContainEqual({ queue: "documents", type: "file.scan", data: { fileId: up.body.id } });
    await request(t.app).get(`/api/v1/files/${up.body.id}/link`).set(as(a.token)).expect(200);
    await request(t.app).get(`/api/v1/files/${up.body.id}/link`).set(as(b.token)).expect(403);
    const staff = await member(t, "staff@mbm.example", "STAFF", ["verify.first"]);
    const early = await request(t.app).get(`/api/v1/files/${up.body.id}/link`).set(as(staff)).expect(425);
    expect(early.body.error.code).toBe("FILE_CHECKING");
    await t.db.fileObject.update({ where: { id: up.body.id }, data: { scanStatus: "CLEAN" } });
    await request(t.app).get(`/api/v1/files/${up.body.id}/link`).set(as(staff)).expect(200);
  });

  it("locks marks while pending, allows withdrawing until a reviewer takes it", async () => {
    const t = testApp();
    const s = await completeAndSubmit(t, 1);
    const locked = await request(t.app).put("/api/v1/students/me/academics").set(as(s.token)).send({ cgpa: 9, activeBacklogs: 0, totalBacklogs: 0, tenthPercent: 90 }).expect(409);
    expect(locked.body.error.code).toBe("PROFILE_LOCKED");
    // Non-academic edits are always fine
    await request(t.app).patch("/api/v1/students/me").set(as(s.token)).send({ skills: ["React", "SQL"] }).expect(200);

    const w = await request(t.app).post("/api/v1/students/me/withdraw").set(as(s.token)).expect(200);
    expect(w.body.profile.status).toBe("PROFILE_INCOMPLETE");
    await request(t.app).post("/api/v1/students/me/submit").set(as(s.token)).expect(200);

    const staff = await member(t, "staff@mbm.example", "STAFF", ["verify.first"]);
    await request(t.app).post("/api/v1/work/next").set(as(staff)).expect(200);
    const late = await request(t.app).post("/api/v1/students/me/withdraw").set(as(s.token)).expect(409);
    expect(late.body.error.code).toBe("IN_REVIEW");
  });

  it("staff verify a student: marks are copied, the student is told by app and email", async () => {
    const t = testApp();
    const s = await completeAndSubmit(t, 1);
    const staff = await member(t, "staff@mbm.example", "STAFF", ["verify.first"]);

    const task = await request(t.app).post("/api/v1/work/next").set(as(staff)).expect(200);
    expect(task.body.type).toBe("STUDENT_VERIFICATION");
    expect(task.body.student.rollNo).toBe("24UCSE4001");
    expect(task.body.student.email).toBeUndefined(); // reviewers don't get contact details
    expect(task.body.academics.cgpa).toBe(8.42);
    expect(task.body.documents).toHaveLength(3);
    expect(task.body.documents[0].file.url).toMatch(/^memory:\/\//);

    // Asking again returns the same held task, not a second one
    const again = await request(t.app).post("/api/v1/work/next").set(as(staff)).expect(200);
    expect(again.body.id).toBe(task.body.id);

    const d = await request(t.app).post(`/api/v1/work/tasks/${task.body.id}/decision`).set(as(staff)).send({ decision: "APPROVE" }).expect(200);
    expect(d.body.outcome).toBe("closed");

    const me = await request(t.app).get("/api/v1/students/me").set(as(s.token)).expect(200);
    expect(me.body.profile.status).toBe("VERIFIED");
    expect(me.body.profile.cgpa).toBe(8.42);
    expect(me.body.canEdit).toBe(false);
    expect(me.body.documents.every((x: { status: string }) => x.status === "ACCEPTED")).toBe(true);
    expect(await t.db.notification.count({ where: { title: { contains: "verified" } } })).toBe(1);
    expect(t.mailer.sent.at(-1)?.subject).toContain("verified");
  });

  it("a rejection tells the student why, and a resubmission goes back to the queue", async () => {
    const t = testApp();
    const s = await completeAndSubmit(t, 1);
    const staff = await member(t, "staff@mbm.example", "STAFF", ["verify.first"]);
    const task = await request(t.app).post("/api/v1/work/next").set(as(staff)).expect(200);

    const noReason = await request(t.app).post(`/api/v1/work/tasks/${task.body.id}/decision`).set(as(staff)).send({ decision: "REJECT" }).expect(400);
    expect(noReason.body.error.code).toBe("REASON_REQUIRED");
    await request(t.app)
      .post(`/api/v1/work/tasks/${task.body.id}/decision`)
      .set(as(staff))
      .send({ decision: "REJECT", reasonCode: "MARKSHEET_UNCLEAR", note: "Semester 5 scan is blurry." })
      .expect(200);

    const me = await request(t.app).get("/api/v1/students/me").set(as(s.token)).expect(200);
    expect(me.body.profile.status).toBe("REJECTED");
    expect(me.body.rejection).toMatchObject({ reasonCode: "MARKSHEET_UNCLEAR", note: "Semester 5 scan is blurry." });
    expect(me.body.canEdit).toBe(true);

    await request(t.app).post("/api/v1/students/me/submit").set(as(s.token)).expect(200);
    const next = await t.db.reviewTask.findFirstOrThrow({ where: { status: "OPEN" } });
    expect(next.risk).toBe("MEDIUM");
  });

  it("volunteers: pledge first, no classmates, no high risk, and their approvals get a second check", async () => {
    const t = testApp();
    await completeAndSubmit(t, 1, { branch: "CSE", batch: 2027 });
    const noPledge = await member(t, "vol0@mbm.example", "VOLUNTEER", ["verify.first"], { pledge: false });
    const p = await request(t.app).post("/api/v1/work/next").set(as(noPledge)).expect(403);
    expect(p.body.error.code).toBe("PLEDGE_REQUIRED");

    // Same branch and batch as the only task: they get nothing
    const classmate = await member(t, "vol1@mbm.example", "VOLUNTEER", ["verify.first"], { alsoStudentOf: { branch: "CSE", batch: 2027 } });
    expect((await request(t.app).post("/api/v1/work/next").set(as(classmate)).expect(200)).body).toEqual({ task: null });

    const vol = await member(t, "vol2@mbm.example", "VOLUNTEER", ["verify.first"], { alsoStudentOf: { branch: "ECE", batch: 2026 } });
    const task = await request(t.app).post("/api/v1/work/next").set(as(vol)).expect(200);
    const d = await request(t.app).post(`/api/v1/work/tasks/${task.body.id}/decision`).set(as(vol)).send({ decision: "APPROVE" }).expect(200);
    expect(d.body.outcome).toBe("sent_for_second_check");

    // A volunteer can't do the second check; staff with final checks can
    expect((await request(t.app).post("/api/v1/work/next").set(as(vol)).expect(200)).body).toEqual({ task: null });
    const firstOnlyStaff = await member(t, "staff1@mbm.example", "STAFF", ["verify.first"]);
    expect((await request(t.app).post("/api/v1/work/next").set(as(firstOnlyStaff)).expect(200)).body).toEqual({ task: null });
    const finalStaff = await member(t, "staff2@mbm.example", "STAFF", ["verify.final"]);
    const second = await request(t.app).post("/api/v1/work/next").set(as(finalStaff)).expect(200);
    expect(second.body.type).toBe("SECOND_CHECK");
    expect(second.body.firstDecision.decision).toBe("APPROVE");
    await request(t.app).post(`/api/v1/work/tasks/${second.body.id}/decision`).set(as(finalStaff)).send({ decision: "APPROVE" }).expect(200);
    expect((await t.db.studentProfile.findFirstOrThrow({ where: { rollNo: "24UCSE4001" } })).status).toBe("VERIFIED");
  });

  it("a duplicate marksheet makes the task high-risk, so volunteers never see it", async () => {
    const t = testApp();
    await completeAndSubmit(t, 1, {}, "same");
    await completeAndSubmit(t, 2, {}, "same"); // uploads byte-identical files
    const tasks = await t.db.reviewTask.findMany({ orderBy: { createdAt: "asc" } });
    expect(tasks.map((x) => x.risk)).toEqual(["LOW", "HIGH"]);
    const vol = await member(t, "vol@mbm.example", "VOLUNTEER", ["verify.first"]);
    const got = await request(t.app).post("/api/v1/work/next").set(as(vol)).expect(200);
    expect(got.body.risk).toBe("LOW");
  });

  it("when the second check disagrees, the TPO decides", async () => {
    const t = testApp();
    await completeAndSubmit(t, 1);
    const vol = await member(t, "vol@mbm.example", "VOLUNTEER", ["verify.first"]);
    const task = await request(t.app).post("/api/v1/work/next").set(as(vol)).expect(200);
    await request(t.app).post(`/api/v1/work/tasks/${task.body.id}/decision`).set(as(vol)).send({ decision: "APPROVE" }).expect(200);
    const staff = await member(t, "staff@mbm.example", "STAFF", ["verify.final"]);
    const second = await request(t.app).post("/api/v1/work/next").set(as(staff)).expect(200);
    const d = await request(t.app)
      .post(`/api/v1/work/tasks/${second.body.id}/decision`)
      .set(as(staff))
      .send({ decision: "REJECT", reasonCode: "VALUES_DONT_MATCH", note: "CGPA on the marksheet is 7.42" })
      .expect(200);
    expect(d.body.outcome).toBe("escalated");

    const tpo = await member(t, "tpo@mbm.example", "TPO");
    const up = await request(t.app).post("/api/v1/work/next").set(as(tpo)).expect(200);
    expect(up.body.id).toBe(task.body.id);
    expect(up.body.escalationNote).toContain("disagreed");
    await request(t.app)
      .post(`/api/v1/work/tasks/${up.body.id}/decision`)
      .set(as(tpo))
      .send({ decision: "REJECT", reasonCode: "VALUES_DONT_MATCH", note: "CGPA should be 7.42" })
      .expect(200);
    expect((await t.db.studentProfile.findFirstOrThrow({ where: { rollNo: "24UCSE4001" } })).status).toBe("REJECTED");
  });

  it("the TPO invites a volunteer; volunteers can't get final checks", async () => {
    const t = testApp();
    const tpo = await member(t, "tpo@mbm.example", "TPO");
    const bad = await request(t.app)
      .post("/api/v1/admin/team")
      .set(as(tpo))
      .send({ email: "v@example.com", role: "VOLUNTEER", capabilities: ["verify.first", "verify.final"] })
      .expect(400);
    expect(bad.body.error.code).toBe("NOT_FOR_VOLUNTEERS");
    await request(t.app)
      .post("/api/v1/admin/team")
      .set(as(tpo))
      .send({ email: "v@example.com", role: "VOLUNTEER", capabilities: ["verify.first"], scope: { branches: ["ECE"] } })
      .expect(201);
    expect(t.mailer.sent.at(-1)?.subject).toContain("invited");
    const team = await request(t.app).get("/api/v1/admin/team").set(as(tpo)).expect(200);
    expect(team.body.invites[0]).toMatchObject({ email: "v@example.com", role: "VOLUNTEER" });
    const s = await student(t, 9);
    await request(t.app).get("/api/v1/admin/team").set(as(s.token)).expect(403);
  });
});
