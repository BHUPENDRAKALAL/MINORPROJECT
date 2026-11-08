import { expect, test } from "@playwright/test";
import { demo, drainQueue, latestEmail, openTaskFor, pendingStudent, signIn, signOut } from "./helpers";

test.describe("review queue", () => {
  test("staff verify a student; the student is told by email and sees Verified", async ({ page, request }) => {
    const s = await pendingStudent(request, { name: "Verify Me" });
    await signIn(page, demo("staff"));
    await openTaskFor(page, s.rollNo);

    await expect(page.getByText("Profile check")).toBeVisible();
    await expect(page.getByText("7.9", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open" })).toHaveCount(3);
    // A reviewer never sees the student's email or phone
    await expect(page.getByText(s.email)).toHaveCount(0);

    // Documents open through a short-lived signed link
    const href = await page.getByRole("link", { name: "Open" }).first().getAttribute("href");
    const file = await request.get(href!);
    expect(file.status()).toBe(200);
    expect((await file.body()).subarray(0, 4).toString()).toBe("%PDF");

    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByText("Done. The student has been told.")).toBeVisible();

    expect((await latestEmail(request, s.email, "verified")).subject).toContain("verified");
    await signOut(page);
    await signIn(page, s.email, s.password);
    await expect(page.getByText("Verified", { exact: true }).first()).toBeVisible();
  });

  test("the TPO rejects with a reason; the student sees what to fix and can send again", async ({ page, request }) => {
    const s = await pendingStudent(request, { name: "Fix Me" });
    await signIn(page, demo("tpo"));
    await openTaskFor(page, s.rollNo);

    await page.getByRole("button", { name: "Reject…" }).click();
    await page.getByRole("button", { name: "Reject with this reason" }).click();
    await expect(page.getByText("Pick a reason.")).toBeVisible();
    await page.getByLabel("Reason").selectOption({ label: "Marks don't match the marksheet" });
    await page.getByLabel("Note for the student").fill("CGPA on the grade card is 7.6, not 7.9.");
    await page.getByRole("button", { name: "Reject with this reason" }).click();
    await expect(page.getByText("Done. The student has been told.")).toBeVisible();

    expect((await latestEmail(request, s.email, "needs changes")).text).toContain("CGPA on the grade card is 7.6");
    await signOut(page);
    await signIn(page, s.email, s.password);
    await page.goto("/student/profile");
    await expect(page.locator(".banner-title", { hasText: "Your profile needs changes" })).toBeVisible();
    await expect(page.getByText("Marks don't match the marksheet.")).toBeVisible();
    await expect(page.getByText("CGPA on the grade card is 7.6, not 7.9.")).toBeVisible();
    await page.getByLabel("CGPA (out of 10)").fill("7.6");
    await page.getByRole("button", { name: "Save marks" }).click();
    await page.getByRole("button", { name: "Send again for verification" }).click();
    await expect(page.locator(".banner-title", { hasText: "Your profile is being checked" })).toBeVisible();
  });

  test("a volunteer accepts the pledge, approves, and staff do the second check", async ({ page, request }) => {
    // Start from an empty queue so the volunteer's next task is ours
    await signIn(page, demo("staff"));
    await drainQueue(page);
    await signOut(page);

    const s = await pendingStudent(request, { name: "Second Check", branch: "CSE", batch: 2027 });
    await signIn(page, demo("volunteer"));
    // The volunteer is also a student: the role switcher picks the office area for the queue
    await page.goto("/office/review");
    await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();
    // The button stays off until the pledge box is ticked
    await expect(page.getByRole("button", { name: "Accept and start" })).toBeDisabled();
    await page.getByLabel("I'll keep everything I see private.").check();
    await page.getByRole("button", { name: "Accept and start" }).click();

    await page.getByRole("button", { name: "Get next task" }).click();
    await expect(page.getByText(s.rollNo, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByText(/A staff member will do a quick second check/)).toBeVisible();
    await signOut(page);

    await signIn(page, demo("staff"));
    await page.goto("/office/review");
    await page.getByRole("button", { name: "Get next task" }).click();
    await expect(page.getByText("Second check")).toBeVisible();
    await expect(page.getByText(/First reviewer:/)).toBeVisible();
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByText("Done. The student has been told.")).toBeVisible();

    expect((await latestEmail(request, s.email, "verified")).subject).toContain("verified");
  });

  test("a reviewer can ask the TPO, who then decides", async ({ page, request }) => {
    const s = await pendingStudent(request, { name: "Ask Tpo" });
    await signIn(page, demo("staff"));
    await openTaskFor(page, s.rollNo);
    await page.getByRole("button", { name: "Ask the TPO" }).click();
    await page.getByLabel("What are you unsure about?").fill("Class 12 marksheet looks edited.");
    await page.getByRole("button", { name: "Send to the TPO" }).click();
    await expect(page.getByText("Sent to the TPO.")).toBeVisible();
    await signOut(page);

    await signIn(page, demo("tpo"));
    await openTaskFor(page, s.rollNo);
    await expect(page.getByText("Class 12 marksheet looks edited.")).toBeVisible();
    await page.getByRole("button", { name: "Reject…" }).click();
    await page.getByLabel("Reason").selectOption({ label: "Wrong document uploaded" });
    await page.getByRole("button", { name: "Reject with this reason" }).click();
    await expect(page.getByText("Done. The student has been told.")).toBeVisible();
  });
});
