import { expect, test, type Page } from "@playwright/test";
import { demo, signIn, signOut } from "./helpers";

/** A value for <input type="datetime-local">, some days from now. */
function inDays(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00`;
}

/** The names in the round builder, in order. */
const roundNames = (page: Page) => () => page.locator(".cy-round-card").getByLabel("Round name").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test.describe("drives", () => {
  test("HR builds a drive, the TPO approves, HR invites, the student joins; others see only the name", async ({ page }) => {
    const role = `E2E Backend Engineer ${Date.now().toString(36)}`;

    // ── HR: step 1, job details
    await signIn(page, demo("hr"));
    await expect(page.getByRole("heading", { name: "Drives" })).toBeVisible();
    await page.getByRole("link", { name: "New drive" }).click();
    await page.getByLabel("Role", { exact: true }).fill(role);
    await page.getByLabel("CTC (lakh per year)").fill("14");
    await page.getByLabel("Location").fill("Jaipur");
    await page.getByLabel("Last date for students to join").fill(inDays(5));
    await page.getByLabel("Job description").fill("Build the APIs behind our store software. Node.js, SQL and a lot of testing.");
    await page.getByRole("button", { name: "Create draft and continue" }).click();

    // ── step 2, who can apply: only IT with CGPA 8+ (Aman 8.1 and Pooja 8.6 in the demo data)
    await expect(page.getByText(/verified students? match right now/)).toBeVisible();
    await page.getByLabel("IT", { exact: true }).check();
    await page.getByLabel("Minimum CGPA").fill("8");
    await expect(page.locator(".cy-match strong")).toHaveText("2");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // ── step 3, rounds: the same kind repeats with numbered names
    await page.getByRole("button", { name: "+ Online assessment" }).click();
    await page.getByRole("button", { name: "+ Technical round" }).click();
    await page.getByRole("button", { name: "+ Technical round" }).click();
    await page.getByRole("button", { name: "+ HR round" }).click();
    await expect.poll(roundNames(page)).toEqual(["Online assessment", "Technical round 1", "Technical round 2", "HR round"]);
    // Removing Technical round 1 renumbers the other one
    await page.getByRole("button", { name: "Remove Technical round 1" }).click();
    await expect.poll(roundNames(page)).toEqual(["Online assessment", "Technical round 1", "HR round"]);
    await page.getByRole("button", { name: "+ Technical round" }).click();
    await page.getByRole("button", { name: "Move Technical round 2 up" }).click();
    await expect.poll(roundNames(page)).toEqual(["Online assessment", "Technical round 1", "Technical round 2", "HR round"]);
    await page.getByRole("button", { name: "Save rounds and continue" }).click();

    // ── step 4, check and send
    await expect(page.getByText("CGPA 8 or more")).toBeVisible();
    await page.getByRole("button", { name: "Send to the placement office" }).click();
    await expect(page.getByText("Waiting for the placement office")).toBeVisible();
    await signOut(page);

    // ── A student can't see a drive that isn't approved yet
    await signIn(page, demo("verified.student"));
    await page.goto("/student/drives");
    await expect(page.getByRole("heading", { name: "Other drives on campus" })).toBeVisible();
    await expect(page.getByText(role)).toHaveCount(0);
    await signOut(page);

    // ── TPO approves
    await signIn(page, demo("tpo"));
    await page.goto("/office/drives");
    await page.getByRole("link", { name: new RegExp(role) }).click();
    await expect(page.getByText("Waiting for your approval")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved. HR can now invite students.")).toBeVisible();
    await signOut(page);

    // ── HR invites everyone eligible
    await signIn(page, demo("hr"));
    await page.getByRole("link", { name: new RegExp(role) }).click();
    await page.getByRole("link", { name: "Invite students" }).click();
    await page.getByRole("button", { name: "Invite all 2 eligible" }).click();
    await expect(page.getByText("Invited 2 students.")).toBeVisible();
    await expect(page.locator(".cy-table").first().getByText("Aman Gupta")).toBeVisible();
    await signOut(page);

    // ── The invited student sees everything and joins
    await signIn(page, demo("verified.student"));
    await page.goto("/student/drives");
    await page.getByRole("link", { name: new RegExp(role) }).click();
    await expect(page.getByText("You're invited to this drive")).toBeVisible();
    await expect(page.getByText("Technical round 2")).toBeVisible();
    await expect(page.getByText("₹14 LPA")).toBeVisible();
    const join = page.getByRole("button", { name: "Join the drive" });
    await expect(join).toBeDisabled();
    await page.getByLabel(/I agree to share my profile/).check();
    await join.click();
    await expect(page.getByText("You've joined this drive")).toBeVisible();
    await signOut(page);

    // ── A student who wasn't invited sees the name only
    await signIn(page, demo("karan.quiet"));
    await page.goto("/student/drives");
    const row = page.locator(".cy-other", { hasText: role });
    await expect(row.getByText("Invite only")).toBeVisible();
    await row.click();
    await expect(page.getByText(/Only students invited to this drive can see its details/)).toBeVisible();
    await expect(page.getByText("Technical round 2")).toHaveCount(0);
  });

  test("the TPO sends a drive back with a note; HR sees it and can edit again", async ({ page }) => {
    const role = `E2E Analyst ${Date.now().toString(36)}`;
    await signIn(page, demo("hr"));
    await page.getByRole("link", { name: "New drive" }).click();
    await page.getByLabel("Role", { exact: true }).fill(role);
    await page.getByLabel("CTC (lakh per year)").fill("6");
    await page.getByLabel("Last date for students to join").fill(inDays(6));
    await page.getByLabel("Job description").fill("Reports and dashboards for store managers, in SQL and Excel.");
    await page.getByRole("button", { name: "Create draft and continue" }).click();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.getByRole("button", { name: "OA → Technical → HR" }).click();
    await page.getByRole("button", { name: "Save rounds and continue" }).click();
    await page.getByRole("button", { name: "Send to the placement office" }).click();
    await expect(page.getByText("Waiting for the placement office")).toBeVisible();
    await signOut(page);

    await signIn(page, demo("tpo"));
    await page.goto("/office/drives");
    await page.getByRole("link", { name: new RegExp(role) }).click();
    await page.getByRole("button", { name: "Send back…" }).click();
    await page.getByLabel("What should HR change?").fill("Please add the bond details.");
    await page.getByRole("button", { name: "Send back", exact: true }).click();
    await expect(page.getByText("Sent back to HR with your note.")).toBeVisible();
    await signOut(page);

    await signIn(page, demo("hr"));
    await page.getByRole("link", { name: new RegExp(role) }).click();
    await expect(page.getByText("Sent back by the placement office")).toBeVisible();
    await expect(page.getByText("Please add the bond details.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
  });
});
