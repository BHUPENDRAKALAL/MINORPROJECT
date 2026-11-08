import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Role } from "@cyrus/shared";
import { hashPassword } from "../../lib/crypto.ts";
import { hasTestDb, resetDb, testApp, testDb } from "../../../test/helpers.ts";
import { averageMinutes, DEFAULT_INTERVIEW_MINUTES } from "./service.ts";

type T = ReturnType<typeof testApp>;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const clock = { t: Date.now() };
let seq = 0;

async function account(t: T, email: string, roles: Role[]) {
  const user = await t.db.user.create({ data: { email, passwordHash: await hashPassword("panel-pass-123"), emailVerifiedAt: new Date() } });
  for (const role of roles) await t.db.roleGrant.create({ data: { userId: user.id, role, capabilities: [] } });
  const res = await request(t.app).post("/api/v1/auth/login").send({ email, password: "panel-pass-123" }).expect(200);
  return { userId: user.id, token: res.body.accessToken as string };
}

describe("wait estimate", () => {
  it("uses the default until two interviews are done, then the average", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m));
    expect(averageMinutes([])).toBe(DEFAULT_INTERVIEW_MINUTES);
    expect(averageMinutes([{ startedAt: at(0), endedAt: at(10) }])).toBe(DEFAULT_INTERVIEW_MINUTES);
    expect(averageMinutes([{ startedAt: at(0), endedAt: at(10) }, { startedAt: at(10), endedAt: at(30) }, { startedAt: at(30), endedAt: null }])).toBe(15);
    expect(averageMinutes([{ startedAt: at(0), endedAt: at(8) }, { startedAt: at(8), endedAt: at(14) }])).toBe(7);
  });
});

describe.skipIf(!hasTestDb)("interview panels and the live line (database)", () => {
  beforeEach(async () => {
    await resetDb(testDb());
    clock.t = Date.now();
  });
  afterAll(async () => {
    await testDb().$disconnect();
  });

  /** A drive with one Interview round, started, four students in it; HR and one interviewer at Acme. */
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
    await request(t.app).put(`/api/v1/drives/${driveId}/rounds`).set(as(hr.token)).send({ rounds: [{ type: "INTERVIEW", title: "Interview round 1", mode: "ONLINE" }] }).expect(200);
    await request(t.app).post(`/api/v1/drives/${driveId}/submit`).set(as(hr.token)).expect(200);
    await request(t.app).post(`/api/v1/admin/drives/${driveId}/approve`).set(as(tpo.token)).expect(200);
    const students = [];
    for (let i = 0; i < 4; i++) {
      const n = ++seq;
      const a = await account(t, `q${n}@example.com`, ["STUDENT"]);
      const p = await t.db.studentProfile.create({
        data: { userId: a.userId, rollNo: `24UCSE6${String(n).padStart(3, "0")}`, name: `Student ${n}`, branch: "CSE", batch: 2027, status: "VERIFIED", cgpa: 8, activeBacklogs: 0, tenthPercent: 80, twelfthPercent: 80, skills: ["Go"] },
      });
      students.push({ ...a, profileId: p.id });
    }
    await request(t.app).post(`/api/v1/drives/${driveId}/invitations`).set(as(hr.token)).send({ all: true }).expect(200);
    for (const s of students) await request(t.app).post(`/api/v1/me/drives/${driveId}/opt-in`).set(as(s.token)).send({ consent: true }).expect(200);
    const drive = await request(t.app).get(`/api/v1/drives/${driveId}`).set(as(hr.token)).expect(200);
    const roundId = drive.body.rounds[0].id as string;
    await request(t.app).post(`/api/v1/rounds/${roundId}/start`).set(as(hr.token)).expect(200);
    return { t, tpo, hr, iv, driveId, roundId, students, company };
  }

  it("HR sets up two panels, the line is split evenly, the interviewer runs their panel; students see their place", async () => {
    const { t, tpo, hr, iv, driveId, roundId, students } = await setup();

    // Only company people can sit on a panel
    const outsider = await account(t, "x@other.example", ["COMPANY_HR"]);
    await request(t.app).post(`/api/v1/rounds/${roundId}/panels`).set(as(hr.token)).send({ name: "Panel X", memberIds: [outsider.userId] }).expect(400);
    const people = await request(t.app).get(`/api/v1/rounds/${roundId}/panel-people`).set(as(hr.token)).expect(200);
    expect(people.body.people.map((p: { role: string }) => p.role).sort()).toEqual(["HR", "INTERVIEWER"]);

    await request(t.app).post(`/api/v1/rounds/${roundId}/queue`).set(as(hr.token)).expect(409); // no panels yet
    await request(t.app).post(`/api/v1/rounds/${roundId}/panels`).set(as(hr.token)).send({ name: "Panel A", location: "Room 204", memberIds: [iv.userId] }).expect(200);
    const two = await request(t.app).post(`/api/v1/rounds/${roundId}/panels`).set(as(hr.token)).send({ name: "Panel B", location: "Room 205", memberIds: [hr.userId] }).expect(200);
    const [a, b] = two.body.panels as { id: string }[];

    const built = await request(t.app).post(`/api/v1/rounds/${roundId}/queue`).set(as(hr.token)).expect(200);
    expect(built.body.added).toBe(4);
    expect(built.body.panels.map((p: { counts: { waiting: number } }) => p.counts.waiting)).toEqual([2, 2]);
    const again = await request(t.app).post(`/api/v1/rounds/${roundId}/queue`).set(as(hr.token)).expect(200);
    expect(again.body.added).toBe(0);

    // The interviewer sees only their panel
    const mine = await request(t.app).get("/api/v1/me/panels").set(as(iv.token)).expect(200);
    expect(mine.body.panels.map((p: { name: string }) => p.name)).toEqual(["Panel A"]);
    await request(t.app).get(`/api/v1/panels/${b!.id}`).set(as(iv.token)).expect(404);
    await request(t.app).post(`/api/v1/panels/${b!.id}/call-next`).set(as(iv.token)).expect(404);

    // Students see their place and a wait estimate
    const view = await request(t.app).get(`/api/v1/panels/${a!.id}`).set(as(iv.token)).expect(200);
    const [first, second] = view.body.waiting as { id: string; student: { id: string } }[];
    const st = (profileId: string) => students.find((s) => s.profileId === profileId)!;
    const line2 = await request(t.app).get(`/api/v1/me/drives/${driveId}`).set(as(st(second!.student.id).token)).expect(200);
    expect(line2.body.rounds[0].my.line).toMatchObject({ panel: "Panel A", location: "Room 204", status: "WAITING", position: 2, waitMinutes: 15 });

    // Call → start → end with notes, a recommendation and a remark for the student
    const called = await request(t.app).post(`/api/v1/panels/${a!.id}/call-next`).set(as(iv.token)).expect(200);
    expect(called.body.current).toMatchObject({ id: first!.id, status: "CALLED" });
    expect(called.body.current.student.skills).toEqual(["Go"]);
    const busy = await request(t.app).post(`/api/v1/panels/${a!.id}/call-next`).set(as(iv.token)).expect(409);
    expect(busy.body.error.code).toBe("PANEL_BUSY");
    const note = await t.db.notification.findFirst({ where: { userId: st(first!.student.id).userId, channel: "QUEUE" } });
    expect(note?.body).toContain("Room 204");
    const line1 = await request(t.app).get(`/api/v1/me/drives/${driveId}`).set(as(st(first!.student.id).token)).expect(200);
    expect(line1.body.rounds[0].my.line.status).toBe("CALLED");

    await request(t.app).post(`/api/v1/queue/${first!.id}/end`).set(as(iv.token)).send({}).expect(409); // not started
    await request(t.app).post(`/api/v1/queue/${first!.id}/start`).set(as(iv.token)).expect(200);
    clock.t += 12 * 60_000;
    const ended = await request(t.app)
      .post(`/api/v1/queue/${first!.id}/end`)
      .set(as(iv.token))
      .send({ privateNotes: "Strong on SQL, weak on system design.", recommendation: "SELECT", feedback: "Good problem solving. Practise explaining your design choices." })
      .expect(200);
    expect(ended.body.current).toBeNull();
    expect(ended.body.done[0].session).toMatchObject({ recommendation: "SELECT", privateNotes: "Strong on SQL, weak on system design." });

    // Private notes never reach the student; the remark waits for the TPO
    const after = await request(t.app).get(`/api/v1/me/drives/${driveId}`).set(as(st(first!.student.id).token)).expect(200);
    expect(JSON.stringify(after.body)).not.toContain("system design.");
    expect(after.body.rounds[0].my.feedback).toEqual([]);
    await request(t.app).get(`/api/v1/drives/${driveId}/feedback`).set(as(hr.token)).expect(403);
    const fb = await request(t.app).get(`/api/v1/drives/${driveId}/feedback`).set(as(tpo.token)).expect(200);
    expect(fb.body.feedback[0]).toMatchObject({ status: "PENDING_REVIEW", round: "Interview round 1" });
    const released = await request(t.app)
      .post(`/api/v1/admin/feedback/${fb.body.feedback[0].id}`)
      .set(as(tpo.token))
      .send({ action: "RELEASE", text: "Good problem solving. Practise explaining your design choices out loud." })
      .expect(200);
    expect(released.body.feedback[0].status).toBe("EDITED_AND_RELEASED");
    const seen = await request(t.app).get(`/api/v1/me/drives/${driveId}`).set(as(st(first!.student.id).token)).expect(200);
    expect(seen.body.rounds[0].my.feedback).toEqual(["Good problem solving. Practise explaining your design choices out loud."]);

    // HR sees recommendations for the final decision
    const recs = await request(t.app).get(`/api/v1/rounds/${roundId}/interviews`).set(as(hr.token)).expect(200);
    expect(recs.body.interviews.find((r: { recommendation: string | null }) => r.recommendation === "SELECT")).toMatchObject({ panel: "Panel A", status: "DONE" });
    await request(t.app).get(`/api/v1/rounds/${roundId}/interviews`).set(as(iv.token)).expect(403);
  });

  it("skips: to the end of the line, absent after two, back in when they turn up; publishing waits for live interviews", async () => {
    const { t, hr, roundId, students } = await setup();
    await request(t.app).post(`/api/v1/rounds/${roundId}/panels`).set(as(hr.token)).send({ name: "Panel A", memberIds: [] }).expect(200);
    const built = await request(t.app).post(`/api/v1/rounds/${roundId}/queue`).set(as(hr.token)).expect(200);
    const pid = built.body.panels[0].id as string;

    let v = await request(t.app).post(`/api/v1/panels/${pid}/call-next`).set(as(hr.token)).expect(200);
    const late = v.body.current.id as string;
    // Can't publish while someone is called
    const blocked = await request(t.app).post(`/api/v1/rounds/${roundId}/results/publish`).set(as(hr.token)).expect(409);
    expect(blocked.body.error.code).toBe("INTERVIEWS_RUNNING");

    v = await request(t.app).post(`/api/v1/queue/${late}/skip`).set(as(hr.token)).expect(200);
    expect(v.body.current).toBeNull();
    expect(v.body.waiting.at(-1)).toMatchObject({ id: late, skipCount: 1 });
    expect(v.body.waiting).toHaveLength(4);

    // Moved to the end: they're called again only after the other three
    for (let i = 0; i < 3; i++) {
      v = await request(t.app).post(`/api/v1/panels/${pid}/call-next`).set(as(hr.token)).expect(200);
      expect(v.body.current.id).not.toBe(late);
      await request(t.app).post(`/api/v1/queue/${v.body.current.id}/start`).set(as(hr.token)).expect(200);
      await request(t.app).post(`/api/v1/queue/${v.body.current.id}/end`).set(as(hr.token)).send({ recommendation: "REJECT" }).expect(200);
    }
    v = await request(t.app).post(`/api/v1/panels/${pid}/call-next`).set(as(hr.token)).expect(200);
    expect(v.body.current.id).toBe(late);
    v = await request(t.app).post(`/api/v1/queue/${late}/skip`).set(as(hr.token)).expect(200);
    expect(v.body.done.find((d: { id: string }) => d.id === late).status).toBe("ABSENT");
    await request(t.app).post(`/api/v1/panels/${pid}/call-next`).set(as(hr.token)).expect(409); // line empty

    // They turn up after all
    v = await request(t.app).post(`/api/v1/queue/${late}/requeue`).set(as(hr.token)).expect(200);
    expect(v.body.waiting.map((w: { id: string }) => w.id)).toEqual([late]);
    expect(students).toHaveLength(4);
  });

  it("HR invites an interviewer, who joins the company team from the email link", async () => {
    const { t, hr } = await setup();
    await request(t.app).post("/api/v1/company/team").set(as(hr.token)).send({ email: "iv@acme.example" }).expect(409); // already on the team
    await request(t.app).post("/api/v1/company/team").set(as(hr.token)).send({ email: "new.iv@acme.example" }).expect(201);
    const mail = t.mailer.sent.find((m) => m.to === "new.iv@acme.example")!;
    const token = mail.text.match(/invite\/(\S+)/)![1]!;
    await request(t.app).post(`/api/v1/auth/invites/${token}/accept`).send({ name: "New Interviewer", password: "new-iv-pass-123" }).expect(200);
    const team = await request(t.app).get("/api/v1/company/team").set(as(hr.token)).expect(200);
    expect(team.body.members.map((m: { email: string; role: string }) => `${m.role}:${m.email}`)).toEqual(
      expect.arrayContaining(["HR:hr@acme.example", "INTERVIEWER:iv@acme.example", "INTERVIEWER:new.iv@acme.example"]),
    );
  });
});
