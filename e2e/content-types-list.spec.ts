import { expect, test } from "@playwright/test";

test.describe("Content Types list page", () => {
  test("shows a 1/4 icon-menu + 3/4 table, with Collection open by default", async ({ page }) => {
    await page.goto("/dry/content-types/");

    const nav = page.locator(".content-types-nav");
    const navItems = nav.locator("button");
    await expect(navItems).toHaveCount(3);
    await expect(navItems.nth(0)).toHaveText(/Collection/);
    await expect(navItems.nth(1)).toHaveText(/Single/);
    await expect(navItems.nth(2)).toHaveText(/Component/);

    // Collection selected by default.
    await expect(navItems.nth(0)).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".content-types-panel h3")).toHaveText("Collection");

    // Right panel renders a real table with a Description column.
    const table = page.locator(".content-types-panel table");
    await expect(table).toBeVisible();
    await expect(table.locator("th")).toContainText(["Name", "Description", "Fields"]);

    // Roughly a 1:3 width split at desktop viewport.
    const navBox = await nav.boundingBox();
    const panelBox = await page.locator(".content-types-panel").boundingBox();
    expect(navBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width).toBeGreaterThan(navBox!.width * 2);
  });

  test("switching the left menu changes which kind's table is shown", async ({ page }) => {
    await page.goto("/dry/content-types/");
    await page.locator(".content-types-nav button", { hasText: "Component" }).click();
    await expect(page.locator(".content-types-panel h3")).toHaveText("Component");
    await expect(page.locator(".content-types-nav button", { hasText: "Component" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
