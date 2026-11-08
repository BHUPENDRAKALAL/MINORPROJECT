import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const API = "http://localhost:4000/api/v1";
const MAILPIT = "http://localhost:8025/api/v1";

/** The shared demo password lives in the seed script; read it from there instead of copying it. */
export const DEMO_PASSWORD = (() => {
  const src = readFileSync(path.resolve(import.meta.dirname, "../../api/src/scripts/seed-demo.ts"), "utf8");
  const m = src.match(/DEMO_PASSWORD = "([^"]+)"/);
  if (!m) throw new Error("DEMO_PASSWORD not found in seed-demo.ts");
  return m[1]!;
})();
export const demo = (who: string) => `${who}@cyrus.test`;

let counter = 0;
/** A unique email for a student created during this run. Cleaned up by global-setup next time. */
export function freshEmail(tag: string) {
  counter += 1;
  return `${tag}.${Date.now().toString(36)}${counter}@e2e.test`;
}
export function freshRoll() {
  counter += 1;
  return `24UE2E${(Date.now() % 100000).toString().padStart(5, "0")}${counter}`.slice(0, 14);
}

/** Waits for the latest email to `to` in Mailpit and returns its text. */
export async function latestEmail(
  request: APIRequestContext,
  to: string,
  subjectIncludes?: string,
  /** Only emails received after this moment (to skip an older email with the same subject). */
  since?: Date,
  /** Only emails whose body contains this (e.g. a reset code vs a sign-up code; both share a subject). */
  textIncludes?: string,
): Promise<{ subject: string; text: string }> {
  for (let i = 0; i < 40; i++) {
    const res = await request.get(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const list = (await res.json()) as { messages: { ID: string; Subject: string; Created: string }[] };
    const hits = list.messages
      .filter((m) => !since || new Date(m.Created).getTime() >= since.getTime() - 1000)
      .sort((a, b) => b.Created.localeCompare(a.Created))
      .filter((m) => !subjectIncludes || m.Subject.includes(subjectIncludes));
    for (const hit of hits) {
      const msg = (await (await request.get(`${MAILPIT}/message/${hit.ID}`)).json()) as { Subject: string; Text: string };
      if (!textIncludes || msg.Text.includes(textIncludes)) return { subject: msg.Subject, text: msg.Text };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to}${subjectIncludes ? ` about "${subjectIncludes}"` : ""}`);
}

export const codeIn = (text: string) => text.match(/\b(\d{6})\b/)![1]!;

/** Signs in through the real sign-in page and waits for the home page of the account's role. */
export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

export async function signOut(page: Page) {
  await page.request.post(`${API}/auth/logout`);
  await page.context().clearCookies();
}

/** A small valid PDF standing in for a marksheet. */
export function pdf(line: string): Buffer {
  const text = line.replace(/[()\\]/g, "");
  const content = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
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

/**
 * Builds a student who has sent their profile for verification, entirely through the API
 * (sign-up, email code from Mailpit, uploads, marks, submit), and waits for the virus scan.
 */
export async function pendingStudent(request: APIRequestContext, opts: { branch?: string; batch?: number; name?: string } = {}) {
  const email = freshEmail("pending");
  const rollNo = freshRoll();
  const name = opts.name ?? "Test Pending";
  await expect((await request.post(`${API}/auth/student/signup`, { data: { email, password: "e2e-pass-1234", rollNo, name, branch: opts.branch ?? "CSE", batch: opts.batch ?? 2027 } })).status()).toBe(201);
  const code = codeIn((await latestEmail(request, email, "code")).text);
  const verified = await request.post(`${API}/auth/student/verify-email`, { data: { email, code } });
  const token = ((await verified.json()) as { accessToken: string }).accessToken;
  const auth = { authorization: `Bearer ${token}` };
  for (const [type, semester] of [["MARKSHEET_10", null], ["MARKSHEET_12", null], ["SEMESTER_MARKSHEET", 5]] as const) {
    const up = await request.post(`${API}/files?kind=MARKSHEET`, {
      headers: auth,
      multipart: { file: { name: `${type}.pdf`, mimeType: "application/pdf", buffer: pdf(`${type} ${rollNo} ${Date.now()}`) } },
    });
    expect(up.status()).toBe(201);
    const fileId = ((await up.json()) as { id: string }).id;
    expect((await request.post(`${API}/students/me/documents`, { headers: auth, data: { fileId, type, semester } })).status()).toBe(200);
  }
  expect(
    (await request.put(`${API}/students/me/academics`, { headers: auth, data: { cgpa: 7.9, activeBacklogs: 0, totalBacklogs: 0, tenthPercent: 85, twelfthPercent: 80, semester: 5 } })).status(),
  ).toBe(200);
  expect((await request.post(`${API}/students/me/submit`, { headers: auth })).status()).toBe(200);
  // Wait until the worker has scanned the files, so reviewers can open them.
  for (let i = 0; i < 40; i++) {
    const me = (await (await request.get(`${API}/students/me`, { headers: auth })).json()) as { documents: { file: { scanStatus: string } }[] };
    if (me.documents.every((d) => d.file.scanStatus === "CLEAN")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { email, rollNo, name, password: "e2e-pass-1234", token };
}

/**
 * Takes tasks from the queue until it gets the one for `rollNo`. Other tasks in the way are
 * verified (use with staff or the TPO, whose decisions are final), so the queue keeps moving.
 */
export async function openTaskFor(page: Page, rollNo: string) {
  await page.goto("/office/review");
  for (let i = 0; i < 15; i++) {
    const holding = page.locator(".cy-lock");
    if (!(await holding.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Get next task" }).click();
      await expect(holding).toBeVisible();
    }
    if (await page.getByText(rollNo, { exact: true }).isVisible()) return;
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByRole("button", { name: "Get next task" })).toBeVisible();
  }
  throw new Error(`Never got the task for ${rollNo}`);
}

/** Clears every task a staff member can take (verifying them), so the next test starts from an empty queue. */
export async function drainQueue(page: Page) {
  await page.goto("/office/review");
  for (let i = 0; i < 30; i++) {
    const holding = page.locator(".cy-lock");
    if (!(await holding.isVisible().catch(() => false))) {
      const next = page.getByRole("button", { name: "Get next task" });
      await expect(next).toBeVisible();
      if (await next.isDisabled()) return;
      await next.click();
      await expect(holding.or(page.getByText("Nothing is waiting for you"))).toBeVisible();
      if (!(await holding.isVisible())) return;
    }
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByRole("button", { name: "Get next task" })).toBeVisible();
  }
}
