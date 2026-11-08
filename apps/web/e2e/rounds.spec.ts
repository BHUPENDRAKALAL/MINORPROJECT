import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demo, signIn, signOut } from "./helpers";

/** SHOTS=1 saves screenshots of each screen to .review/ (git-ignored) for a design check. */
const shot = async (p: Page, name: string) => {
  if (!process.env.SHOTS) return;
  await p.waitForTimeout(900); // let the entrance animation finish
  await p.screenshot({ path: `.review/round-${name}.png`, fullPage: true });
};

// Uses the demo drive "Northwind Systems · Software Engineer" (OA online → Technical 1 on campus → …).
// Isha has joined; Aman (verified.student) joins here; Pooja never answers.
test("HR runs rounds: CSV results, QR check-in at the venue, publish; the student sees each result", async ({ page, browser }) => {
  page.on("dialog", (d) => void d.accept());

  await signIn(page, demo("verified.student"));
  await page.goto("/student/drives");
  await page.getByRole("link", { name: /Software Engineer/ }).first().click();
  await page.getByLabel(/I agree to share my profile/).check();
  await page.getByRole("button", { name: "Join the drive" }).click();
  await expect(page.getByText("You've joined this drive")).toBeVisible();
  await signOut(page);

  // ── Round 1: online assessment, results from the test platform's CSV
  await signIn(page, demo("hr"));
  await page.getByRole("link", { name: /Software Engineer/ }).click();
  await page.getByRole("link", { name: "Online assessment" }).click();
  await expect(page.locator(".banner-title", { hasText: "Not started" })).toBeVisible();
  await page.getByRole("button", { name: "Start the round" }).click();
  await expect(page.getByText("Round started. Students have been told.")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "hackerrank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,Roll Number,Score,Status\nAman,24UIT9104,81,Qualified\nIsha,24UCSE9201,92,Qualified\nGhost,24UXX0000,99,Qualified\n"),
  });
  await shot(page, "1-oa-started");
  await expect(page.getByText(/Imported 2 results from hackerrank\.csv\. Not in this round: 24UXX0000/)).toBeVisible();
  await page.getByRole("button", { name: "Publish results" }).click();
  await expect(page.getByText("Results published. Everyone has been told.")).toBeVisible();

  // ── Round 2: on campus, check-in with the rotating QR (no location check here)
  await page.getByRole("link", { name: "Software Engineer" }).click();
  await page.getByRole("link", { name: "Technical round 1" }).click();
  await page.getByRole("button", { name: "Start the round" }).click();
  await page.getByLabel(/Only allow check-in near where I am/).uncheck();
  await page.getByRole("button", { name: "Open check-in" }).click();
  const qr = page.getByRole("img", { name: "Check-in QR code" });
  await expect(qr.locator("svg")).toBeVisible();
  const url = new URL((await qr.getAttribute("data-url"))!);
  await shot(page, "2-checkin-open");

  // The student scans it on their own phone
  const phone = await browser.newContext();
  const student = await phone.newPage();
  await signIn(student, demo("verified.student"));
  await student.goto(url.pathname + url.search);
  await expect(student.getByRole("heading", { name: "You're checked in" })).toBeVisible();
  await expect(student.getByText("Technical round 1")).toBeVisible();
  await shot(student, "3-student-checked-in");

  // The venue screen counts them; Isha never came
  await expect(page.locator(".cy-qr-count")).toContainText("1 of 2 checked in", { timeout: 15_000 });
  await page.getByRole("button", { name: "Close check-in" }).click();
  await page.reload();
  await page.getByLabel("Result for Aman Gupta").selectOption("SELECTED");
  await expect(page.getByRole("row", { name: /Isha Verma/ }).getByText("Absent")).toBeVisible();
  await shot(page, "4-results-table");
  await page.getByRole("button", { name: "Save 1 change" }).click();
  await expect(page.getByText("Results saved. Not visible to students yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish results" }).click();
  await expect(page.getByText("Results published. Everyone has been told.")).toBeVisible();

  // ── The student sees both results
  await student.goto("/student/drives");
  await student.getByRole("link", { name: /Software Engineer/ }).first().click();
  await expect(student.getByText("You cleared this round")).toHaveCount(2);
  await shot(student, "5-student-drive");
  await expect(student.getByText("Checked in", { exact: true })).toBeVisible();
  await phone.close();
});
