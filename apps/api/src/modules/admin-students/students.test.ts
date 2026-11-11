import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Role } from "@cyrus/shared";
import { hashPassword } from "../../lib/crypto.ts";
import { hasTestDb, resetDb, testApp, testDb } from "../../../test/helpers.ts";

type T = ReturnType<typeof testApp>;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

async function person(t: T, email: string, role: Role) {
  const user = await t.db.user.create({ data: { email, name: email.split("@")[0], passwordHash: await hashPassword("team-pass-123"), emailVerifiedAt: new Date() } });
  await t.db.roleGrant.create({ data: { userId: user.id, role, capabilities: [] } });
  const res = await request(t.app).post("/api/v1/auth/login").send({ email, password: "team-pass-123" }).expect(200);
  return { id: user.id, token: res.body.accessToken as string };
}

async function student(t: T, n: number, data: { branch: string; batch: number; cgpa?: number; activeBacklogs?: number; status?: "VERIFIED" | "PROFILE_INCOMPLETE"; placed?: boolean }) {
  const u = await t.db.user.create({ data: { email: `s${n}@example.com`, name: `Student ${n}`, passwordHash: "x", emailVerifiedAt: new Date() } });
  return t.db.studentProfile.create({
    data: {
      userId: u.id,
      rollNo: `24U${data.branch}${String(n).padStart(4, "0")}`,
      name: `Student ${n}`,
      branch: data.branch,
      batch: data.batch,
      status: data.status ?? "VERIFIED",
      cgpa: data.cgpa ?? null,
      activeBacklogs: data.activeBacklogs ?? null,
      placementStatus: data.placed ? "PLACED" : "NOT_PLACED",
    },
  });
}

describe.skipIf(!hasTestDb)("placement office: all students (database)", () => {
  beforeEach(async () => {
    await resetDb(testDb());
  });
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it("lists students with filters and counts, opens one, and keeps everyone else out", async () => {
    const t = testApp();
    const tpo = await person(t, "tpo@mbm.example", "TPO");
    await student(t, 1, { branch: "CSE", batch: 2027, cgpa: 9.1, activeBacklogs: 0 });
    await student(t, 2, { branch: "CSE", batch: 2027, cgpa: 7.2, activeBacklogs: 2 });
    await student(t, 3, { branch: "IT", batch: 2026, cgpa: 8.4, activeBacklogs: 0, placed: true });
    await student(t, 4, { branch: "ME", batch: 2027, status: "PROFILE_INCOMPLETE" });

    const all = await request(t.app).get("/api/v1/admin/students").set(as(tpo.token)).expect(200);
    expect(all.body.total).toBe(4);
    expect(all.body.counts).toMatchObject({ all: 4, VERIFIED: 3, PROFILE_INCOMPLETE: 1, placed: 1 });
    expect(all.body.branches).toEqual(["CSE", "IT", "ME"]);

    // Filters combine; the status counts follow the other filters.
    const cse = await request(t.app).get("/api/v1/admin/students?branch=CSE&minCgpa=8&maxBacklogs=0").set(as(tpo.token)).expect(200);
    expect(cse.body.students.map((s: { name: string }) => s.name)).toEqual(["Student 1"]);
    const placed = await request(t.app).get("/api/v1/admin/students?placed=yes").set(as(tpo.token)).expect(200);
    expect(placed.body.students[0].branch).toBe("IT");
    const notSent = await request(t.app).get("/api/v1/admin/students?status=PROFILE_INCOMPLETE&batch=2027").set(as(tpo.token)).expect(200);
    expect(notSent.body.total).toBe(1);
    const search = await request(t.app).get("/api/v1/admin/students?q=student%202").set(as(tpo.token)).expect(200);
    expect(search.body.total).toBe(1);
    const byCgpa = await request(t.app).get("/api/v1/admin/students?sort=cgpa").set(as(tpo.token)).expect(200);
    expect(byCgpa.body.students[0].cgpa).toBe(9.1);

    const one = await request(t.app).get(`/api/v1/admin/students/${all.body.students[0].id}`).set(as(tpo.token)).expect(200);
    expect(one.body.profile.email).toMatch(/@example\.com$/);
    expect(one.body.drives).toEqual([]);
    await request(t.app).get("/api/v1/admin/students/00000000-0000-4000-8000-000000000000").set(as(tpo.token)).expect(404);

    // Volunteers, HR and students can't browse every student.
    for (const [email, role] of [["vol@mbm.example", "VOLUNTEER"], ["hr@co.example", "COMPANY_HR"], ["stu@mbm.example", "STUDENT"]] as const) {
      const p = await person(t, email, role);
      await request(t.app).get("/api/v1/admin/students").set(as(p.token)).expect(403);
    }
  });
});
