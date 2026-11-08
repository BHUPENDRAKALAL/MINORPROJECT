/**
 * Demo accounts for trying the app locally (development only).
 *
 *   pnpm --filter @cyrus/api seed:demo
 *
 * Creates (or re-creates) these accounts, all with the password below:
 *
 *   tpo@cyrus.test         TPO            sees everything, reviews escalations, invites the team
 *   staff@cyrus.test       Staff          first and final checks
 *   volunteer@cyrus.test   Volunteer      first checks only (also a student: ECE 2026, so never gets ECE 2026 profiles)
 *   new.student@cyrus.test     Student    fresh account, profile empty
 *   pending.student@cyrus.test Student    profile sent, waiting in the review queue
 *   pending.two@cyrus.test     Student    profile sent (CSE 2026), a second task in the queue
 *   verified.student@cyrus.test Student   already verified, invited to a drive
 *   hr@cyrus.test          Company HR     Northwind Systems: open drives, one waiting for approval, one draft
 *   interviewer@cyrus.test Interviewer    Northwind Systems: sits on panels HR adds them to
 *
 * Also: a few more verified students (no login needed) so eligibility filters have people to find,
 * and a second company (Lakeside Labs) with an open drive that verified.student is NOT invited to.
 *
 * Re-running deletes the old @cyrus.test accounts first. Refuses to run in production.
 */
import { loadEnv } from "../config/env.ts";
import { createDb } from "../lib/db.ts";
import { hashPassword } from "../lib/crypto.ts";
import { s3Storage } from "../lib/storage.ts";
import { createHash, randomUUID } from "node:crypto";
import type { Role } from "@cyrus/shared";

export const DEMO_PASSWORD = "cyrus-demo-123";
const DOMAIN = "@cyrus.test";

const env = loadEnv();
if (env.NODE_ENV === "production") {
  console.error("seed:demo refuses to run in production.");
  process.exit(1);
}
const db = createDb(env.DATABASE_URL);
const storage = s3Storage(env);

/** A small, valid one-page PDF with a line of text, standing in for a marksheet. */
function pdf(line: string): Buffer {
  const text = line.replace(/[()\\]/g, "");
  const content = Buffer.from(`BT /F1 14 Tf 72 720 Td (${text}) Tj ET`);
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content.toString()}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function clearOld() {
  // Demo companies and their drives (rounds and participations go with the drive)
  const companies = await db.company.findMany({ where: { domain: { endsWith: ".test" } }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);
  // Offers and placement records point at drives and students: remove them first.
  await db.placementRecord.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.offer.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.drive.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
  const users = await db.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  const students = await db.studentProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const files = await db.fileObject.findMany({ where: { ownerId: { in: ids } }, select: { id: true, storageKey: true } });
  await db.$transaction(async (tx) => {
    await tx.reviewTask.deleteMany({ where: { studentId: { in: students.map((s) => s.id) } } });
    await tx.notification.deleteMany({ where: { userId: { in: ids } } });
    await tx.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
    await tx.fileObject.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
  });
  for (const f of files) await storage.remove(f.storageKey).catch(() => undefined);
  await db.invite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

async function account(email: string, name: string, roles: { role: Role; capabilities?: string[]; scope?: object }[], pledge = false) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await db.user.create({ data: { email, name, passwordHash, emailVerifiedAt: new Date(), pledgeAcceptedAt: pledge ? new Date() : null } });
  for (const r of roles) await db.roleGrant.create({ data: { userId: user.id, role: r.role, capabilities: r.capabilities ?? [], scope: r.scope ?? {} } });
  return user;
}

async function studentWithDocs(email: string, name: string, rollNo: string, branch: string, batch: number, state: "new" | "pending" | "verified") {
  const user = await account(email, name, [{ role: "STUDENT" }]);
  const profile = await db.studentProfile.create({ data: { userId: user.id, rollNo, name, branch, batch } });
  if (state === "new") return;

  const marks = { cgpa: 8.1, activeBacklogs: 0, totalBacklogs: 1, tenthPercent: 90.4, twelfthPercent: 86.2, diplomaPercent: null, semester: 5 };
  const docs: [string, string, number | null][] = [
    ["MARKSHEET_10", `Class 10 marksheet - ${name} - 90.4%`, null],
    ["MARKSHEET_12", `Class 12 marksheet - ${name} - 86.2%`, null],
    ["SEMESTER_MARKSHEET", `Semester 5 grade card - ${rollNo} - CGPA 8.10`, 5],
  ];
  for (const [type, line, semester] of docs) {
    const body = pdf(line);
    const id = randomUUID();
    const key = `marksheet/demo/${id}.pdf`;
    await storage.put(key, body, "application/pdf");
    await db.fileObject.create({
      data: { id, ownerId: user.id, kind: "MARKSHEET", storageKey: key, originalName: `${type.toLowerCase()}.pdf`, mimeType: "application/pdf", sizeBytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), scanStatus: "CLEAN" },
    });
    await db.studentDocument.create({ data: { studentId: profile.id, fileId: id, type: type as never, semester, status: state === "verified" ? "ACCEPTED" : "UPLOADED" } });
  }

  if (state === "pending") {
    await db.academicRecord.create({ data: { ...marks, studentId: profile.id, source: "SELF", status: "PENDING" } });
    await db.studentProfile.update({ where: { id: profile.id }, data: { status: "PENDING_VERIFICATION" } });
    await db.reviewTask.create({
      data: { type: "STUDENT_VERIFICATION", risk: "LOW", priority: 10, subjectType: "StudentProfile", subjectId: profile.id, studentId: profile.id, branch, batch },
    });
  } else {
    await db.academicRecord.create({ data: { ...marks, studentId: profile.id, source: "SELF", status: "VERIFIED", verifiedAt: new Date() } });
    await db.studentProfile.update({
      where: { id: profile.id },
      data: { status: "VERIFIED", verifiedAt: new Date(), cgpa: marks.cgpa, activeBacklogs: 0, totalBacklogs: 1, tenthPercent: 90.4, twelfthPercent: 86.2, skills: ["Java", "SQL", "React"] },
    });
  }
}

const day = (d: number, hour = 10) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  t.setHours(hour, 0, 0, 0);
  return t;
};

/** More verified students for eligibility filters (they have no documents and nobody signs in as them). */
async function quietStudents() {
  const people: [string, string, string, number, number, number][] = [
    ["Isha Verma", "24UCSE9201", "CSE", 2027, 9.2, 0],
    ["Karan Singh", "24UCSE9202", "CSE", 2027, 7.4, 0],
    ["Pooja Nair", "24UIT9203", "IT", 2027, 8.6, 0],
    ["Rohit Jain", "24UECE9204", "ECE", 2027, 8.9, 0],
    ["Sneha Rathore", "24UCSE9205", "CSE", 2027, 6.8, 1],
    ["Vikram Choudhary", "24UME9206", "ME", 2027, 7.9, 0],
  ];
  const ids: Record<string, string> = {};
  for (const [name, rollNo, branch, batch, cgpa, activeBacklogs] of people) {
    const email = `${name.split(" ")[0]!.toLowerCase()}.quiet${DOMAIN}`;
    const user = await account(email, name, [{ role: "STUDENT" }]);
    const p = await db.studentProfile.create({
      data: { userId: user.id, rollNo, name, branch, batch, status: "VERIFIED", verifiedAt: new Date(), cgpa, activeBacklogs, totalBacklogs: activeBacklogs, tenthPercent: 85, twelfthPercent: 80 },
    });
    ids[name] = p.id;
  }
  return ids;
}

async function demoDrives(tpoId: string, hrId: string, verifiedUserId: string, quiet: Record<string, string>) {
  const northwind = await db.company.create({
    data: { name: "Northwind Systems", domain: "northwind.test", website: "https://northwind.test", industry: "Software", about: "Builds billing and logistics software for retailers." },
  });
  await db.companyMember.create({ data: { companyId: northwind.id, userId: hrId, role: "HR" } });
  const lakeside = await db.company.create({ data: { name: "Lakeside Labs", domain: "lakeside.test", industry: "Electronics" } });

  // 1. Open drive with five rounds; three students invited, one already joined
  const swe = await db.drive.create({
    data: {
      companyId: northwind.id, createdById: hrId, title: "Software Engineer", roleTitle: "Software Engineer", jobType: "FULL_TIME", ctcLpa: 12, location: "Jaipur", bondMonths: 0,
      description: "Work on the order and billing services used by 400+ retail stores. You will write Java and TypeScript, review code and help run the services in production. Training for the first two months.",
      status: "PUBLISHED", approvedById: tpoId, approvedAt: new Date(), optInDeadline: day(4, 18),
      eligibility: { branches: ["CSE", "IT"], batches: [2027], minCgpa: 7, maxActiveBacklogs: 0 },
      rounds: {
        create: [
          { sequence: 1, type: "OA", title: "Online assessment", mode: "ONLINE", startsAt: day(6, 10), endsAt: day(6, 11), onlineLink: "https://assess.northwind.test/oa", instructions: "90 minutes: 2 coding questions and 20 MCQs. Use a laptop with a webcam." },
          { sequence: 2, type: "TECHNICAL", title: "Technical round 1", mode: "OFFLINE", startsAt: day(8, 10), venue: "CSE block, Lab 2", instructions: "Data structures and problem solving on paper." },
          { sequence: 3, type: "TECHNICAL", title: "Technical round 2", mode: "OFFLINE", startsAt: day(8, 14), venue: "CSE block, Lab 2" },
          { sequence: 4, type: "INTERVIEW", title: "Interview round 1", mode: "OFFLINE", venue: "Placement cell" },
          { sequence: 5, type: "HR", title: "HR round", mode: "OFFLINE", venue: "Placement cell" },
        ],
      },
    },
  });
  const verified = await db.studentProfile.findUniqueOrThrow({ where: { userId: verifiedUserId } });
  const invites = [
    [verified.id, "INVITED"],
    [quiet["Isha Verma"]!, "OPTED_IN"],
    [quiet["Pooja Nair"]!, "INVITED"],
  ] as const;
  for (const [studentId, status] of invites) {
    const joined = status === "OPTED_IN" ? new Date() : null;
    await db.participation.create({ data: { driveId: swe.id, studentId, status, invitedById: hrId, respondedAt: joined, consentAt: joined } });
  }

  // 2. Waiting for the TPO
  await db.drive.create({
    data: {
      companyId: northwind.id, createdById: hrId, title: "Data Analyst Intern", roleTitle: "Data Analyst Intern", jobType: "INTERNSHIP_PPO", stipendMonthly: 30000, location: "Remote",
      description: "Six-month internship with the analytics team: SQL, dashboards and weekly reports for store managers. A full-time offer for good performers.",
      status: "PENDING_APPROVAL", optInDeadline: day(10, 18), eligibility: { branches: ["CSE", "IT", "ECE"], batches: [2027], minCgpa: 7.5 },
      rounds: {
        create: [
          { sequence: 1, type: "OA", title: "Online assessment", mode: "ONLINE", startsAt: day(12, 11) },
          { sequence: 2, type: "GD", title: "Group discussion", mode: "OFFLINE", startsAt: day(14, 10), venue: "Seminar hall" },
          { sequence: 3, type: "INTERVIEW", title: "Interview round 1", mode: "ONLINE" },
        ],
      },
    },
  });

  // 3. Draft, no rounds yet
  await db.drive.create({
    data: { companyId: northwind.id, createdById: hrId, title: "Cloud Support Associate", roleTitle: "Cloud Support Associate", description: "", jobType: "FULL_TIME", eligibility: {} },
  });

  // 4. Another company's open drive: verified.student sees only that it exists
  const embedded = await db.drive.create({
    data: {
      companyId: lakeside.id, createdById: tpoId, title: "Embedded Engineer", roleTitle: "Embedded Engineer", jobType: "FULL_TIME", ctcLpa: 8, location: "Noida",
      description: "Firmware for smart meters: C, RTOS and board bring-up.", status: "PUBLISHED", approvedById: tpoId, approvedAt: new Date(), optInDeadline: day(3, 18),
      eligibility: { branches: ["ECE", "EE"], batches: [2027], minCgpa: 6.5 },
      rounds: { create: [{ sequence: 1, type: "TECHNICAL", title: "Technical round 1", mode: "OFFLINE", startsAt: day(5, 10), venue: "ECE block" }] },
    },
  });
  await db.participation.create({ data: { driveId: embedded.id, studentId: quiet["Rohit Jain"]!, invitedById: tpoId } });

  // 5. Interview-day demo: one interview round, four students already joined. HR starts it, adds panels, makes the lines.
  const support = await db.drive.create({
    data: {
      companyId: northwind.id, createdById: hrId, title: "Support Engineer", roleTitle: "Support Engineer", jobType: "FULL_TIME", ctcLpa: 6, location: "Jaipur", bondMonths: 0,
      description: "Help store teams fix billing and stock issues: read logs, write SQL, talk to customers and hand bugs to the developers.",
      status: "PUBLISHED", approvedById: tpoId, approvedAt: new Date(), optInDeadline: day(2, 18),
      eligibility: { batches: [2027], minCgpa: 7 },
      rounds: { create: [{ sequence: 1, type: "INTERVIEW", title: "Interview round 1", mode: "OFFLINE", startsAt: day(3, 10), venue: "Placement cell" }] },
    },
  });
  const joined = new Date();
  for (const studentId of [verified.id, quiet["Isha Verma"]!, quiet["Karan Singh"]!, quiet["Rohit Jain"]!]) {
    await db.participation.create({ data: { driveId: support.id, studentId, status: "OPTED_IN", invitedById: hrId, respondedAt: joined, consentAt: joined } });
  }

  // 6. Offers demo: final results already out; Aman and Isha selected, Karan not. HR sends offer letters.
  const analyst = await db.drive.create({
    data: {
      companyId: northwind.id, createdById: hrId, title: "Billing Analyst", roleTitle: "Billing Analyst", jobType: "FULL_TIME", ctcLpa: 7.5, location: "Jaipur", bondMonths: 0,
      description: "Check invoices and payment runs for retail customers, find mistakes in the data and fix them with the finance team.",
      status: "RESULTS_DECLARED", approvedById: tpoId, approvedAt: day(-12), optInDeadline: day(-8, 18),
      eligibility: { batches: [2027], minCgpa: 7 },
      rounds: { create: [{ sequence: 1, type: "HR", title: "HR round", mode: "OFFLINE", startsAt: day(-3, 10), venue: "Placement cell", status: "RESULTS_PUBLISHED", resultsPublishedAt: day(-2) }] },
    },
    include: { rounds: true },
  });
  const hrRound = analyst.rounds[0]!;
  for (const [studentId, result] of [[verified.id, "SELECTED"], [quiet["Isha Verma"]!, "SELECTED"], [quiet["Karan Singh"]!, "REJECTED"]] as const) {
    const p = await db.participation.create({
      data: { driveId: analyst.id, studentId, status: result === "SELECTED" ? "SELECTED" : "ELIMINATED", eliminatedAtRoundId: result === "SELECTED" ? null : hrRound.id, invitedById: hrId, invitedAt: day(-12), respondedAt: day(-10), consentAt: day(-10) },
    });
    await db.roundResult.create({ data: { roundId: hrRound.id, participationId: p.id, result, setById: hrId } });
  }
}

try {
  await storage.ensureReady();
  await clearOld();
  const tpo = await account(`tpo${DOMAIN}`, "Demo TPO", [{ role: "TPO" }]);
  const hr = await account(`hr${DOMAIN}`, "Demo HR", [{ role: "COMPANY_HR" }]);
  const interviewer = await account(`interviewer${DOMAIN}`, "Demo Interviewer", [{ role: "INTERVIEWER" }]);
  await account(`staff${DOMAIN}`, "Demo Staff", [{ role: "STAFF", capabilities: ["verify.first", "verify.final", "update_request.decide"] }], true);
  const vol = await account(`volunteer${DOMAIN}`, "Demo Volunteer", [{ role: "VOLUNTEER", capabilities: ["verify.first"] }, { role: "STUDENT" }], false);
  await db.studentProfile.create({ data: { userId: vol.id, rollNo: "22UECE9001", name: "Demo Volunteer", branch: "ECE", batch: 2026 } });
  await studentWithDocs(`new.student${DOMAIN}`, "Neha Sharma", "24UCSE9101", "CSE", 2027, "new");
  await studentWithDocs(`pending.student${DOMAIN}`, "Rahul Meena", "24UCSE9102", "CSE", 2027, "pending");
  await studentWithDocs(`pending.two${DOMAIN}`, "Priya Joshi", "23UCSE9103", "CSE", 2026, "pending");
  await studentWithDocs(`verified.student${DOMAIN}`, "Aman Gupta", "24UIT9104", "IT", 2027, "verified");
  const quiet = await quietStudents();
  const aman = await db.user.findUniqueOrThrow({ where: { email: `verified.student${DOMAIN}` } });
  await demoDrives(tpo.id, hr.id, aman.id, quiet);
  const northwind = await db.company.findUniqueOrThrow({ where: { domain: "northwind.test" } });
  await db.companyMember.create({ data: { companyId: northwind.id, userId: interviewer.id, role: "INTERVIEWER" } });
  console.log(`✔ Demo accounts ready (password for all: see DEMO_PASSWORD in src/scripts/seed-demo.ts)`);
  console.log("  tpo, staff, volunteer, hr, interviewer, new.student, pending.student, pending.two, verified.student  @cyrus.test");
  console.log("  Drives: Northwind Systems (Software Engineer, Support Engineer for interview day, Billing Analyst for offers, one waiting for approval, a draft) and Lakeside Labs");
} finally {
  await db.$disconnect();
}
