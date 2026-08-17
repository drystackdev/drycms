import { expect, test, type Page } from "@playwright/test";

/**
 * Page Builder is the ONLY page-source editing surface now (the code Page
 * Editor and the public-site VEI overlay were both deleted), so the coverage
 * the old `page-editor.spec.ts` provided moved here: the file menu's
 * create/rename/delete, the dock's navigation buttons, and the public site's
 * one remaining editing affordance - the Edit button that deep-links in.
 */
const TEMP_DIR = "e2e-tmp";

// Opening the builder compiles the previewed page in-browser (Sucrase +
// Tailwind), which routinely takes longer than the 30s default on a cold
// run - the file operations after it are fast.
test.describe.configure({ timeout: 120_000 });

async function openBuilder(page: Page): Promise<void> {
  await page.goto("/dry/page-builder?path=%2F");
  await expect(page.locator(".dock")).toBeVisible({ timeout: 60_000 });
}

async function openFileMenu(page: Page) {
  await page.locator(".dock").getByRole("button", { name: "Open file menu" }).click();
  const menu = page.getByRole("dialog", { name: "Page source files" });
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("Page Builder", () => {
  test("the dock offers Dashboard and Close, and Magic Chat is mounted", async ({ page }) => {
    await openBuilder(page);
    const dock = page.locator(".dock");

    await expect(dock.getByRole("button", { name: "Dashboard" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Close page builder" })).toBeVisible();
    // Magic Chat moved here from the deleted Page Editor.
    await expect(page.locator(".magic-chat-bubble")).toBeVisible();

    await dock.getByRole("button", { name: "Dashboard" }).click();
    await page.waitForURL(/\/dry\/dashboard/);
  });

  test("creates, renames and deletes a page-source file from the file menu", async ({ page }) => {
    await openBuilder(page);

    const menu = await openFileMenu(page);
    await menu.getByRole("button", { name: "New file" }).click();
    await menu.getByLabel("New file path").fill(`component/${TEMP_DIR}/Widget.tsx`);
    await menu.getByRole("button", { name: "Create", exact: true }).click();
    // Creating a component file opens it in the file dialog.
    await expect(page.getByRole("dialog").filter({ hasText: "Widget.tsx" }).first()).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Escape");

    // Rename it - folders render expanded, so the new file is already listed
    // under the component tab (2nd tab in `PAGES_SOURCE_ROOTS` order).
    const menu2 = await openFileMenu(page);
    await menu2.locator(".page-builder-bubble-tabs [role=tab]").nth(1).click();
    const renameTarget = menu2.getByRole("button", { name: "Rename Widget.tsx" });
    await expect(renameTarget).toBeVisible({ timeout: 30_000 });
    await renameTarget.click();
    await menu2.getByLabel("New path").fill(`component/${TEMP_DIR}/Renamed.tsx`);
    await menu2.getByRole("button", { name: "Rename", exact: true }).click();
    const renamedRow = menu2.getByRole("button", { name: "Renamed.tsx", exact: true });
    await expect(renamedRow).toBeVisible({ timeout: 60_000 });

    // Delete it again, leaving the fixture tree as it was found.
    await menu2.getByRole("button", { name: "Delete Renamed.tsx" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(renamedRow).toBeHidden({ timeout: 60_000 });
  });

  test("the public site offers one Edit button that deep-links into the builder", async ({ page }) => {
    await page.goto("/");

    // The public page carries the launcher's config + script, and no trace of
    // the deleted VEI overlay.
    await expect(page.locator("#dry-edit-config")).toHaveCount(1);
    await expect(page.locator("#dry-vei-config")).toHaveCount(0);
    expect(await page.evaluate(() => document.cookie.includes("drycms_vei"))).toBe(false);

    // Rendered client-side off the `drycms_admin` hint cookie (built HTML is
    // shared by every visitor, so it can never be baked in).
    const launcher = page.locator("#dry-edit-launcher");
    await expect(launcher).toHaveCount(1);
    await launcher.locator("button").click();
    await page.waitForURL(/\/dry\/page-builder\?path=/);
    expect(new URL(page.url()).searchParams.get("path")).toBe("/");
  });

  test("built-in style files cannot be deleted from the tree", async ({ page }) => {
    await openBuilder(page);
    const menu = await openFileMenu(page);
    // 3rd tab is `styles/` (`PAGES_SOURCE_ROOTS` order).
    await menu.locator(".page-builder-bubble-tabs [role=tab]").nth(2).click();
    await expect(menu.getByText("globals.css")).toBeVisible({ timeout: 30_000 });
    await expect(menu.getByRole("button", { name: "Delete globals.css" })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Rename globals.css" })).toBeVisible();
  });
});
