import { expect, test } from "@playwright/test";
import { demo, freshEmail, latestEmail, signIn, signOut } from "./helpers";

test.describe("team page and who can open what", () => {
  test("the Team page loads once and stays steady (no reload loop)", async ({ page }) => {
    let calls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/admin/team")) calls++;
    });
    await signIn(page, demo("tpo"));
    await page.goto("/office/team");
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await page.waitForTimeout(3000);
    expect(calls).toBeLessThanOrEqual(2); // StrictMode in dev may load twice; never more
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.locator(".cy-table tbody tr")).toHaveCount(2); // staff + volunteer from the demo seed
  });

  test("the TPO invites a volunteer, who joins from the email link", async ({ page, request }) => {
    const email = freshEmail("vol");
    await signIn(page, demo("tpo"));
    await page.goto("/office/team");
    // Volunteers can't be given final checks
    await expect(page.getByLabel(/Second checks and marks change requests/)).toBeDisabled();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("ECE").check();
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(`Invite sent to ${email}`)).toBeVisible();
    await expect(page.locator(".cy-table").getByText(email)).toBeVisible();
    await signOut(page);

    const mail = await latestEmail(request, email, "invited");
    const link = mail.text.match(/http:\/\/localhost:5173\/invite\/\S+/)![0];
    await page.goto(link.replace("http://localhost:5173", ""));
    await expect(page.getByText("Student volunteer").or(page.getByText(/volunteer/i)).first()).toBeVisible();
    await page.getByLabel("Full name").fill("New Volunteer");
    await page.getByLabel("Choose a password").fill("vol-pass-1234");
    await page.getByLabel("Type it again").fill("vol-pass-1234");
    await page.getByRole("button", { name: "Accept invite" }).click();
    await expect(page).toHaveURL(/office/);
    await page.goto("/office/review");
    await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();
  });

  test("a student can't open office pages", async ({ page }) => {
    await signIn(page, demo("verified.student"));
    await page.goto("/office/review");
    await expect(page.getByRole("heading", { name: "Not available" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review queue" })).toHaveCount(0);
  });

  test("staff don't see the TPO-only pages", async ({ page }) => {
    await signIn(page, demo("staff"));
    await expect(page.getByRole("link", { name: "Review queue" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0);
    await page.goto("/office/team");
    await expect(page.getByRole("heading", { name: "Not available" })).toBeVisible();
  });

  test("the API refuses office data to a student even if they call it directly", async ({ page }) => {
    await signIn(page, demo("verified.student"));
    const status = await page.evaluate(async () => {
      const refresh = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" });
      const { accessToken } = await refresh.json();
      const r = await fetch("/api/v1/admin/team", { headers: { authorization: `Bearer ${accessToken}` } });
      return r.status;
    });
    expect(status).toBe(403);
  });
});
