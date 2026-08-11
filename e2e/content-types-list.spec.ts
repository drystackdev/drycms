import { expect, test } from "@playwright/test";

test.describe("Content Types list page", () => {
  test("shows a Collection/Singleton toggle (with count badges) + card list, Collection open by default", async ({
    page,
  }) => {
    await page.goto("/dry/content-types/");

    // Components are now managed from the same builder list as collections
    // and singletons.
    const nav = page.locator(".file-view-toggle");
    const navItems = nav.locator("button");
    await expect(navItems).toHaveCount(3);
    await expect(navItems.nth(0)).toContainText("Collection");
    await expect(navItems.nth(1)).toContainText("Singleton");
    await expect(navItems.nth(2)).toContainText("Component");

    // Each kind button shows a count badge.
    await expect(navItems.nth(0).locator(".badge")).toBeVisible();

    // Collection selected by default.
    await expect(navItems.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#builder-collections-panel h2")).toHaveText("Collections");

    // Cards render for existing collections (User/Menu ship by default).
    const list = page.locator(".builder-collection-list");
    await expect(list).toBeVisible();
    await expect(list.locator(".builder-collection-card")).not.toHaveCount(0);

    // "Add" (icon + text, no per-kind suffix) lives alongside the search bar.
    await expect(page.locator(".builder-collections-toolbar").getByRole("button", { name: "Add" })).toBeVisible();
  });

  test("switching the toggle changes which kind's cards are shown", async ({
    page,
  }) => {
    await page.goto("/dry/content-types/");
    await page.locator(".file-view-toggle button", { hasText: "Singleton" }).click();
    await expect(page.locator("#builder-collections-panel h2")).toHaveText("Singletons");
    await expect(page.locator(".file-view-toggle button", { hasText: "Singleton" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the kind toggle stays in the viewport while the card list scrolls", async ({ page }) => {
    await page.goto("/dry/content-types/");
    const toggle = page.locator(".file-view-toggle");
    await expect(toggle).toBeInViewport();
    // `.builder-collections-body` is its own scroll container (flex layout,
    // not `position: sticky`) - the toggle sits outside it in `.builder-panel`,
    // so scrolling the card list never pushes it out of view. Not asserting
    // an exact unchanged pixel position: this suite runs several specs in
    // parallel against one shared dev database, and another spec creating/
    // deleting a collection mid-run can reflow the header's own content
    // (e.g. the count badge) by a few px independent of any real scrolling.
    await page.locator(".builder-collections-body").hover();
    await page.mouse.wheel(0, 400);
    await expect(toggle).toBeInViewport();
  });
});
