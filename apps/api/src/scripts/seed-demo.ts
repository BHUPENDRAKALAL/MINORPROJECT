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
 *   verified.student@cyrus.test Student   already verified
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

try {
  await storage.ensureReady();
  await clearOld();
  await account(`tpo${DOMAIN}`, "Demo TPO", [{ role: "TPO" }]);
  await account(`staff${DOMAIN}`, "Demo Staff", [{ role: "STAFF", capabilities: ["verify.first", "verify.final", "update_request.decide"] }], true);
  const vol = await account(`volunteer${DOMAIN}`, "Demo Volunteer", [{ role: "VOLUNTEER", capabilities: ["verify.first"] }, { role: "STUDENT" }], false);
  await db.studentProfile.create({ data: { userId: vol.id, rollNo: "22UECE9001", name: "Demo Volunteer", branch: "ECE", batch: 2026 } });
  await studentWithDocs(`new.student${DOMAIN}`, "Neha Sharma", "24UCSE9101", "CSE", 2027, "new");
  await studentWithDocs(`pending.student${DOMAIN}`, "Rahul Meena", "24UCSE9102", "CSE", 2027, "pending");
  await studentWithDocs(`pending.two${DOMAIN}`, "Priya Joshi", "23UCSE9103", "CSE", 2026, "pending");
  await studentWithDocs(`verified.student${DOMAIN}`, "Aman Gupta", "24UIT9104", "IT", 2027, "verified");
  console.log(`✔ Demo accounts ready (password for all: see DEMO_PASSWORD in src/scripts/seed-demo.ts)`);
  console.log("  tpo, staff, volunteer, new.student, pending.student, pending.two, verified.student  @cyrus.test");
} finally {
  await db.$disconnect();
}
