import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Role } from "@cyrus/shared";
import { hashPassword } from "../../lib/crypto.ts";
import { hasTestDb, resetDb, testApp, testDb } from "../../../test/helpers.ts";
import { effectiveStatus } from "./service.ts";

type T = ReturnType<typeof testApp>;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const PDF = (tag: string) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const clock = { t: Date.now() };
let seq = 0;

async function account(t: T, email: string, roles: Role[]) {
  const user = await t.db.user.create({ data: { email, passwordHash: await hashPassword("offer-pass-123"), emailVerifiedAt: new Date() } });
  for (const role of roles) await t.db.roleGrant.create({ data: { userId: user.id, role, capabilities: [] } });
  const res = await request(t.app).post("/api/v1/auth/login").send({ email, password: "offer-pass-123" }).expect(200);
  return { userId: user.id, token: res.body.accessToken as string };
}

describe("offer status", () => {
  it("an unanswered offer past its deadline counts as expired", () => {
    const at = Date.UTC(2026, 10, 10);
    expect(effectiveStatus({ status: "SENT", respondBy: new Date(at - 1) }, at)).toBe("EXPIRED");
    expect(effectiveStatus({ status: "SENT", respondBy: new Date(at + 1) }, at)).toBe("SENT");
    expect(effectiveStatus({ status: "ACCEPTED", respondBy: new Date(at - 1) }, at)).toBe("ACCEPTED");
  });
});

describe.skipIf(!hasTestDb)("offer letters, accept/decline, placement, closing (database)", () => {
  beforeEach(async () => {
    await resetDb(testDb());
    clock.t = Date.now();
  });
  afterAll(async () => {
    await testDb().$disconnect();
  });

  /** A drive with one HR round; three students selected after it (results published). */
  async function setup() {
    const t = testApp({ now: () => clock.t });
    const company = await t.db.company.create({ data: { name: "Acme", domain: "acme.example" } });
    const tpo = await account(t, "tpo@college.example", ["TPO"]);
    const hr = await account(t, "hr@acme.example", ["COMPANY_HR"]);
    const iv = await account(t, "iv@acme.example", ["INTERVIEWER"]);
    await t.db.companyMember.create({ data: { companyId: company.id, userId: hr.userId, role: "HR" } });
    await t.db.companyMember.create({ data: { companyId: company.id, userId: iv.userId, role: "INTERVIEWER" } });
    const d = await request(t.app)
      .post("/api/v1/drives")
      .set(as(hr.token))
      .send({ roleTitle: "Engineer", description: "Backend services for retail stores, Java and SQL.", jobType: "FULL_TIME", ctcLpa: 10, optInDeadline: inDays(3), eligibility: {} })
      .expect(201);
    const driveId = d.body.id as string;
    await request(t.app).put(`/api/v1/drives/${driveId}/rounds`).set(as(hr.token)).send({ rounds: [{ type: "HR", title: "HR round", mode: "ONLINE" }] }).expect(200);
    await request(t.app).post(`/api/v1/drives/${driveId}/submit`).set(as(hr.token)).expect(200);
    await request(t.app).post(`/api/v1/admin/drives/${driveId}/approve`).set(as(tpo.token)).expect(200);
    const students = [];
    for (let i = 0; i < 3; i++) {
      const n = ++seq;
      const a = await account(t, `o${n}@example.com`, ["STUDENT"]);
      const p = await t.db.studentProfile.create({
        data: { userId: a.userId, rollNo: `24UCSE5${String(n).padStart(3, "0")}`, name: `Student ${n}`, branch: "CSE", batch: 2027, status: "VERIFIED", cgpa: 8, activeBacklogs: 0, tenthPercent: 80, twelfthPercent: 80 },
      });
      students.push({ ...a, profileId: p.id });
    }
    await request(t.app).post(`/api/v1/drives/${driveId}/invitations`).set(as(hr.token)).send({ all: true }).expect(200);
    for (const s of students) await request(t.app).post(`/api/v1/me/drives/${driveId}/opt-in`).set(as(s.token)).send({ consent: true }).expect(200);
    const drive = await request(t.app).get(`/api/v1/drives/${driveId}`).set(as(hr.token)).expect(200);
    const roundId = drive.body.rounds[0].id as string;
    const started = await request(t.app).post(`/api/v1/rounds/${roundId}/start`).set(as(hr.token)).expect(200);
    await request(t.app)
      .put(`/api/v1/rounds/${roundId}/results`)
      .set(as(hr.token))
      .send({ results: started.body.students.map((s: { participationId: string }) => ({ participationId: s.participationId, result: "SELECTED" })) })
      .expect(200);
    await request(t.app).post(`/api/v1/rounds/${roundId}/results/publish`).set(as(hr.token)).expect(200);
    return { t, tpo, hr, iv, driveId, students, company };
  }

  async function uploadLetter(t: T, token: string, tag: string) {
    const up = await request(t.app).post("/api/v1/files?kind=OFFER_LETTER").set(as(token)).attach("file", PDF(tag), `${tag}.pdf`).expect(201);
    await t.db.fileObject.update({ where: { id: up.body.id }, data: { scanStatus: "CLEAN" } });
    return up.body.id as string;
  }

  it("HR sends letters; only the student, TPO and HR can open them; accepting places the student", async () => {
    const { t, tpo, hr, iv, driveId, students } = await setup();
    const list = await request(t.app).get(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).expect(200);
    expect(list.body.selected).toHaveLength(3);
    expect(list.body.canSend).toBe(true);
    const [a, b] = list.body.selected as { participationId: string; student: { rollNo: string } }[];

    // Students can't upload offer letters
    await request(t.app).post("/api/v1/files?kind=OFFER_LETTER").set(as(students[0]!.token)).attach("file", PDF("x"), "x.pdf").expect(403);

    // Someone else's file can't be used as the letter
    const tpoFile = await uploadLetter(t, tpo.token, "tpo-file");
    await request(t.app).post(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).send({ participationId: a!.participationId, fileId: tpoFile }).expect(400);

    const fileA = await uploadLetter(t, hr.token, "letter-a");
    const sent = await request(t.app).post(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).send({ participationId: a!.participationId, fileId: fileA, joiningDate: inDays(60) }).expect(200);
    const offerA = sent.body.selected.find((s: { participationId: string }) => s.participationId === a!.participationId).offer;
    expect(offerA).toMatchObject({ status: "SENT", ctcLpa: 10, fileName: "letter-a.pdf" });

    const studentA = await t.db.participation.findUniqueOrThrow({ where: { id: a!.participationId }, select: { student: { select: { userId: true } } } });
    const sa = students.find((s) => s.userId === studentA.student.userId)!;
    const sOther = students.find((s) => s.userId !== studentA.student.userId)!;

    // The student sees it on the drive page and was told
    const page = await request(t.app).get(`/api/v1/me/drives/${driveId}`).set(as(sa.token)).expect(200);
    expect(page.body.me.status).toBe("OFFERED");
    expect(page.body.offer).toMatchObject({ id: offerA.id, status: "SENT" });
    const saEmail = (await t.db.user.findUniqueOrThrow({ where: { id: sa.userId } })).email;
    expect(t.mailer.sent.some((m) => m.to === saEmail && m.subject.includes("you have an offer"))).toBe(true);

    // Who can open the letter
    for (const token of [sa.token, tpo.token, hr.token]) {
      const l = await request(t.app).get(`/api/v1/offers/${offerA.id}/letter`).set(as(token)).expect(200);
      expect(l.body.url).toBeTruthy();
    }
    await request(t.app).get(`/api/v1/offers/${offerA.id}/letter`).set(as(sOther.token)).expect(404);
    await request(t.app).get(`/api/v1/offers/${offerA.id}/letter`).set(as(iv.token)).expect(404);
    await request(t.app).post(`/api/v1/me/offers/${offerA.id}/accept`).set(as(sOther.token)).expect(404);

    // Accept → placed, recorded; HR told
    await request(t.app).post(`/api/v1/me/offers/${offerA.id}/accept`).set(as(sa.token)).expect(200);
    await request(t.app).post(`/api/v1/me/offers/${offerA.id}/decline`).set(as(sa.token)).expect(409);
    const profile = await t.db.studentProfile.findFirstOrThrow({ where: { userId: sa.userId } });
    expect(profile.placementStatus).toBe("PLACED");
    const record = await t.db.placementRecord.findFirstOrThrow({ where: { studentId: profile.id } });
    expect(record).toMatchObject({ companyName: "Acme", roleTitle: "Engineer", ctcLpa: 10, branch: "CSE", batch: 2027 });
    expect((await t.db.notification.findFirst({ where: { userId: hr.userId, title: { contains: "accepted the offer" } } }))).toBeTruthy();
    await request(t.app).post(`/api/v1/offers/${offerA.id}/revoke`).set(as(hr.token)).send({ reason: "Changed our minds" }).expect(409);

    // Second student declines
    const fileB = await uploadLetter(t, hr.token, "letter-b");
    const sentB = await request(t.app).post(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).send({ participationId: b!.participationId, fileId: fileB }).expect(200);
    const offerB = sentB.body.selected.find((s: { participationId: string }) => s.participationId === b!.participationId).offer;
    const pb = await t.db.participation.findUniqueOrThrow({ where: { id: b!.participationId }, select: { student: { select: { userId: true } } } });
    const sb = students.find((s) => s.userId === pb.student.userId)!;
    await request(t.app).post(`/api/v1/me/offers/${offerB.id}/decline`).set(as(sb.token)).expect(200);
    expect((await t.db.participation.findUniqueOrThrow({ where: { id: b!.participationId } })).status).toBe("OFFER_DECLINED");

    // TPO closes the drive; HR can't send more
    await request(t.app).post(`/api/v1/admin/drives/${driveId}/close`).set(as(hr.token)).expect(403);
    await request(t.app).post(`/api/v1/admin/drives/${driveId}/close`).set(as(tpo.token)).expect(200);
    const c = list.body.selected[2] as { participationId: string };
    const fileC = await uploadLetter(t, hr.token, "letter-c");
    const closed = await request(t.app).post(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).send({ participationId: c.participationId, fileId: fileC }).expect(409);
    expect(closed.body.error.message).toContain("closed");
  });

  it("deadlines, withdrawing, replacing a letter, and the one-offer rule", async () => {
    const { t, hr, driveId, students } = await setup();
    const list = await request(t.app).get(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).expect(200);
    const [a, b] = list.body.selected as { participationId: string }[];
    const studentOf = async (pid: string) => {
      const p = await t.db.participation.findUniqueOrThrow({ where: { id: pid }, select: { student: { select: { userId: true } } } });
      return students.find((s) => s.userId === p.student.userId)!;
    };

    // Too short a deadline is refused
    const f1 = await uploadLetter(t, hr.token, "a1");
    await request(t.app).post(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).send({ participationId: a!.participationId, fileId: f1, respondBy: new Date(Date.now() + 60_000).toISOString() }).expect(400);

    // Send, then replace the letter (still one offer)
    const s1 = await request(t.app).post(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).send({ participationId: a!.participationId, fileId: f1, respondBy: inDays(2) }).expect(200);
    const id1 = s1.body.selected.find((x: { participationId: string }) => x.participationId === a!.participationId).offer.id;
    const f2 = await uploadLetter(t, hr.token, "a2");
    const s2 = await request(t.app).post(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).send({ participationId: a!.participationId, fileId: f2, respondBy: inDays(2) }).expect(200);
    expect(s2.body.selected.find((x: { participationId: string }) => x.participationId === a!.participationId).offer).toMatchObject({ id: id1, fileName: "a2.pdf" });

    // Withdraw: back to selected, the student is told and can't open the letter any more
    const sa = await studentOf(a!.participationId);
    await request(t.app).post(`/api/v1/offers/${id1}/revoke`).set(as(hr.token)).send({ reason: "Role is on hold." }).expect(200);
    expect((await t.db.participation.findUniqueOrThrow({ where: { id: a!.participationId } })).status).toBe("SELECTED");
    await request(t.app).get(`/api/v1/offers/${id1}/letter`).set(as(sa.token)).expect(410);
    const page = await request(t.app).get(`/api/v1/me/drives/${driveId}`).set(as(sa.token)).expect(200);
    expect(page.body.offer).toBeNull();

    // Deadline passes → expired, can't accept
    const f3 = await uploadLetter(t, hr.token, "b1");
    const sb = await studentOf(b!.participationId);
    const s3 = await request(t.app).post(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).send({ participationId: b!.participationId, fileId: f3, respondBy: inDays(1) }).expect(200);
    const idB = s3.body.selected.find((x: { participationId: string }) => x.participationId === b!.participationId).offer.id;
    clock.t += 2 * 86_400_000;
    const late = await request(t.app).post(`/api/v1/me/offers/${idB}/accept`).set(as(sb.token)).expect(409);
    expect(late.body.error.code).toBe("OFFER_EXPIRED");
    clock.t = Date.now();

    // One-offer rule: a placed student can't accept a second ordinary offer
    await t.db.studentProfile.updateMany({ where: { userId: sb.userId }, data: { placementStatus: "PLACED" } });
    const f4 = await uploadLetter(t, hr.token, "b2");
    await request(t.app).post(`/api/v1/drives/${driveId}/offers`).set(as(hr.token)).send({ participationId: b!.participationId, fileId: f4, respondBy: inDays(3) }).expect(200);
    const second = await request(t.app).post(`/api/v1/me/offers/${idB}/accept`).set(as(sb.token)).expect(409);
    expect(second.body.error.code).toBe("ALREADY_PLACED");
  });

  it("company HR and interviewers can open a joined student's resume, and nobody else's", async () => {
    const { t, hr, iv, students } = await setup();
    const s = students[0]!;
    const up = await request(t.app).post("/api/v1/files?kind=RESUME").set(as(s.token)).attach("file", PDF("cv"), "cv.pdf").expect(201);
    await t.db.fileObject.update({ where: { id: up.body.id }, data: { scanStatus: "CLEAN" } });
    await t.db.studentProfile.updateMany({ where: { userId: s.userId }, data: { resumeFileId: up.body.id } });
    await request(t.app).get(`/api/v1/files/${up.body.id}/link`).set(as(hr.token)).expect(200);
    await request(t.app).get(`/api/v1/files/${up.body.id}/link`).set(as(iv.token)).expect(200);
    const other = await t.db.company.create({ data: { name: "Other", domain: "other.example" } });
    const stranger = await account(t, "hr@other.example", ["COMPANY_HR"]);
    await t.db.companyMember.create({ data: { companyId: other.id, userId: stranger.userId, role: "HR" } });
    await request(t.app).get(`/api/v1/files/${up.body.id}/link`).set(as(stranger.token)).expect(403);
  });
});
