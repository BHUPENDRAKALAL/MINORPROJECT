import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Role } from "@cyrus/shared";
import { hashPassword } from "../../lib/crypto.ts";
import { hasTestDb, resetDb, testApp, testDb } from "../../../test/helpers.ts";

type T = ReturnType<typeof testApp>;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
let seq = 0;

async function account(t: T, email: string, roles: Role[]) {
  const user = await t.db.user.create({ data: { email, passwordHash: await hashPassword("drive-pass-123"), emailVerifiedAt: new Date() } });
  for (const role of roles) await t.db.roleGrant.create({ data: { userId: user.id, role, capabilities: [] } });
  const res = await request(t.app).post("/api/v1/auth/login").send({ email, password: "drive-pass-123" }).expect(200);
  return { userId: user.id, token: res.body.accessToken as string };
}

async function hr(t: T, companyId: string, email = `hr${++seq}@acme.example`) {
  const a = await account(t, email, ["COMPANY_HR"]);
  await t.db.companyMember.create({ data: { companyId, userId: a.userId, role: "HR" } });
  return a;
}

async function verifiedStudent(t: T, over: Partial<{ branch: string; batch: number; cgpa: number; activeBacklogs: number; placed: boolean }> = {}) {
  const n = ++seq;
  const email = `s${n}@example.com`;
  const a = await account(t, email, ["STUDENT"]);
  const profile = await t.db.studentProfile.create({
    data: {
      userId: a.userId,
      rollNo: `24UCSE7${String(n).padStart(3, "0")}`,
      name: `Student ${n}`,
      branch: over.branch ?? "CSE",
      batch: over.batch ?? 2027,
      status: "VERIFIED",
      cgpa: over.cgpa ?? 8,
      activeBacklogs: over.activeBacklogs ?? 0,
      tenthPercent: 85,
      twelfthPercent: 80,
      placementStatus: over.placed ? "PLACED" : "NOT_PLACED",
    },
  });
  return { ...a, email, profileId: profile.id };
}

const fullDrive = {
  roleTitle: "Software Engineer",
  description: "Build and run services used by millions of people. Java or Go.",
  jobType: "FULL_TIME",
  ctcLpa: 12,
  location: "Bengaluru",
  optInDeadline: inDays(5),
  eligibility: { branches: ["CSE", "IT"], minCgpa: 7.5, maxActiveBacklogs: 0 },
};

const rounds = [
  { type: "OA", title: "Online assessment", mode: "ONLINE", startsAt: inDays(7), onlineLink: "https://test.example.com/oa" },
  { type: "TECHNICAL", title: "Technical round 1", mode: "OFFLINE", startsAt: inDays(8), venue: "LT-3" },
  { type: "TECHNICAL", title: "Technical round 2", mode: "OFFLINE", venue: "LT-3" },
  { type: "HR", title: "HR round", mode: "OFFLINE" },
];

describe.skipIf(!hasTestDb)("drives, rounds, approval and invitations (database)", () => {
  beforeEach(async () => {
    await resetDb(testDb());
  });
  afterAll(async () => {
    await testDb().$disconnect();
  });

  async function setup() {
    const t = testApp();
    const acme = await t.db.company.create({ data: { name: "Acme Systems", domain: "acme.example" } });
    const other = await t.db.company.create({ data: { name: "Other Corp", domain: "other.example" } });
    const tpo = await account(t, "tpo@college.example", ["TPO"]);
    const h = await hr(t, acme.id);
    return { t, acme, other, tpo, h };
  }

  async function publishedDrive(s: Awaited<ReturnType<typeof setup>>) {
    const { t, h, tpo } = s;
    const d = await request(t.app).post("/api/v1/drives").set(as(h.token)).send(fullDrive).expect(201);
    await request(t.app).put(`/api/v1/drives/${d.body.id}/rounds`).set(as(h.token)).send({ rounds }).expect(200);
    await request(t.app).post(`/api/v1/drives/${d.body.id}/submit`).set(as(h.token)).expect(200);
    await request(t.app).post(`/api/v1/admin/drives/${d.body.id}/approve`).set(as(tpo.token)).expect(200);
    return d.body.id as string;
  }

  it("HR builds a drive with repeated round kinds, sends it, the TPO approves", async () => {
    const s = await setup();
    const { t, h, tpo } = s;
    const created = await request(t.app).post("/api/v1/drives").set(as(h.token)).send({ roleTitle: "Software Engineer" }).expect(201);
    expect(created.body.status).toBe("DRAFT");
    expect(created.body.company.name).toBe("Acme Systems");
    expect(created.body.missing).toEqual(expect.arrayContaining(["At least one round", "The CTC"]));

    const id = created.body.id;
    const early = await request(t.app).post(`/api/v1/drives/${id}/submit`).set(as(h.token)).expect(400);
    expect(early.body.error.code).toBe("INCOMPLETE");

    const { roleTitle: _r, ...rest } = fullDrive;
    await request(t.app).patch(`/api/v1/drives/${id}`).set(as(h.token)).send(rest).expect(200);
    const saved = await request(t.app).put(`/api/v1/drives/${id}/rounds`).set(as(h.token)).send({ rounds }).expect(200);
    expect(saved.body.rounds.map((r: { title: string; sequence: number }) => [r.sequence, r.title])).toEqual([
      [1, "Online assessment"],
      [2, "Technical round 1"],
      [3, "Technical round 2"],
      [4, "HR round"],
    ]);
    expect(saved.body.rounds[2].startsAt).toBeNull(); // date to be announced
    expect(saved.body.missing).toEqual([]);

    // Reorder and remove in one save: HR round moves before Technical round 2, OA removed
    const [, t1, t2, hrRound] = saved.body.rounds;
    const reordered = await request(t.app)
      .put(`/api/v1/drives/${id}/rounds`)
      .set(as(h.token))
      .send({ rounds: [t1, hrRound, t2].map(({ sequence: _s, status: _st, ...r }: Record<string, unknown>) => r) })
      .expect(200);
    expect(reordered.body.rounds.map((r: { title: string }) => r.title)).toEqual(["Technical round 1", "HR round", "Technical round 2"]);
    expect(reordered.body.rounds[0].id).toBe(t1.id);

    const sent = await request(t.app).post(`/api/v1/drives/${id}/submit`).set(as(h.token)).expect(200);
    expect(sent.body.status).toBe("PENDING_APPROVAL");
    // While waiting, HR can't change it
    await request(t.app).patch(`/api/v1/drives/${id}`).set(as(h.token)).send({ location: "Pune" }).expect(409);
    const tpoNote = await t.db.notification.findFirst({ where: { userId: tpo.userId } });
    expect(tpoNote?.title).toContain("New drive to approve");

    // HR can't approve their own drive
    await request(t.app).post(`/api/v1/admin/drives/${id}/approve`).set(as(h.token)).expect(403);
    const approved = await request(t.app).post(`/api/v1/admin/drives/${id}/approve`).set(as(tpo.token)).expect(200);
    expect(approved.body.status).toBe("PUBLISHED");
    expect(approved.body.can.invite).toBe(true);

    // After approval, pay and eligibility are locked for HR, but the location can change
    const locked = await request(t.app).patch(`/api/v1/drives/${id}`).set(as(h.token)).send({ ctcLpa: 30 }).expect(409);
    expect(locked.body.error.code).toBe("LOCKED_AFTER_APPROVAL");
    await request(t.app).patch(`/api/v1/drives/${id}`).set(as(h.token)).send({ location: "Pune" }).expect(200);
  });

  it("the TPO sends a drive back with a reason; HR fixes it and sends again", async () => {
    const s = await setup();
    const { t, h, tpo } = s;
    const d = await request(t.app).post("/api/v1/drives").set(as(h.token)).send(fullDrive).expect(201);
    await request(t.app).put(`/api/v1/drives/${d.body.id}/rounds`).set(as(h.token)).send({ rounds }).expect(200);
    await request(t.app).post(`/api/v1/drives/${d.body.id}/submit`).set(as(h.token)).expect(200);
    await request(t.app).post(`/api/v1/admin/drives/${d.body.id}/reject`).set(as(tpo.token)).send({ reason: "x" }).expect(400);
    const back = await request(t.app).post(`/api/v1/admin/drives/${d.body.id}/reject`).set(as(tpo.token)).send({ reason: "Add the bond details." }).expect(200);
    expect(back.body.status).toBe("REJECTED");
    expect(back.body.rejectionReason).toBe("Add the bond details.");
    const note = await t.db.notification.findFirst({ where: { userId: h.userId } });
    expect(note?.body).toContain("Add the bond details.");
    await request(t.app).patch(`/api/v1/drives/${d.body.id}`).set(as(h.token)).send({ bondMonths: 12 }).expect(200);
    const again = await request(t.app).post(`/api/v1/drives/${d.body.id}/submit`).set(as(h.token)).expect(200);
    expect(again.body.status).toBe("PENDING_APPROVAL");
  });

  it("HR never sees or touches another company's drive; students can't use office routes", async () => {
    const s = await setup();
    const { t, other } = s;
    const id = await publishedDrive(s);
    const stranger = await hr(t, other.id);
    await request(t.app).get(`/api/v1/drives/${id}`).set(as(stranger.token)).expect(404);
    await request(t.app).patch(`/api/v1/drives/${id}`).set(as(stranger.token)).send({ location: "X" }).expect(404);
    const list = await request(t.app).get("/api/v1/drives").set(as(stranger.token)).expect(200);
    expect(list.body.drives).toHaveLength(0);
    await request(t.app).post("/api/v1/drives").set(as(stranger.token)).send({ roleTitle: "Sneaky", companyId: s.acme.id }).expect(403);
    const st = await verifiedStudent(t);
    await request(t.app).get("/api/v1/drives").set(as(st.token)).expect(403);
  });

  it("eligibility follows the filters and placement rules; invites only reach eligible students", async () => {
    const s = await setup();
    const { t, h } = s;
    const ok1 = await verifiedStudent(t, { cgpa: 9.1 });
    const ok2 = await verifiedStudent(t, { branch: "IT", cgpa: 7.6 });
    const lowCgpa = await verifiedStudent(t, { cgpa: 7.0 });
    const backlog = await verifiedStudent(t, { activeBacklogs: 1 });
    const wrongBranch = await verifiedStudent(t, { branch: "ME" });
    const placed = await verifiedStudent(t, { placed: true });
    const id = await publishedDrive(s);

    const preview = await request(t.app).post(`/api/v1/drives/${id}/eligibility/preview`).set(as(h.token)).send({}).expect(200);
    expect(preview.body.count).toBe(2);
    expect(preview.body.students.map((x: { id: string }) => x.id)).toEqual([ok1.profileId, ok2.profileId]);

    const bad = await request(t.app).post(`/api/v1/drives/${id}/invitations`).set(as(h.token)).send({ studentIds: [ok1.profileId, lowCgpa.profileId] }).expect(400);
    expect(bad.body.error.code).toBe("NOT_ELIGIBLE");

    const inv = await request(t.app).post(`/api/v1/drives/${id}/invitations`).set(as(h.token)).send({ all: true }).expect(200);
    expect(inv.body).toEqual({ invited: 2, alreadyIn: 0 });
    const again = await request(t.app).post(`/api/v1/drives/${id}/invitations`).set(as(h.token)).send({ all: true }).expect(200);
    expect(again.body).toEqual({ invited: 0, alreadyIn: 2 });
    expect(t.mailer.sent.filter((m) => m.subject.startsWith("You're invited")).map((m) => m.to).sort()).toEqual([ok1.email, ok2.email].sort());
    for (const x of [lowCgpa, backlog, wrongBranch, placed]) {
      expect(await t.db.participation.count({ where: { studentId: x.profileId } })).toBe(0);
    }
  });

  it("students see a running drive's name only, until invited; then everything, and join or skip", async () => {
    const s = await setup();
    const { t, h, tpo } = s;
    const invited = await verifiedStudent(t, { cgpa: 9 });
    const outsider = await verifiedStudent(t, { branch: "ME" });
    const id = await publishedDrive(s);

    // A draft drive is invisible to students
    const draft = await request(t.app).post("/api/v1/drives").set(as(h.token)).send({ roleTitle: "Secret draft" }).expect(201);
    const outsiderList = await request(t.app).get("/api/v1/me/drives").set(as(outsider.token)).expect(200);
    expect(outsiderList.body.mine).toHaveLength(0);
    expect(outsiderList.body.others).toEqual([{ id, roleTitle: "Software Engineer", jobType: "FULL_TIME", status: "PUBLISHED", company: "Acme Systems" }]);
    await request(t.app).get(`/api/v1/me/drives/${draft.body.id}`).set(as(outsider.token)).expect(404);
    const peek = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(outsider.token)).expect(200);
    expect(peek.body).toEqual({ id, company: "Acme Systems", roleTitle: "Software Engineer", jobType: "FULL_TIME", status: "PUBLISHED", inDrive: false });
    await request(t.app).post(`/api/v1/me/drives/${id}/opt-in`).set(as(outsider.token)).send({ consent: true }).expect(404);

    await request(t.app).post(`/api/v1/drives/${id}/invitations`).set(as(h.token)).send({ all: true }).expect(200);
    const full = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(invited.token)).expect(200);
    expect(full.body.inDrive).toBe(true);
    expect(full.body.ctcLpa).toBe(12);
    expect(full.body.rounds).toHaveLength(4);
    expect(full.body.rounds[0].onlineLink).toBeNull(); // only after joining
    expect(full.body.me).toMatchObject({ status: "INVITED", canJoin: true, canSkip: true });

    await request(t.app).post(`/api/v1/me/drives/${id}/opt-in`).set(as(invited.token)).send({}).expect(400);
    const joined = await request(t.app).post(`/api/v1/me/drives/${id}/opt-in`).set(as(invited.token)).send({ consent: true }).expect(200);
    expect(joined.body.me).toMatchObject({ status: "OPTED_IN", canJoin: false, canSkip: true });
    expect(joined.body.rounds[0].onlineLink).toBe("https://test.example.com/oa");
    const skipped = await request(t.app).post(`/api/v1/me/drives/${id}/opt-out`).set(as(invited.token)).expect(200);
    expect(skipped.body.me.status).toBe("OPTED_OUT");
    await request(t.app).post(`/api/v1/me/drives/${id}/opt-in`).set(as(invited.token)).send({ consent: true }).expect(200);

    // Changing the schedule tells the students in the drive
    const current = await request(t.app).get(`/api/v1/drives/${id}`).set(as(h.token)).expect(200);
    const moved = current.body.rounds.map(({ sequence: _s, status: _st, ...r }: Record<string, unknown>) => r);
    moved[1].venue = "Main auditorium";
    await request(t.app).put(`/api/v1/drives/${id}/rounds`).set(as(h.token)).send({ rounds: moved }).expect(200);
    const notes = await t.db.notification.findMany({ where: { userId: invited.userId } });
    expect(notes.map((n) => n.title)).toEqual(expect.arrayContaining([expect.stringContaining("Round schedule changed")]));

    // After the deadline nobody can change their answer
    await t.db.drive.update({ where: { id }, data: { optInDeadline: new Date(Date.now() - 1000) } });
    const late = await request(t.app).post(`/api/v1/me/drives/${id}/opt-out`).set(as(invited.token)).expect(409);
    expect(late.body.error.code).toBe("DEADLINE_PASSED");

    // Cancelling tells them too, with the reason
    await request(t.app).post(`/api/v1/admin/drives/${id}/cancel`).set(as(tpo.token)).send({ reason: "The company paused hiring." }).expect(200);
    const after = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(invited.token)).expect(200);
    expect(after.body.status).toBe("CANCELLED");
    expect(after.body.cancelReason).toBe("The company paused hiring.");
    await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(outsider.token)).expect(404);
  });

  it("the TPO creates a drive for a company without HR and publishes it directly", async () => {
    const s = await setup();
    const { t, tpo } = s;
    const c = await request(t.app).post("/api/v1/admin/companies").set(as(tpo.token)).send({ name: "Walk-in Ltd", website: "https://www.walkin.example" }).expect(201);
    await request(t.app).post("/api/v1/admin/companies").set(as(tpo.token)).send({ name: "Copy", website: "https://walkin.example" }).expect(409);
    await request(t.app).post("/api/v1/drives").set(as(tpo.token)).send({ roleTitle: "Analyst" }).expect(400);
    const d = await request(t.app).post("/api/v1/drives").set(as(tpo.token)).send({ ...fullDrive, companyId: c.body.id }).expect(201);
    await request(t.app).put(`/api/v1/drives/${d.body.id}/rounds`).set(as(tpo.token)).send({ rounds: [rounds[0]] }).expect(200);
    const pub = await request(t.app).post(`/api/v1/drives/${d.body.id}/submit`).set(as(tpo.token)).expect(200);
    expect(pub.body.status).toBe("PUBLISHED");
  });

  it("only unanswered invites can be taken back; drafts can be deleted, published drives can't", async () => {
    const s = await setup();
    const { t, h } = s;
    const a = await verifiedStudent(t, { cgpa: 9 });
    const b = await verifiedStudent(t, { cgpa: 8.5 });
    const id = await publishedDrive(s);
    await request(t.app).post(`/api/v1/drives/${id}/invitations`).set(as(h.token)).send({ all: true }).expect(200);
    await request(t.app).post(`/api/v1/me/drives/${id}/opt-in`).set(as(a.token)).send({ consent: true }).expect(200);
    await request(t.app).delete(`/api/v1/drives/${id}/invitations/${a.profileId}`).set(as(h.token)).expect(409);
    await request(t.app).delete(`/api/v1/drives/${id}/invitations/${b.profileId}`).set(as(h.token)).expect(204);
    await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(b.token)).expect(200).expect((r) => expect(r.body.inDrive).toBe(false));
    const people = await request(t.app).get(`/api/v1/drives/${id}/participants`).set(as(h.token)).expect(200);
    expect(people.body.participants.map((p: { status: string }) => p.status)).toEqual(["OPTED_IN"]);

    await request(t.app).delete(`/api/v1/drives/${id}`).set(as(h.token)).expect(409);
    const draft = await request(t.app).post("/api/v1/drives").set(as(h.token)).send({ roleTitle: "Temp" }).expect(201);
    await request(t.app).delete(`/api/v1/drives/${draft.body.id}`).set(as(h.token)).expect(204);
  });

  it("finds clashes for the TPO, gives HR anonymous busy hints, and tells the TPO when a live schedule starts clashing", async () => {
    const s = await setup();
    const { t, tpo, h, other } = s;
    await verifiedStudent(t, { branch: "CSE", cgpa: 9 });
    await verifiedStudent(t, { branch: "CSE", cgpa: 8.5 });
    const first = await publishedDrive(s); // Acme: Technical round 1 in LT-3, 8 days from now

    // Another company's drive for the same students, with a round in the same hall at the same time.
    const h2 = await hr(t, other.id);
    const tech = new Date(Date.parse(rounds[1]!.startsAt!) + 30 * 60_000).toISOString();
    const d = await request(t.app).post("/api/v1/drives").set(as(h2.token)).send({ ...fullDrive, roleTitle: "Data Engineer" }).expect(201);
    await request(t.app)
      .put(`/api/v1/drives/${d.body.id}/rounds`)
      .set(as(h2.token))
      .send({ rounds: [{ type: "TECHNICAL", title: "Technical round", mode: "OFFLINE", startsAt: tech, venue: " lt-3 " }] })
      .expect(200);
    await request(t.app).post(`/api/v1/drives/${d.body.id}/submit`).set(as(h2.token)).expect(200);

    // The TPO, while approving, sees both clashes with names.
    const c = await request(t.app).get(`/api/v1/drives/${d.body.id}/clashes`).set(as(tpo.token)).expect(200);
    const kinds = c.body.clashes.map((x: { kind: string }) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["venue", "students"]));
    expect(c.body.clashes[0].severity).toBe("high");
    expect(c.body.clashes.find((x: { kind: string }) => x.kind === "students").shared).toBe(2);
    expect(c.body.clashes[0].other.company).toBe("Acme Systems");
    await request(t.app).get(`/api/v1/drives/${d.body.id}/clashes`).set(as(h2.token)).expect(403);

    // HR checking a time gets hints without another company's name.
    const hint = await request(t.app).post(`/api/v1/drives/${d.body.id}/slot-check`).set(as(h2.token)).send({ mode: "OFFLINE", startsAt: tech, venue: "LT-3" }).expect(200);
    expect(hint.body.notes.length).toBeGreaterThan(0);
    expect(JSON.stringify(hint.body)).not.toContain("Acme");
    const free = await request(t.app).post(`/api/v1/drives/${d.body.id}/slot-check`).set(as(h2.token)).send({ mode: "OFFLINE", startsAt: inDays(20), venue: "LT-3" }).expect(200);
    expect(free.body.notes).toEqual([]);
    // HR can't probe another company's drive.
    await request(t.app).post(`/api/v1/drives/${first}/slot-check`).set(as(h2.token)).send({ mode: "OFFLINE", startsAt: tech }).expect(404);

    // After approval, HR moves Acme's round onto a new clash: the TPO is told.
    await request(t.app).post(`/api/v1/admin/drives/${d.body.id}/approve`).set(as(tpo.token)).expect(200);
    const before = await t.db.notification.count({ where: { userId: tpo.userId, title: { startsWith: "Schedule clash" } } });
    const live = await request(t.app).get(`/api/v1/drives/${first}`).set(as(h.token)).expect(200);
    const moved = live.body.rounds.map((r: { id: string; type: string; title: string; mode: string; startsAt: string | null; venue: string | null; onlineLink: string | null }, i: number) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      mode: r.mode,
      startsAt: i === 0 ? tech : r.startsAt,
      venue: r.venue,
      onlineLink: r.onlineLink,
    }));
    await request(t.app).put(`/api/v1/drives/${first}/rounds`).set(as(h.token)).send({ rounds: moved }).expect(200);
    const after = await t.db.notification.count({ where: { userId: tpo.userId, title: { startsWith: "Schedule clash" } } });
    expect(after).toBe(before + 1);

    // The campus calendar shows both drives' rounds and flags the shared hall.
    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const cal = await request(t.app).get(`/api/v1/admin/calendar?from=${from}&to=${to}`).set(as(tpo.token)).expect(200);
    expect(cal.body.events.some((e: { company: string }) => e.company === "Other Corp")).toBe(true);
    expect(cal.body.events.filter((e: { clash: string | null }) => e.clash === "venue").length).toBeGreaterThanOrEqual(2);
    await request(t.app).get(`/api/v1/admin/calendar?from=${from}&to=${to}`).set(as(h.token)).expect(403);
  });

  it("the TPO announces who was selected; students who opted out are counted, not named", async () => {
    const s = await setup();
    const { t, tpo, h } = s;
    const id = await publishedDrive(s);
    const [a, b, c] = [await verifiedStudent(t), await verifiedStudent(t), await verifiedStudent(t)];
    for (const [st, status] of [[a, "SELECTED"], [b, "PLACED"], [c, "ELIMINATED"]] as const) {
      await t.db.participation.create({ data: { driveId: id, studentId: st.profileId, status, invitedAt: new Date(), respondedAt: new Date() } });
    }
    await request(t.app).patch("/api/v1/students/me").set(as(b.token)).send({ hideInAnnouncements: true }).expect(200);

    // Still running: nothing to announce, students see no list.
    await request(t.app).post(`/api/v1/admin/drives/${id}/announce`).set(as(tpo.token)).expect(409);
    expect((await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(c.token)).expect(200)).body.selected).toBeNull();

    // Final results out: the count, no names yet.
    await t.db.drive.update({ where: { id }, data: { status: "RESULTS_DECLARED" } });
    let mine = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(c.token)).expect(200);
    expect(mine.body.selected).toMatchObject({ count: 2, names: [], hidden: 0, announcedAt: null });
    await request(t.app).post(`/api/v1/admin/drives/${id}/announce`).set(as(h.token)).expect(403);
    const off = await request(t.app).post(`/api/v1/admin/drives/${id}/announce`).set(as(tpo.token)).expect(200);
    expect(off.body.announcedAt).toBeTruthy();
    expect(off.body.can.announce).toBe(false);
    await request(t.app).post(`/api/v1/admin/drives/${id}/announce`).set(as(tpo.token)).expect(409);

    // Announced: names, minus the student who opted out.
    mine = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(c.token)).expect(200);
    expect(mine.body.selected.names).toEqual([{ name: "Student " + a.email.match(/\d+/)![0], branch: "CSE" }]);
    expect(mine.body.selected.hidden).toBe(1);
    const news = await request(t.app).get("/api/v1/announcements").set(as(c.token)).expect(200);
    expect(news.body.announcements[0]).toMatchObject({ id, count: 2, hidden: 1 });
    expect(await t.db.notification.count({ where: { title: { contains: "placements announced" } } })).toBe(3);

    // Taken down: back to the count only.
    await request(t.app).post(`/api/v1/admin/drives/${id}/unannounce`).set(as(tpo.token)).send({ reason: "Wrong list, fixing it" }).expect(200);
    mine = await request(t.app).get(`/api/v1/me/drives/${id}`).set(as(a.token)).expect(200);
    expect(mine.body.selected).toMatchObject({ count: 2, names: [] });
    expect((await request(t.app).get("/api/v1/announcements").set(as(a.token)).expect(200)).body.announcements).toEqual([]);
  });
});
