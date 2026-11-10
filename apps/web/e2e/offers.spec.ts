import { expect, test, type Page } from "@playwright/test";
import { demo, signIn, signOut } from "./helpers";

/** SHOTS=1 saves screenshots to .review/ (git-ignored) for a design check. */
const shot = async (p: Page, name: string) => {
  if (!process.env.SHOTS) return;
  await p.waitForTimeout(900);
  await p.screenshot({ path: `.review/offer-${name}.png`, fullPage: true });
};

/** A tiny valid PDF standing in for an offer letter. */
const letter = () =>
  Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

// Uses the demo drive "Northwind Systems · Billing Analyst": final results out, Aman and Isha selected.
test("HR sends an offer letter, the student accepts and is placed, the TPO closes the drive", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());

  // ── HR: Offers tab → upload Aman's letter
  await signIn(page, demo("hr"));
  await page.getByRole("link", { name: /Billing Analyst/ }).click();
  await expect(page.getByText("Final results are out")).toBeVisible();
  await page.getByRole("link", { name: "Offers", exact: true }).first().click();
  await expect(page.getByRole("row", { name: /Aman Gupta/ }).getByText("Not sent")).toBeVisible();
  await page.getByLabel("Offer letter for Aman Gupta").setInputFiles({ name: "aman-offer.pdf", mimeType: "application/pdf", buffer: letter() });
  await expect(page.getByText(/Offer letter sent to Aman Gupta/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Aman Gupta/ }).getByText("Waiting for the student")).toBeVisible();
  await shot(page, "1-hr-offers");
  await signOut(page);

  // ── Student: sees the offer and accepts
  await signIn(page, demo("verified.student"));
  await page.goto("/student/drives");
  await page.getByRole("link", { name: /Billing Analyst/ }).click();
  await expect(page.getByText("You have an offer")).toBeVisible();
  const offer = page.getByRole("region", { name: "Your offer" });
  await expect(offer.getByText("₹7.5 LPA")).toBeVisible();
  await shot(page, "2-student-offer");
  await offer.getByRole("button", { name: "Accept offer" }).click();
  await expect(page.getByText("You're placed!")).toBeVisible();
  await expect(offer.getByText("Accepted")).toBeVisible();
  await page.getByRole("link", { name: "Home" }).click();
  await signOut(page);

  // ── HR sees the answer; the TPO closes the drive
  await signIn(page, demo("hr"));
  await page.getByRole("link", { name: /Billing Analyst/ }).click();
  await page.getByRole("link", { name: "Offers", exact: true }).first().click();
  await expect(page.getByRole("row", { name: /Aman Gupta/ }).getByText("Accepted")).toBeVisible();
  await signOut(page);

  await signIn(page, demo("tpo"));
  await page.goto("/office/drives");
  await page.getByRole("link", { name: /Billing Analyst/ }).click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Close drive" }).click();
  await expect(page.getByText("Drive closed.")).toBeVisible();
  await expect(page.locator(".banner-title", { hasText: "Closed" })).toBeVisible();
});
