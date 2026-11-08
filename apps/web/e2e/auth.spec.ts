import { expect, test } from "@playwright/test";
import { codeIn, demo, freshEmail, freshRoll, latestEmail, signIn } from "./helpers";

test.describe("sign-up, sign-in and passwords", () => {
  test("a student signs up, confirms the email code from the inbox and lands on home", async ({ page, request }) => {
    const email = freshEmail("signup");
    await page.goto("/sign-up");
    await page.getByLabel("Roll number").fill(freshRoll());
    await page.getByLabel("Full name").fill("Kiran Rao");
    await page.getByLabel("Branch").selectOption("CSE");
    await page.getByLabel("Graduation year").fill("2027");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("kiran-pass-123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/verify-email/);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const mail = await latestEmail(request, email, "code");
    await page.getByLabel("6-digit code").fill(codeIn(mail.text));
    await page.getByRole("button", { name: "Confirm email" }).click();
    await expect(page.getByText("You're in!")).toBeVisible();
    await page.getByRole("button", { name: "Go to my home" }).click();
    await expect(page.getByText("Profile incomplete")).toBeVisible();
  });

  test("the sign-up form shows field errors before sending, and refuses a taken email", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();

    await page.getByLabel("Roll number").fill(freshRoll());
    await page.getByLabel("Full name").fill("Copy Cat");
    await page.getByLabel("Branch").selectOption("CSE");
    await page.getByLabel("Graduation year").fill("2027");
    await page.getByLabel("Email").fill(demo("verified.student"));
    await page.getByLabel("Password", { exact: true }).fill("copy-pass-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/already has an account/i).first()).toBeVisible();
  });

  test("a wrong password is refused with a clear message", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(demo("staff"));
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is wrong.")).toBeVisible();
  });

  test("signed-in pages send you to sign-in, and back after signing in", async ({ page }) => {
    await page.goto("/office/review");
    await expect(page).toHaveURL(/sign-in/);
    await page.getByLabel("Email").fill(demo("staff"));
    await page.getByLabel("Password", { exact: true }).fill((await import("./helpers")).DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/office\/review/);
  });

  test("a forgotten password is reset with the emailed code", async ({ page, request }) => {
    const email = freshEmail("reset");
    // Make an account to reset
    await page.goto("/sign-up");
    await page.getByLabel("Roll number").fill(freshRoll());
    await page.getByLabel("Full name").fill("Reset Me");
    await page.getByLabel("Branch").selectOption("IT");
    await page.getByLabel("Graduation year").fill("2027");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("first-pass-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("6-digit code").fill(codeIn((await latestEmail(request, email, "code")).text));
    await page.getByRole("button", { name: "Confirm email" }).click();
    await expect(page.getByText("You're in!")).toBeVisible();
    await page.context().clearCookies();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    const asked = new Date();
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    const mail = await latestEmail(request, email, "code", asked, "reset your password");
    await page.getByLabel("6-digit code").fill(codeIn(mail.text));
    await page.getByLabel("New password").fill("second-pass-456");
    await page.getByLabel("Type it again").fill("second-pass-456");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByText("All set")).toBeVisible();

    await signIn(page, email, "second-pass-456");
    await expect(page.getByText("Profile incomplete")).toBeVisible();
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, demo("verified.student"));
    await page.locator(".user-menu-side summary").click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/sign-in/);
    await page.goto("/student");
    await expect(page).toHaveURL(/sign-in/);
  });
});
