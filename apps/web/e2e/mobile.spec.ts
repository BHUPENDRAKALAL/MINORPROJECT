import { expect, test } from "@playwright/test";
import { demo, signIn } from "./helpers";

test("on a phone: bottom tab bar, profile page fits the screen, no side panel edge", async ({ page }) => {
  await signIn(page, demo("verified.student"));
  await expect(page.locator(".tabbar")).toBeVisible();
  await expect(page.locator(".side-resize")).toBeHidden();
  await page.locator(".tabbar").getByRole("link", { name: /My profile/ }).click();
  await expect(page.getByText("Your profile is verified")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("on a phone: the review queue is usable", async ({ page }) => {
  await signIn(page, demo("tpo"));
  await page.goto("/office/review");
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("on a phone: a student's drive page fits the screen", async ({ page }) => {
  await signIn(page, demo("verified.student"));
  await page.goto("/student/drives");
  await page.getByRole("link", { name: /Software Engineer/ }).first().click();
  await expect(page.getByRole("heading", { name: "Rounds" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
