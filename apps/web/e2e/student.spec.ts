import { expect, test } from "@playwright/test";
import { codeIn, freshEmail, freshRoll, latestEmail, pdf } from "./helpers";

test("a student fills the profile, uploads marksheets, sends it, withdraws and sends again", async ({ page, request }) => {
  // A brand-new student for this test
  const email = freshEmail("profile");
  await page.goto("/sign-up");
  await page.getByLabel("Roll number").fill(freshRoll());
  await page.getByLabel("Full name").fill("Meera Iyer");
  await page.getByLabel("Branch").selectOption("ECE");
  await page.getByLabel("Graduation year").fill("2027");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("meera-pass-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("6-digit code").fill(codeIn((await latestEmail(request, email, "code")).text));
  await page.getByRole("button", { name: "Confirm email" }).click();
  await page.getByRole("button", { name: "Go to my home" }).click();

  await page.getByRole("link", { name: "Complete your profile" }).click();
  await expect(page).toHaveURL(/student\/profile/);
  await expect(page.getByText("Complete your profile").first()).toBeVisible();
  await expect(page.locator(".cy-missing li")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Send for verification" })).toBeDisabled();

  // Details (always editable)
  await page.getByLabel("Phone").fill("+91 98765 43210");
  await page.getByLabel("Skills").fill("Embedded C, MATLAB");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  // Marks: a wrong value is caught by the API and shown on the field
  await page.getByLabel("CGPA", { exact: true }).fill("12");
  await page.getByLabel("Class 10", { exact: true }).fill("88");
  await page.getByLabel("Class 12 (optional)").fill("84");
  await page.getByRole("button", { name: "Save marks" }).click();
  await expect(page.getByText("CGPA is out of 10.")).toBeVisible();
  await page.getByLabel("CGPA", { exact: true }).fill("8.05");
  await page.getByLabel("Up to semester").selectOption("5");
  await page.getByRole("button", { name: "Save marks" }).click();
  await expect(page.locator(".cy-missing li")).toHaveCount(3);

  // A text file pretending to be a PDF is refused
  const rows = page.locator(".cy-doc");
  await rows.nth(0).locator('input[type="file"]').setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") });
  await expect(page.getByText(/file type isn't accepted/)).toBeVisible();

  // A file that starts like a PDF but isn't one passes the type check, then the worker can't rebuild it:
  // the student is told why and can upload again
  const broken = Buffer.from(["%PDF-1.4", "this is not really a pdf", ""].join("\n"));
  await rows.nth(0).locator('input[type="file"]').setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: broken });
  await expect(rows.nth(0).getByText("Not accepted: upload again")).toBeVisible({ timeout: 20_000 });
  await expect(rows.nth(0).getByText(/damaged or not a real PDF/)).toBeVisible();

  // Real uploads
  await rows.nth(0).locator('input[type="file"]').setInputFiles({ name: "class10.pdf", mimeType: "application/pdf", buffer: pdf("Class 10 Meera") });
  await expect(rows.nth(0).getByText("class10.pdf")).toBeVisible();
  await rows.nth(1).locator('input[type="file"]').setInputFiles({ name: "class12.pdf", mimeType: "application/pdf", buffer: pdf("Class 12 Meera") });
  await expect(rows.nth(1).getByText("class12.pdf")).toBeVisible();
  const add = page.locator(".cy-doc").filter({ hasText: "Add a semester marksheet" });
  await add.getByLabel("Semester").selectOption("5");
  await add.locator('input[type="file"]').setInputFiles({ name: "sem5.pdf", mimeType: "application/pdf", buffer: pdf("Semester 5 Meera") });
  await expect(page.getByText("Semester marksheet: semester 5")).toBeVisible();

  // The worker scans the files; the page updates on its own
  await expect(page.getByText("Checking file")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".cy-doc .stage.done")).toHaveCount(3);

  // Send
  await expect(page.locator(".cy-missing")).toHaveCount(0);
  await page.getByRole("button", { name: "Send for verification" }).click();
  await expect(page.locator(".banner-title", { hasText: "Your profile is being checked" })).toBeVisible();
  await expect(page.getByLabel("CGPA", { exact: true })).toBeDisabled();
  await expect(page.locator(".cy-timeline .stage.working")).toHaveText("Being checked");

  // Withdraw and send again
  await page.getByRole("button", { name: "Withdraw to make changes" }).click();
  await expect(page.getByText("Complete your profile").first()).toBeVisible();
  await expect(page.getByLabel("CGPA", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Send for verification" }).click();
  await expect(page.locator(".banner-title", { hasText: "Your profile is being checked" })).toBeVisible();

  // Home shows the same state
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByText("Waiting for verification")).toBeVisible();
});

test("a verified student sees locked marks and can send a change request", async ({ page }) => {
  const { signIn, demo } = await import("./helpers");
  await signIn(page, demo("verified.student"));
  await page.goto("/student/profile");
  await expect(page.locator(".banner-title", { hasText: "Your profile is verified" })).toBeVisible();
  await expect(page.getByLabel("CGPA", { exact: true }).first()).toBeDisabled();
  await page.getByRole("button", { name: "Request a change" }).click();
  const form = page.locator("form").filter({ hasText: "Why the change" });
  await form.getByLabel("CGPA", { exact: true }).fill("8.4");
  await form.getByLabel("Up to semester").selectOption("6");
  await form.getByLabel("Why the change (optional)").fill("Semester 6 results are out.");
  await form.getByRole("button", { name: "Send change request" }).click();
  await expect(page.getByText("Your change request is waiting for review.")).toBeVisible();
});
