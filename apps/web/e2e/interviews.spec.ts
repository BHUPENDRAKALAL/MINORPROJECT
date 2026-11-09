import { expect, test, type Page } from "@playwright/test";
import { demo, signIn, signOut } from "./helpers";

/** SHOTS=1 saves screenshots to .review/ (git-ignored) for a design check. */
const shot = async (p: Page, name: string) => {
  if (!process.env.SHOTS) return;
  await p.waitForTimeout(900);
  await p.screenshot({ path: `.review/interview-${name}.png`, fullPage: true });
};

// Uses the demo drive "Northwind Systems · Support Engineer": one interview round, four students joined.
test("interview day: HR sets up a panel, the interviewer runs the line, the TPO checks the remark, the student sees it", async ({ page, browser }) => {
  page.on("dialog", (d) => void d.accept());

  // ── HR: start the round, add a panel with the interviewer, make the lines
  await signIn(page, demo("hr"));
  await page.getByRole("link", { name: /Support Engineer/ }).click();
  await page.getByRole("link", { name: "Interview round 1" }).click();
  await page.getByRole("button", { name: "Start the round" }).click();
  await expect(page.getByText("Round started. Students have been told.")).toBeVisible();
  await page.getByLabel("Panel name").fill("Panel A");
  await page.getByLabel("Room").fill("Room 204");
  await page.getByLabel(/Demo Interviewer/).check();
  await page.getByRole("button", { name: "Add panel" }).click();
  await expect(page.getByRole("link", { name: "Open panel" })).toBeVisible();
  await page.getByRole("button", { name: "Make the interview lines" }).click();
  await expect(page.getByText("Added 4 students to the lines.")).toBeVisible();
  await shot(page, "1-round-panels");
  await signOut(page);

  // ── The student sees their place in line
  const phone = await browser.newContext();
  const student = await phone.newPage();
  await signIn(student, demo("verified.student"));
  await student.goto("/student/drives");
  await student.getByRole("link", { name: /Support Engineer/ }).click();
  await expect(student.getByText(/You're number \d in line for Panel A \(Room 204\), about \d+ min/)).toBeVisible();

  // ── Interviewer: My panels → the panel → call the line until Aman is up
  await signIn(page, demo("interviewer"));
  await expect(page.getByRole("heading", { name: "My panels" })).toBeVisible();
  await page.getByRole("link", { name: /Panel A/ }).click();
  await expect(page.getByText("4 waiting")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Call next" }).click();
    const current = page.getByRole("region", { name: "Current student" });
    await expect(current).toBeVisible();
    if (await current.getByText("Aman Gupta").isVisible()) break;
    await page.getByRole("button", { name: "They're here: start" }).click();
    await page.getByRole("button", { name: "End interview" }).click();
    await expect(current).toHaveCount(0);
  }

  // Aman is called: his page says so
  await student.reload();
  await expect(student.getByText("Your turn: go to Room 204 now")).toBeVisible();
  await shot(student, "2-student-your-turn");

  await page.getByRole("button", { name: "They're here: start" }).click();
  await expect(page.getByText(/In interview ·/)).toBeVisible();
  await page.getByLabel(/Private notes/).fill("Calm under pressure. Needs more SQL practice.");
  await page.getByLabel("Select", { exact: true }).check();
  await page.getByLabel(/Remark for the student/).fill("Good communication. Practise SQL joins.");
  await shot(page, "3-panel-in-interview");
  await page.getByRole("button", { name: "End interview" }).click();
  await expect(page.locator(".cy-line li", { hasText: "Aman Gupta" }).locator("summary")).toHaveText("Select");
  await signOut(page);

  // The remark isn't shown until the TPO sends it; private notes never are
  await student.reload();
  await expect(student.getByText("Interview done")).toBeVisible();
  await expect(student.getByText("Practise SQL joins")).toHaveCount(0);
  await expect(student.getByText("Needs more SQL practice")).toHaveCount(0);

  // ── TPO: Feedback to check → reword and send
  await signIn(page, demo("tpo"));
  await page.goto("/office/drives");
  await page.getByRole("link", { name: /Support Engineer/ }).click();
  await page.getByRole("link", { name: "Feedback to check" }).click();
  await page.getByLabel("Remark for Aman Gupta").fill("Good communication. Practise SQL joins before your next interview.");
  await page.getByRole("button", { name: "Send to the student" }).click();
  await expect(page.getByText("Reworded and sent")).toBeVisible();

  // ── HR sees the panel's recommendation next to the result
  await signOut(page);
  await signIn(page, demo("hr"));
  await page.getByRole("link", { name: /Support Engineer/ }).click();
  await page.getByRole("link", { name: "Interview round 1" }).click();
  await expect(page.getByRole("row", { name: /Aman Gupta/ }).getByText(/Panel A: Select/)).toBeVisible();
  await page.getByRole("button", { name: "Use panel recommendations" }).click();
  await expect(page.getByLabel("Result for Aman Gupta")).toHaveValue("SELECTED");
  await shot(page, "4-results-with-panel");

  // ── The student reads the remark
  await student.reload();
  await expect(student.getByText("Practise SQL joins before your next interview.")).toBeVisible();
  await shot(student, "5-student-remark");
  await phone.close();
});
