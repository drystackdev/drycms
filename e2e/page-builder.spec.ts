import { expect, test } from "@playwright/test";
import { BUILDER_TIMEOUT, codePanel, dock, expectPreviewText, openBuilder, preview } from "./page-builder-utils.js";

/**
 * Page Builder's shell: the dock, the full-screen preview, the three panels
 * it can put beside it, and the two ways in and out of the page. File
 * operations, code editing and publishing have their own specs
 * (`page-builder-files`, `page-builder-editing`, `page-builder-publish`).
 *
 * This is the ONLY page-source editing surface now - the code Page Editor and
 * the public-site VEI overlay were both deleted - so the coverage the old
 * `page-editor.spec.ts` provided lives across these four files.
 */
test.describe.configure({ timeout: BUILDER_TIMEOUT });

test.describe("Page Builder shell", () => {
  test("renders the previewed route and every dock action", async ({ page }) => {
    await openBuilder(page, "/", { code: false });

    // The preview is a real build of `pages/page.tsx` through the layout, not
    // a server render: `pages/layout.tsx`'s header is only there if the
    // layout chain was resolved and compiled too.
    await expectPreviewText(page, "Your drycms project starts here");
    await expect(preview(page).locator("header")).toContainText("drycms");
    // `setTitle("Home")` inside the previewed page, relayed out of the
    // sandboxed frame by the bridge script's title message.
    await expect(page).toHaveTitle("Home - Page builder");

    for (const name of ["Open file menu", "Visual editing", "Code editor", "Dashboard", "Build and publish", "Close page builder"]) {
      await expect(dock(page).getByRole("button", { name })).toBeVisible();
    }
    // Nothing has been edited yet, so there is nothing to publish.
    await expect(dock(page).getByRole("button", { name: "Build and publish" })).toBeDisabled();
    await expect(dock(page).locator(".dock-save-badge")).toHaveCount(0);
    // Magic Chat moved here from the deleted Page Editor.
    await expect(page.locator(".magic-chat-bubble")).toBeVisible();
  });

  test("toggles between the code panel, the visual editor and neither", async ({ page }) => {
    await openBuilder(page, "/", { code: false });
    const codeToggle = dock(page).getByRole("button", { name: "Code editor" });
    const veiToggle = dock(page).getByRole("button", { name: "Visual editing" });

    // A fresh session lands on the dock alone - no panel covers the preview
    // until the admin asks for one.
    await expect(codeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(veiToggle).toHaveAttribute("aria-pressed", "false");
    await expect(codePanel(page)).toHaveCount(0);

    // Opening it starts on the previewed route's own page.tsx.
    await codeToggle.click();
    await expect(codeToggle).toHaveAttribute("aria-pressed", "true");
    await expect(codePanel(page)).toBeVisible();
    await expect(codePanel(page).locator(".page-builder-code-panel-path")).toHaveText("pages/page.tsx");

    // The two panels share one slot: switching to VEI closes the code panel.
    await veiToggle.click();
    await expect(veiToggle).toHaveAttribute("aria-pressed", "true");
    await expect(codeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(codePanel(page)).toHaveCount(0);
    const veiSheet = page.locator(".page-builder-vei-sheet");
    await expect(veiSheet).toBeVisible();
    await expect(veiSheet).toContainText("Select content in the preview");

    // Clicking the active toggle again closes the panel entirely.
    await veiToggle.click();
    await expect(veiSheet).toHaveCount(0);
    await expect(veiToggle).toHaveAttribute("aria-pressed", "false");
    await expect(codeToggle).toHaveAttribute("aria-pressed", "false");

    await codeToggle.click();
    await expect(codePanel(page)).toBeVisible();
    await codePanel(page).getByRole("button", { name: "Close" }).click();
    await expect(codePanel(page)).toHaveCount(0);
  });

  test("follows a link clicked inside the preview instead of navigating the frame", async ({ page }) => {
    await openBuilder(page, "/about");
    await expectPreviewText(page, "Built with drycms");
    await expect(codePanel(page).locator(".page-builder-code-panel-path")).toHaveText("pages/about/page.tsx");

    // The preview is a detached `srcdoc` render with no route of its own, so
    // its bridge script intercepts every click and reports the pathname back
    // out; the builder re-resolves and re-compiles for that route.
    await preview(page).locator("header a", { hasText: "drycms" }).click();
    await page.waitForURL(/path=%2F$/);
    await expectPreviewText(page, "Your drycms project starts here");
    await expect(codePanel(page).locator(".page-builder-code-panel-path")).toHaveText("pages/page.tsx");
  });

  test("restores which panel and file were open across a reload", async ({ page }) => {
    await openBuilder(page, "/");
    await dock(page).getByRole("button", { name: "Visual editing" }).click();
    await expect(page.locator(".page-builder-vei-sheet")).toBeVisible();

    await page.reload();
    await expect(dock(page)).toBeVisible({ timeout: 60_000 });
    // Restored from `sessionStorage` ("drycms:page-builder-state"), which is
    // why `openBuilder` clears it before navigating rather than on every load.
    await expect(page.locator(".page-builder-vei-sheet")).toBeVisible();
    await expect(dock(page).getByRole("button", { name: "Visual editing" })).toHaveAttribute("aria-pressed", "true");
  });

  test("leaves for the dashboard, and back to the previewed page", async ({ page }) => {
    await openBuilder(page, "/about");
    await dock(page).getByRole("button", { name: "Dashboard" }).click();
    await page.waitForURL(/\/dry\/dashboard/);

    // "x" is the return leg of the public site's Edit button: back to the
    // exact public page that was being previewed, not to the admin root.
    await openBuilder(page, "/about");
    await dock(page).getByRole("button", { name: "Close page builder" }).click();
    await page.waitForURL((url) => url.pathname === "/about");
    await expect(page.locator("h1")).toContainText("Built with drycms");
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
});
