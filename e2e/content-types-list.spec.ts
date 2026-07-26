import { expect, test } from "@playwright/test";

test.describe("Content Types list page", () => {
  test("shows a small sticky icon-menu (with count badges) + table, Collection open by default", async ({
    page,
  }) => {
    await page.goto("/dry/content-types/");

    const nav = page.locator(".content-types-nav");
    const navItems = nav.locator("button");
    await expect(navItems).toHaveCount(3);
    await expect(navItems.nth(0)).toContainText("Collection");
    await expect(navItems.nth(1)).toContainText("Single");
    await expect(navItems.nth(2)).toContainText("Component");

    // Each nav item shows a count badge.
    await expect(navItems.nth(0).locator(".badge")).toBeVisible();

    // Collection selected by default - the page header names the kind.
    await expect(navItems.nth(0)).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".page-header h1")).toHaveText("Content Types - Collection");

    // Right panel renders a real table; description is folded into the Name
    // cell (muted subtitle), not its own column, and there's no Delete column.
    const table = page.locator(".content-types-panel table");
    await expect(table).toBeVisible();
    const headers = await table.locator("th").allTextContents();
    expect(headers).toEqual(["Name", "Fields"]);

    // The "+ Add <Kind>" button lives alongside the table's search bar.
    await expect(page.locator(".content-types-panel").getByRole("button", { name: "+ Add Collection" })).toBeVisible();
  });

  test("switching the left menu changes which kind's table is shown, and the Add button's label", async ({
    page,
  }) => {
    await page.goto("/dry/content-types/");
    await page.locator(".content-types-nav button", { hasText: "Component" }).click();
    await expect(page.locator(".page-header h1")).toHaveText("Content Types - Component");
    await expect(page.locator(".content-types-nav button", { hasText: "Component" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".content-types-panel").getByRole("button", { name: "+ Add Component" })).toBeVisible();
  });

  test("nav stays sticky while the table scrolls", async ({ page }) => {
    await page.goto("/dry/content-types/");
    const navBox = await page.locator(".content-types-nav").boundingBox();
    expect(navBox).not.toBeNull();
    await page.mouse.wheel(0, 400);
    const navBoxAfterScroll = await page.locator(".content-types-nav").boundingBox();
    expect(navBoxAfterScroll).not.toBeNull();
    expect(navBoxAfterScroll!.y).toBe(navBox!.y);
  });
});
