import { expect, test } from "@playwright/test";

test("RichText demo does not expose the temporarily hidden reorder control", async ({ page }) => {
  await page.goto("/dry/richtext-demo");
  await expect(page.locator(".richtext-content-mount").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Reorder blocks" })).toHaveCount(0);
});
