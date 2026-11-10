import { expect, test } from "@playwright/test";
import { demo, signIn } from "./helpers";

test("the side panel resizes, folds with Ctrl+B and remembers it after a reload", async ({ page }) => {
  await signIn(page, demo("tpo"));
  const shell = page.locator(".shell");
  const width = async () => (await shell.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(" ")[0];
  await expect.poll(width).toBe("240px");

  const edge = page.locator(".side-resize");
  const box = (await edge.boundingBox())!;
  const centre = box.x + box.width / 2;
  await page.mouse.move(centre, 400);
  await page.mouse.down();
  await page.mouse.move(centre + 100, 400, { steps: 8 });
  await page.mouse.up();
  await expect.poll(width).toBe("340px");

  await page.keyboard.press("Control+b");
  await expect.poll(width).not.toBe("340px");
  await expect(page.locator("#side-toggle")).toBeChecked();
  await page.keyboard.press("Control+b");
  await expect.poll(width).toBe("340px");

  await page.reload();
  await expect.poll(width).toBe("340px");
  await edge.dblclick();
  await expect.poll(width).toBe("240px");
});

test("a person with two roles can switch between them", async ({ page }) => {
  await signIn(page, demo("volunteer"));
  await page.locator("details.switcher summary").click();
  await page.getByRole("button", { name: "Student" }).click();
  await expect(page).toHaveURL(/\/student/);
  await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "My profile" })).toBeVisible();
  await page.locator("details.switcher summary").click();
  await page.getByRole("button", { name: /Volunteer/ }).click();
  await expect(page).toHaveURL(/\/office/);
});
