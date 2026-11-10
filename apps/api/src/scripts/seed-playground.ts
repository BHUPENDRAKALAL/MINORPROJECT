/**
 * Playground data for trying a whole drive by hand (development only). Run it AFTER seed:demo:
 *
 *   pnpm --filter @cyrus/api seed:playground          add (or re-add) the playground
 *   pnpm --filter @cyrus/api seed:playground --clear  remove it again
 *
 * Adds 15 verified students (@play.test, same password as the demo accounts: DEMO_PASSWORD in
 * seed-demo.ts) with marksheets and a resume, spread over branches, batches, CGPA, backlogs and
 * class 10/12/diploma marks so eligibility filters have something to find. One is already placed
 * (the college's rules leave placed students out), one came in by lateral entry (diploma, no class 12).
 * Also adds a second interviewer to Northwind Systems so HR can run two panels at once.
 *
 * The e2e run clears the playground first (its counts assume only the demo students), so run this
 * again after an e2e run. Refuses to run in production.
 */
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { loadEnv } from "../config/env.ts";
import { createDb } from "../lib/db.ts";
import { hashPassword } from "../lib/crypto.ts";
import { s3Storage } from "../lib/storage.ts";

const DOMAIN = "@play.test";
const PASSWORD = (() => {
  const m = readFileSync(new URL("./seed-demo.ts", import.meta.url), "utf8").match(/DEMO_PASSWORD = "([^"]+)"/);
  if (!m) throw new Error("DEMO_PASSWORD not found in seed-demo.ts");
  return m[1]!;
})();

const env = loadEnv();
if (env.NODE_ENV === "production") {
  console.error("seed:playground refuses to run in production.");
  process.exit(1);
}
const db = createDb(env.DATABASE_URL);
const storage = s3Storage(env);

type Person = {
  name: string;
  roll: string;
  branch: string;
  batch: number;
  cgpa: number;
  active: number;
  total: number;
  tenth: number;
  twelfth: number | null;
  diploma?: number;
  skills: string[];
  placed?: boolean;
};

// Varied on purpose: try filters like "CSE and IT, 2027, CGPA 7.5+, no active backlogs, class 12 ≥ 70".
const PEOPLE: Person[] = [
  { name: "Ananya Sharma", roll: "24UCSE7001", branch: "CSE", batch: 2027, cgpa: 9.4, active: 0, total: 0, tenth: 95.2, twelfth: 93.0, skills: ["Python", "Machine learning", "SQL"] },
  { name: "Arjun Mehta", roll: "24UCSE7002", branch: "CSE", batch: 2027, cgpa: 8.7, active: 0, total: 0, tenth: 91.0, twelfth: 88.4, skills: ["Java", "Spring", "React"] },
  { name: "Divya Rao", roll: "24UCSE7003", branch: "CSE", batch: 2027, cgpa: 7.6, active: 0, total: 1, tenth: 84.6, twelfth: 79.2, skills: ["C++", "DSA", "Node.js"] },
  { name: "Harsh Vardhan", roll: "24UCSE7004", branch: "CSE", batch: 2027, cgpa: 6.4, active: 2, total: 3, tenth: 72.0, twelfth: 65.8, skills: ["HTML", "CSS", "JavaScript"] },
  { name: "Meera Iyer", roll: "24UIT7005", branch: "IT", batch: 2027, cgpa: 8.9, active: 0, total: 0, tenth: 93.4, twelfth: 90.2, skills: ["Go", "Docker", "Kubernetes"] },
  { name: "Nikhil Bansal", roll: "24UIT7006", branch: "IT", batch: 2027, cgpa: 7.1, active: 1, total: 2, tenth: 80.0, twelfth: 74.6, skills: ["PHP", "MySQL", "Laravel"] },
  { name: "Riya Kapoor", roll: "23UIT7007", branch: "IT", batch: 2026, cgpa: 8.2, active: 0, total: 0, tenth: 88.8, twelfth: 85.0, skills: ["Flutter", "Firebase", "Kotlin"] },
  { name: "Saurabh Gehlot", roll: "24UECE7008", branch: "ECE", batch: 2027, cgpa: 8.4, active: 0, total: 0, tenth: 90.0, twelfth: 87.6, skills: ["Embedded C", "VLSI", "MATLAB"] },
  { name: "Tanvi Joshi", roll: "24UECE7009", branch: "ECE", batch: 2027, cgpa: 7.8, active: 0, total: 1, tenth: 86.2, twelfth: null, diploma: 81.5, skills: ["IoT", "Arduino", "Python"] },
  { name: "Yash Purohit", roll: "23UECE7010", branch: "ECE", batch: 2026, cgpa: 6.9, active: 1, total: 1, tenth: 76.4, twelfth: 70.2, skills: ["Signal processing", "Verilog"] },
  { name: "Kavya Rathi", roll: "24UEE7011", branch: "EE", batch: 2027, cgpa: 8.0, active: 0, total: 0, tenth: 87.0, twelfth: 83.4, skills: ["Power systems", "PLC", "AutoCAD"] },
  { name: "Manish Choudhary", roll: "24UEE7012", branch: "EE", batch: 2027, cgpa: 7.3, active: 0, total: 2, tenth: 79.8, twelfth: 72.0, skills: ["Control systems", "Simulink"] },
  { name: "Prateek Soni", roll: "24UME7013", branch: "ME", batch: 2027, cgpa: 7.9, active: 0, total: 0, tenth: 85.0, twelfth: 80.6, skills: ["SolidWorks", "ANSYS", "CAD"] },
  { name: "Simran Kaur", roll: "23UME7014", branch: "ME", batch: 2026, cgpa: 9.1, active: 0, total: 0, tenth: 94.0, twelfth: 91.8, skills: ["Thermodynamics", "CATIA", "Python"], placed: true },
  { name: "Aditya Bhati", roll: "24UCE7015", branch: "CE", batch: 2027, cgpa: 7.0, active: 0, total: 1, tenth: 78.0, twelfth: 73.4, skills: ["STAAD Pro", "Revit", "Surveying"] },
];

/** A small, valid one-page PDF with a line of text, standing in for a marksheet or resume. */
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

async function file(ownerId: string, kind: "MARKSHEET" | "RESUME", name: string, line: string) {
  const body = pdf(line);
  const id = randomUUID();
  const key = `${kind.toLowerCase()}/playground/${id}.pdf`;
  await storage.put(key, body, "application/pdf");
  await db.fileObject.create({
    data: { id, ownerId, kind, storageKey: key, originalName: name, mimeType: "application/pdf", sizeBytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), scanStatus: "CLEAN" },
  });
  return id;
}

/** Removes everything this script made (playground students, their files and records, the second interviewer). */
async function clearPlayground() {
  const users = await db.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return 0;
  const students = await db.studentProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const sIds = students.map((s) => s.id);
  const files = await db.fileObject.findMany({ where: { ownerId: { in: ids } }, select: { id: true, storageKey: true } });
  await db.placementRecord.deleteMany({ where: { studentId: { in: sIds } } });
  await db.offer.deleteMany({ where: { participation: { studentId: { in: sIds } } } });
  await db.$transaction(async (tx) => {
    await tx.participation.deleteMany({ where: { studentId: { in: sIds } } });
    await tx.reviewTask.deleteMany({ where: { studentId: { in: sIds } } });
    await tx.notification.deleteMany({ where: { userId: { in: ids } } });
    await tx.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
    await tx.fileObject.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
  });
  for (const f of files) await storage.remove(f.storageKey).catch(() => undefined);
  return ids.length;
}

async function addStudent(p: Person, passwordHash: string) {
  const email = `${p.name.split(" ")[0]!.toLowerCase()}${DOMAIN}`;
  // The phone lives on the user (it's shared with a company only after the student joins its drive).
  const user = await db.user.create({ data: { email, name: p.name, passwordHash, emailVerifiedAt: new Date(), phone: `+91 98${p.roll.slice(-6).padStart(8, "0")}` } });
  await db.roleGrant.create({ data: { userId: user.id, role: "STUDENT", capabilities: [], scope: {} } });
  const resume = await file(user.id, "RESUME", "resume.pdf", `Resume - ${p.name} - ${p.branch} ${p.batch} - ${p.skills.join(", ")}`);
  const profile = await db.studentProfile.create({
    data: {
      userId: user.id,
      rollNo: p.roll,
      name: p.name,
      branch: p.branch,
      batch: p.batch,
      status: "VERIFIED",
      verifiedAt: new Date(),
      cgpa: p.cgpa,
      activeBacklogs: p.active,
      totalBacklogs: p.total,
      tenthPercent: p.tenth,
      twelfthPercent: p.twelfth,
      diplomaPercent: p.diploma ?? null,
      skills: p.skills,
      resumeFileId: resume,
      placementStatus: p.placed ? "PLACED" : "NOT_PLACED",
    },
  });
  const docs: [string, string, number | null][] = [
    ["MARKSHEET_10", `Class 10 marksheet - ${p.name} - ${p.tenth}%`, null],
    p.twelfth !== null ? ["MARKSHEET_12", `Class 12 marksheet - ${p.name} - ${p.twelfth}%`, null] : ["DIPLOMA", `Diploma marksheet - ${p.name} - ${p.diploma}%`, null],
    ["SEMESTER_MARKSHEET", `Semester grade card - ${p.roll} - CGPA ${p.cgpa.toFixed(2)}`, 5],
  ];
  for (const [type, line, semester] of docs) {
    const id = await file(user.id, "MARKSHEET", `${type.toLowerCase()}.pdf`, line);
    await db.studentDocument.create({ data: { studentId: profile.id, fileId: id, type: type as never, semester, status: "ACCEPTED" } });
  }
  await db.academicRecord.create({
    data: {
      studentId: profile.id,
      source: "SELF",
      status: "VERIFIED",
      verifiedAt: new Date(),
      cgpa: p.cgpa,
      activeBacklogs: p.active,
      totalBacklogs: p.total,
      tenthPercent: p.tenth,
      twelfthPercent: p.twelfth,
      diplomaPercent: p.diploma ?? null,
      semester: 5,
    },
  });
  return email;
}

try {
  await storage.ensureReady();
  const removed = await clearPlayground();
  if (process.argv.includes("--clear")) {
    console.log(`✔ Playground removed (${removed} accounts)`);
  } else {
    const passwordHash = await hashPassword(PASSWORD);
    const emails: string[] = [];
    for (const p of PEOPLE) emails.push(await addStudent(p, passwordHash));

    // A second interviewer, so HR can run two panels side by side.
    const northwind = await db.company.findUnique({ where: { domain: "northwind.test" } });
    let second = "skipped (run seed:demo first: Northwind Systems is missing)";
    if (northwind) {
      const iv = await db.user.create({ data: { email: `interviewer2${DOMAIN}`, name: "Second Interviewer", passwordHash, emailVerifiedAt: new Date() } });
      await db.roleGrant.create({ data: { userId: iv.id, role: "INTERVIEWER", capabilities: [], scope: {} } });
      await db.companyMember.create({ data: { companyId: northwind.id, userId: iv.id, role: "INTERVIEWER" } });
      second = `interviewer2${DOMAIN} (Northwind Systems)`;
    }
    console.log(`✔ Playground ready: ${PEOPLE.length} verified students (password: DEMO_PASSWORD in seed-demo.ts)`);
    for (const [i, e] of emails.entries()) {
      const p = PEOPLE[i]!;
      console.log(`  ${e.padEnd(22)} ${p.branch.padEnd(4)} ${p.batch}  CGPA ${p.cgpa.toFixed(1)}  backlogs ${p.active}${p.placed ? "  (placed)" : ""}${p.twelfth === null ? "  (diploma)" : ""}`);
    }
    console.log(`  Second interviewer: ${second}`);
  }
} finally {
  await db.$disconnect();
}
