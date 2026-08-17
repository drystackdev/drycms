import { expect, test } from "@playwright/test";
import {
  BUILDER_TIMEOUT,
  closeFileDialog,
  codePanel,
  dock,
  expectPreviewText,
  expectStoredSource,
  fileDialog,
  fillEditor,
  openBuilder,
  openFileMenu,
  preview,
  readSource,
  saveBadgeCount,
  selectRootTab,
  writeSource,
} from "./page-builder-utils.js";

/**
 * Editing itself: the code panel and the file dialog, autosave, the problems
 * panel, the component preview, and Magic Chat's entry point.
 *
 * Autosave is the thing to keep in mind reading these: there is no Save
 * button anywhere in Page Builder, so every "did it save" assertion is a poll
 * against `pagesSourceStorage` rather than a click.
 */
test.describe.configure({ timeout: BUILDER_TIMEOUT });

const HOME_PAGE = "pages/page.tsx";

test.describe("Page Builder editing", () => {
  test("autosaves an edit, shows it in the preview, and keeps it publishable", async ({ page }) => {
    let original: string | null = null;
    try {
      await openBuilder(page, "/");
      await expectPreviewText(page, "Your drycms project starts here");
      original = await readSource(page, HOME_PAGE);

      const panel = codePanel(page);
      await expect(panel.locator(".page-builder-code-panel-path")).toHaveText(HOME_PAGE);
      await expect(panel.locator(".page-builder-code-panel-status")).toHaveText("Saved");

      await fillEditor(
        panel,
        'export default function HomePage() {\n  setTitle("Home");\n  return <main>E2E autosave marker</main>;\n}\n',
      );

      // Nothing was clicked: the edit writes itself into storage.
      await expectStoredSource(page, HOME_PAGE, "E2E autosave marker");
      await expectPreviewText(page, "E2E autosave marker");

      // ...and stays queued for Build & publish. Written is not published:
      // the live site still serves the previously built HTML until the dock's
      // button runs, so the badge has to survive the write.
      await expect(panel.locator(".page-builder-code-panel-status")).toHaveText("Not published");
      expect(await saveBadgeCount(page)).toBe(1);
      await expect(dock(page).getByRole("button", { name: "Build and publish" })).toBeEnabled();
    } finally {
      if (original !== null) await writeSource(page, HOME_PAGE, original);
    }
  });

  test("reports problems from the open file in the code panel", async ({ page }) => {
    let original: string | null = null;
    try {
      await openBuilder(page, "/");
      await expectPreviewText(page, "Your drycms project starts here");
      original = await readSource(page, HOME_PAGE);

      const panel = codePanel(page);
      const problems = panel.locator(".page-editor-diagnostics");
      await expect(problems).toContainText("No problems");

      // Unterminated JSX - a syntax error, which the panel counts separately
      // from the semantic warnings the TS worker also reports.
      await fillEditor(panel, "export default function HomePage() {\n  return <main>never closed;\n}\n");
      await expect(problems.locator(".badge.destructive")).toContainText(/error/, { timeout: 30_000 });
      await expect(problems.locator(".page-editor-diagnostics-list li").first()).toBeVisible();
      // The editor underlines the same diagnostics in the gutter.
      await expect(panel.locator(".editer-diagnostic").first()).toBeVisible();

      await problems.getByRole("button", { name: "Collapse problems panel" }).click();
      await expect(problems.locator(".page-editor-diagnostics-list")).toHaveCount(0);
      await problems.getByRole("button", { name: "Expand problems panel" }).click();
      await expect(problems.locator(".page-editor-diagnostics-list")).toBeVisible();
    } finally {
      if (original !== null) await writeSource(page, HOME_PAGE, original);
    }
  });

  test("the code panel lists the route's layouts and opens one", async ({ page }) => {
    await openBuilder(page, "/about");
    const panel = codePanel(page);
    await expect(panel.locator(".page-builder-code-panel-path")).toHaveText("pages/about/page.tsx");

    // `/about` inherits the single root layout; the crumb is how you get from
    // a page to the layout wrapping it without going through the file menu.
    const crumb = panel.locator(".page-builder-code-panel-layout-crumb").getByRole("button", { name: "pages/layout.tsx" });
    await expect(crumb).toBeVisible();
    await crumb.click();
    await expect(fileDialog(page)).toHaveAttribute("aria-label", "pages/layout.tsx");
    await closeFileDialog(page);
  });

  test("a component opens in a dialog with a live preview, viewport and zoom controls", async ({ page }) => {
    await openBuilder(page, "/");
    const menu = await openFileMenu(page);
    await selectRootTab(menu, "component");
    await menu.getByRole("button", { name: "Button.tsx", exact: true }).click();

    const dialog = fileDialog(page);
    await expect(dialog).toHaveAttribute("aria-label", "component/Button.tsx");
    // A component gets the split layout: its own synthetic-page preview beside
    // the editor, rendered from `export const defaultProps`.
    await expect(dialog.locator(".page-builder-file-dialog-body.split")).toBeVisible();
    const componentPreview = dialog.frameLocator('iframe[title="Component preview"]');
    await expect(componentPreview.locator("body")).toContainText("Button", { timeout: 120_000 });

    const zoomLabel = dialog.locator(".page-builder-file-dialog-preview-toolbar .hint");
    const startingZoom = await zoomLabel.textContent();
    await dialog.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoomLabel).not.toHaveText(startingZoom ?? "");
    await dialog.getByRole("button", { name: "Fit" }).click();
    await expect(dialog.getByRole("button", { name: "Fit" })).toBeDisabled();

    // Viewport presets drive the previewed width, not the dialog's own size.
    await dialog.getByRole("button", { name: "LG", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "LG", exact: true })).toHaveAttribute("aria-pressed", "true");

    await closeFileDialog(page);
  });

  test("a style file opens in a plain dialog with no preview column", async ({ page }) => {
    await openBuilder(page, "/");
    const menu = await openFileMenu(page);
    await selectRootTab(menu, "styles");
    await menu.getByRole("button", { name: "theme.css", exact: true }).click();

    const dialog = fileDialog(page);
    await expect(dialog).toHaveAttribute("aria-label", "styles/theme.css");
    // No meaningful single-file preview for a stylesheet, so one column only.
    await expect(dialog.locator(".page-builder-file-dialog-body.split")).toHaveCount(0);
    await expect(dialog.locator("textarea")).toHaveCount(1);
    await closeFileDialog(page);
  });

  test("Magic Chat opens against the file currently in view", async ({ page }) => {
    await openBuilder(page, "/about");
    await expect(codePanel(page).locator(".page-builder-code-panel-path")).toHaveText("pages/about/page.tsx");

    await page.locator(".magic-chat-bubble").click();
    const panel = page.locator(".magic-chat-panel");
    await expect(panel).toBeVisible();
    // The previewed route's own page.tsx is the chat's context file - it is
    // never a limit on what Magic may write, just what it is looking at.
    await expect(panel).toContainText("pages/about/page.tsx");
    // Session language picker (no AI key needed to reach it).
    await panel.getByRole("button", { name: "English" }).click();
    await expect(panel.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.locator(".magic-chat-input")).toBeVisible();

    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".magic-chat-bubble")).toBeVisible();
  });

  test("Ctrl+S inside the preview flushes the pending write instead of navigating", async ({ page }) => {
    let original: string | null = null;
    try {
      await openBuilder(page, "/");
      await expectPreviewText(page, "Your drycms project starts here");
      original = await readSource(page, HOME_PAGE);

      await fillEditor(
        codePanel(page),
        'export default function HomePage() {\n  setTitle("Home");\n  return <main>E2E ctrl-s marker</main>;\n}\n',
      );
      // The shortcut is pressed inside the sandboxed preview frame, whose key
      // events never reach the admin document - the injected bridge script
      // relays them out by `postMessage`. Nothing else in Page Builder listens
      // for it, so a write landing at all proves the relay works.
      await preview(page).locator("body").click();
      await page.keyboard.press("ControlOrMeta+s");
      await expectStoredSource(page, HOME_PAGE, "E2E ctrl-s marker");
    } finally {
      if (original !== null) await writeSource(page, HOME_PAGE, original);
    }
  });
});
