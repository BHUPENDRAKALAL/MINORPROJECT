import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Role } from "@cyrus/shared";
import { hashPassword } from "../../lib/crypto.ts";
import { hasTestDb, resetDb, testApp, testDb } from "../../../test/helpers.ts";
import { averageRating } from "./service.ts";

type T = ReturnType<typeof testApp>;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
let seq = 0;

async function account(t: T, email: string, roles: Role[]) {
  const user = await t.db.user.create({ data: { email, passwordHash: await hashPassword("kp-pass-1234"), emailVerifiedAt: new Date() } });
  for (const role of roles) await t.db.roleGrant.create({ data: { userId: user.id, role, capabilities: [] } });
  const res = await request(t.app).post("/api/v1/auth/login").send({ email, password: "kp-pass-1234" }).expect(200);
  return { userId: user.id, token: res.body.accessToken as string };
}

describe("rating average", () => {
  it("averages to one decimal, null when nothing rated", () => {
    expect(averageRating({ a: 4, b: 5, c: 3 })).toBe(4);
    expect(averageRating({ a: 4, b: 5 })).toBe(4.5);
    expect(averageRating({ a: 1, b: 2, c: 2 })).toBe(1.7);
    expect(averageRating(null)).toBeNull();
    expect(averageRating({})).toBeNull();
  });
});

describe.skipIf(!hasTestDb)("structured key points, earlier-round notes, notifications (database)", () => {
  beforeEach(async () => {
    await resetDb(testDb());
  });
  afterAll(async () => {
    await testDb().$disconnect();
  });

  /** Technical round (panel with interviewer 1) → Interview round (panel with interviewer 2); two students. */
  async function setup() {
    const t = testApp();
    const company = await t.db.company.create({ data: { name: "Acme", domain: "acme.example" } });
    const tpo = await account(t, "tpo@college.example", ["TPO"]);
    const hr = await account(t, "hr@acme.example", ["COMPANY_HR"]);
    const iv1 = await account(t, "iv1@acme.example", ["INTERVIEWER"]);
    const iv2 = await account(t, "iv2@acme.example", ["INTERVIEWER"]);
    await t.db.companyMember.create({ data: { companyId: company.id, userId: hr.userId, role: "HR" } });
    for (const iv of [iv1, iv2]) await t.db.companyMember.create({ data: { companyId: company.id, userId: iv.userId, role: "INTERVIEWER" } });
    const d = await request(t.app)
      .post("/api/v1/drives")
      .set(as(hr.token))
      .send({ roleTitle: "Engineer", description: "Backend services for retail stores, Java and SQL.", jobType: "FULL_TIME", ctcLpa: 10, optInDeadline: inDays(3), eligibility: {} })
      .expect(201);
    const driveId = d.body.id as string;
    await request(t.app)
      .put(`/api/v1/drives/${driveId}/rounds`)
      .set(as(hr.token))
      .send({ rounds: [{ type: "TECHNICAL", title: "Technical round 1", mode: "OFFLINE" }, { type: "INTERVIEW", title: "Interview round 1", mode: "OFFLINE" }] })
      .expect(200);
    await request(t.app).post(`/api/v1/drives/${driveId}/submit`).set(as(hr.token)).expect(200);
    await request(t.app).post(`/api/v1/admin/drives/${driveId}/approve`).set(as(tpo.token)).expect(200);
    const students = [];
    for (let i = 0; i < 2; i++) {
      const n = ++seq;
      const a = await account(t, `k${n}@example.com`, ["STUDENT"]);
      const p = await t.db.studentProfile.create({
        data: { userId: a.userId, rollNo: `24UCSE4${String(n).padStart(3, "0")}`, name: `Student ${n}`, branch: "CSE", batch: 2027, status: "VERIFIED", cgpa: 8, activeBacklogs: 0, tenthPercent: 80, twelfthPercent: 80 },
      });
      students.push({ ...a, profileId: p.id });
    }
    await request(t.app).post(`/api/v1/drives/${driveId}/invitations`).set(as(hr.token)).send({ all: true }).expect(200);
    for (const s of students) await request(t.app).post(`/api/v1/me/drives/${driveId}/opt-in`).set(as(s.token)).send({ consent: true }).expect(200);
    const drive = await request(t.app).get(`/api/v1/drives/${driveId}`).set(as(hr.token)).expect(200);
    const [tech, interview] = drive.body.rounds.map((r: { id: string }) => r.id) as [string, string];
    return { t, tpo, hr, iv1, iv2, driveId, tech, interview, students };
  }

  /** Make one panel, put everyone in its line, return its id. */
  async function panelFor(t: T, hrToken: string, roundId: string, name: string, memberIds: string[]) {
    await request(t.app).post(`/api/v1/rounds/${roundId}/start`).set(as(hrToken)).expect(200);
    const p = await request(t.app).post(`/api/v1/rounds/${roundId}/panels`).set(as(hrToken)).send({ name, memberIds }).expect(200);
    await request(t.app).post(`/api/v1/rounds/${roundId}/queue`).set(as(hrToken)).expect(200);
    return p.body.panels[0].id as string;
  }

  /** Call, start and end the next student with these key points. */
  async function interview(t: T, token: string, panelId: string, body: object) {
    const called = await request(t.app).post(`/api/v1/panels/${panelId}/call-next`).set(as(token)).expect(200);
    const entry = called.body.current.id as string;
    await request(t.app).post(`/api/v1/queue/${entry}/start`).set(as(token)).expect(200);
    return { entry, end: request(t.app).post(`/api/v1/queue/${entry}/end`).set(as(token)).send(body) };
  }

  it("the panel records ratings per criterion, strengths and concerns; the round page shows them", async () => {
    const { t, hr, iv1, tech } = await setup();
    const panelId = await panelFor(t, hr.token, tech, "Panel A", [iv1.userId]);
    const view = await request(t.app).get(`/api/v1/panels/${panelId}`).set(as(iv1.token)).expect(200);
    expect(view.body.criteria.map((c: { key: string }) => c.key)).toEqual(["problem_solving", "technical_knowledge", "coding", "communication"]);

    // A criterion from another kind of round, or a rating out of 1–5, is refused
    const first = await interview(t, iv1.token, panelId, { ratings: { attitude: 4 } });
    const bad = await first.end.expect(400);
    expect(bad.body.error.details.issues[0].path).toBe("ratings.attitude");
    await request(t.app).post(`/api/v1/queue/${first.entry}/end`).set(as(iv1.token)).send({ ratings: { coding: 6 } }).expect(400);

    const done = await request(t.app)
      .post(`/api/v1/queue/${first.entry}/end`)
      .set(as(iv1.token))
      .send({
        ratings: { problem_solving: 5, technical_knowledge: 4, coding: 4, communication: 3 },
        strengths: ["Clean recursive solution", "  ", "Knows SQL indexes"],
        concerns: ["Rushed the edge cases"],
        privateNotes: "Strong hire for backend.",
        recommendation: "SELECT",
      })
      .expect(200);
    expect(done.body.done[0].session).toMatchObject({
      ratings: { problem_solving: 5, technical_knowledge: 4, coding: 4, communication: 3 },
      strengths: ["Clean recursive solution", "Knows SQL indexes"],
      concerns: ["Rushed the edge cases"],
    });
    const recs = await request(t.app).get(`/api/v1/rounds/${tech}/interviews`).set(as(hr.token)).expect(200);
    expect(recs.body.interviews.find((r: { status: string }) => r.status === "DONE")).toMatchObject({ average: 4, strengths: ["Clean recursive solution", "Knows SQL indexes"] });
  });

  it("an interviewer in a later round sees every earlier round's notes and key points, but not unpublished results", async () => {
    const { t, hr, iv1, iv2, tech, interview: interviewRound, students } = await setup();
    const techPanel = await panelFor(t, hr.token, tech, "Tech panel", [iv1.userId]);
    for (let i = 0; i < 2; i++) {
      const s = await interview(t, iv1.token, techPanel, {
        ratings: { problem_solving: 4 - i, coding: 5 - i },
        strengths: [`Strength ${i}`],
        concerns: [`Concern ${i}`],
        privateNotes: `Tech notes ${i}`,
        recommendation: "SELECT",
      });
      await s.end.expect(200);
    }
    const r = await request(t.app).get(`/api/v1/rounds/${tech}`).set(as(hr.token)).expect(200);
    await request(t.app)
      .put(`/api/v1/rounds/${tech}/results`)
      .set(as(hr.token))
      .send({ results: r.body.students.map((x: { participationId: string }) => ({ participationId: x.participationId, result: "SELECTED" })) })
      .expect(200);
    await request(t.app).post(`/api/v1/rounds/${tech}/results/publish`).set(as(hr.token)).expect(200);

    // Interview round, run by a different interviewer
    const ivPanel = await panelFor(t, hr.token, interviewRound, "Interview panel", [iv2.userId]);
    const view = await request(t.app).get(`/api/v1/panels/${ivPanel}`).set(as(iv2.token)).expect(200);
    expect(view.body.criteria.map((c: { key: string }) => c.key)).toContain("confidence");
    const history = view.body.waiting[0].history as { title: string; result: string; interviews: { interviewer: string; privateNotes: string; strengths: string[]; concerns: string[]; average: number }[] }[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ title: "Technical round 1", result: "SELECTED" });
    expect(history[0]!.interviews[0]).toMatchObject({ interviewer: "iv1@acme.example", privateNotes: expect.stringMatching(/Tech notes \d/) });
    expect(history[0]!.interviews[0]!.strengths[0]).toMatch(/Strength \d/);
    expect(history[0]!.interviews[0]!.average).toBeGreaterThan(0);

    // The student never sees any of it
    const mine = await request(t.app).get(`/api/v1/me/drives/${(await t.db.drive.findFirstOrThrow()).id}`).set(as(students[0]!.token)).expect(200);
    expect(JSON.stringify(mine.body)).not.toMatch(/Tech notes|Strength \d|Concern \d/);
  });

  it("notifications: list, unread count, mark one or all as read; only my own", async () => {
    const { t, students, driveId } = await setup();
    const s = students[0]!;
    const list = await request(t.app).get("/api/v1/me/notifications").set(as(s.token)).expect(200);
    expect(list.body.unread).toBeGreaterThan(0);
    const invite = list.body.items.find((n: { title: string }) => n.title.startsWith("You're invited"));
    expect(invite.path).toBe(`/student/drives/${driveId}`);

    // Someone else can't mark my notification read
    await request(t.app).post("/api/v1/me/notifications/read").set(as(students[1]!.token)).send({ ids: [invite.id] }).expect(200);
    expect((await t.db.notification.findUniqueOrThrow({ where: { id: invite.id } })).readAt).toBeNull();

    const one = await request(t.app).post("/api/v1/me/notifications/read").set(as(s.token)).send({ ids: [invite.id] }).expect(200);
    expect(one.body.unread).toBe(list.body.unread - 1);
    const all = await request(t.app).post("/api/v1/me/notifications/read").set(as(s.token)).send({}).expect(200);
    expect(all.body.unread).toBe(0);
    const count = await request(t.app).get("/api/v1/me/notifications/unread-count").set(as(s.token)).expect(200);
    expect(count.body.unread).toBe(0);
  });
});
