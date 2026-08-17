import { expect, test } from "@playwright/test";
import {
  BUILDER_TIMEOUT,
  closeFileDialog,
  codePanel,
  deleteSource,
  dock,
  expectPreviewText,
  expectStoredSource,
  fileDialog,
  fillEditor,
  openBuilder,
  openFileMenu,
  readBuiltPage,
  readSource,
  saveBadgeCount,
  writeSource,
} from "./page-builder-utils.js";

/**
 * The dock's Build & publish flow: what the dialog lists, what it lets you do
 * with each pending change, and what actually reaches the live site.
 *
 * "Published" is checked through `/api/pages-build?path=` (the `built/live/*`
 * output), never by visiting the route - the dev server renders public pages
 * live from source, so a plain page visit cannot tell a build apart from an
 * unpublished edit.
 */
test.describe.configure({ timeout: BUILDER_TIMEOUT });

const NEW_ROUTE = "/e2e-publish";
const NEW_PAGE = "pages/e2e-publish/page.tsx";
const HOME_PAGE = "pages/page.tsx";

function saveDialog(page: import("@playwright/test").Page) {
  return page.getByRole("dialog", { name: "Preview changes before saving" });
}

test.describe("Page Builder build & publish", () => {
  test("lists pending code changes, and can preview or revert each one", async ({ page }) => {
    let original: string | null = null;
    try {
      await openBuilder(page, "/");
      await expectPreviewText(page, "Your drycms project starts here");
      original = await readSource(page, HOME_PAGE);

      await fillEditor(
        codePanel(page),
        'export default function HomePage() {\n  setTitle("Home");\n  return <main>E2E dialog marker</main>;\n}\n',
      );
      await expectStoredSource(page, HOME_PAGE, "E2E dialog marker");

      await dock(page).getByRole("button", { name: "Build and publish" }).click();
      const dialog = saveDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(".dialog-title")).toHaveText("Build & publish");

      // Code changes on one side, content-entry drafts on the other - this
      // run edited no content, so that half stays empty.
      const codeGroup = dialog.locator(".page-builder-save-group").first();
      await expect(codeGroup.locator(".badge")).toHaveText("1");
      await expect(codeGroup.getByText(HOME_PAGE)).toBeVisible();
      await expect(dialog.getByText("No content changes.")).toBeVisible();

      // Preview closes the dialog and points the builder at that file.
      await codeGroup.getByRole("button", { name: "Preview" }).click();
      await expect(dialog).toBeHidden();
      await expect(codePanel(page).locator(".page-builder-code-panel-path")).toHaveText(HOME_PAGE);

      await dock(page).getByRole("button", { name: "Build and publish" }).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      // Cancelling changes nothing - the edit is still queued.
      expect(await saveBadgeCount(page)).toBe(1);
    } finally {
      if (original !== null) await writeSource(page, HOME_PAGE, original);
    }
  });

  test("builds and publishes a brand-new route to the live site", async ({ page }) => {
    try {
      await openBuilder(page, "/");
      expect(await readBuiltPage(page, NEW_ROUTE)).toBeNull();

      // Creating a `pages/**/page.tsx` re-points the whole preview at the new
      // route, so the code panel opens on it directly.
      const menu = await openFileMenu(page);
      await menu.getByRole("button", { name: "New file" }).click();
      await menu.getByLabel("New file path").fill(NEW_PAGE);
      await menu.getByRole("button", { name: "Create", exact: true }).click();
      await expect(codePanel(page).locator(".page-builder-code-panel-path")).toHaveText(NEW_PAGE);
      await page.waitForURL(new RegExp(`path=${encodeURIComponent(NEW_ROUTE)}$`));

      await fillEditor(
        codePanel(page),
        'export default function Page() {\n  setTitle("E2E published");\n  return <main>E2E published route</main>;\n}\n',
      );
      await expectStoredSource(page, NEW_PAGE, "E2E published route");
      await expectPreviewText(page, "E2E published route");
      expect(await saveBadgeCount(page)).toBeGreaterThan(0);

      await dock(page).getByRole("button", { name: "Build and publish" }).click();
      const dialog = saveDialog(page);
      await expect(dialog.getByText(NEW_PAGE)).toBeVisible();
      await dialog.getByRole("button", { name: "Build & publish" }).click();

      // Compiling and publishing every affected page runs entirely in this
      // browser (the server cannot build - `page-build.ts` needs `new
      // Function`, and Tailwind compiles in a real iframe), so it takes real
      // time and reports staged progress while it does.
      await expect(dialog.locator(".page-builder-save-progress")).toBeVisible();
      await expect(dialog).toBeHidden({ timeout: 150_000 });
      await expect(page.locator(".toast .error, .toast-error")).toHaveCount(0);

      // The published artifact now exists, which is what a real visitor gets.
      const built = await readBuiltPage(page, NEW_ROUTE);
      expect(built).toContain("E2E published route");

      // Nothing is queued any more.
      await expect(dock(page).getByRole("button", { name: "Build and publish" })).toBeDisabled();
      expect(await saveBadgeCount(page)).toBe(0);

      // And the route really serves it.
      await page.goto(NEW_ROUTE);
      await expect(page.locator("main")).toContainText("E2E published route");
    } finally {
      await deleteSource(page, "pages/e2e-publish");
    }
  });

  test("a file created from the menu is queued for publishing even though it never had a buffer", async ({ page }) => {
    const note = "md/e2e-publish-note.md";
    try {
      await openBuilder(page, "/");
      expect(await saveBadgeCount(page)).toBe(0);

      // Create/rename/delete write straight through to storage - there is no
      // editor buffer for them to be dirty in - so without the unpublished
      // ledger the dock would show nothing to publish right after this.
      const menu = await openFileMenu(page);
      await menu.getByRole("button", { name: "New file" }).click();
      await menu.getByLabel("New file path").fill(note);
      await menu.getByRole("button", { name: "Create", exact: true }).click();
      await expect(fileDialog(page)).toHaveAttribute("aria-label", note);
      await closeFileDialog(page);

      expect(await saveBadgeCount(page)).toBe(1);
      await dock(page).getByRole("button", { name: "Build and publish" }).click();
      await expect(saveDialog(page).getByText(note)).toBeVisible();
      await saveDialog(page).getByRole("button", { name: "Cancel" }).click();
    } finally {
      await deleteSource(page, note);
    }
  });
});
