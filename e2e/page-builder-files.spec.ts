import { expect, test } from "@playwright/test";
import {
  BUILDER_TIMEOUT,
  closeFileDialog,
  codePanel,
  deleteSource,
  expectPreviewText,
  expectStoredSource,
  fileDialog,
  fillEditor,
  listSourcePaths,
  openBuilder,
  openFileMenu,
  readSource,
  selectRootTab,
} from "./page-builder-utils.js";

/**
 * The bubble file menu - the only place page source can be created, renamed
 * or deleted from the UI now that the code Page Editor is gone. Covers all
 * four source roots, the tree itself, the create/rename form's validation,
 * and the delete-lock on the built-in style files.
 */
test.describe.configure({ timeout: BUILDER_TIMEOUT });

const TEMP_DIR = "e2e-tmp";

test.describe("Page Builder file menu", () => {
  test("lists all four source roots and expands their folders", async ({ page }) => {
    await openBuilder(page, "/");
    const menu = await openFileMenu(page);

    // pages/ - route files at the root plus the `about/` folder, expanded by
    // default (the tree collapses on demand, never on load). `page.tsx`
    // appears twice, once per route, hence `.first()`.
    for (const name of ["page.tsx", "layout.tsx", "404.tsx", "500.tsx", "about"]) {
      await expect(menu.getByText(name, { exact: true }).first()).toBeVisible();
    }
    const aboutChevron = menu.getByRole("button", { name: "Collapse about" });
    await aboutChevron.click();
    await expect(menu.getByRole("button", { name: "Rename page.tsx" })).toHaveCount(1);
    await menu.getByRole("button", { name: "Expand about" }).click();
    await expect(menu.getByRole("button", { name: "Rename page.tsx" })).toHaveCount(2);

    await selectRootTab(menu, "component");
    for (const name of ["Button.tsx", "ThemeToggle.tsx", "lib", "cva.ts", "utils.ts"]) {
      await expect(menu.getByText(name, { exact: true })).toBeVisible();
    }

    await selectRootTab(menu, "styles");
    for (const name of ["globals.css", "theme.css", "base.css"]) {
      await expect(menu.getByText(name, { exact: true })).toBeVisible();
    }

    await selectRootTab(menu, "md");
    for (const name of ["README.md", "components.md"]) {
      await expect(menu.getByText(name, { exact: true })).toBeVisible();
    }

    await menu.getByRole("button", { name: "Close menu" }).click();
    await expect(menu).toHaveCount(0);
  });

  test("rejects a path outside the source roots, and one that already exists", async ({ page }) => {
    await openBuilder(page, "/");
    const menu = await openFileMenu(page);

    await menu.getByRole("button", { name: "New file" }).click();
    const input = menu.getByLabel("New file path");
    await input.fill("nowhere/Thing.tsx");
    await menu.getByRole("button", { name: "Create", exact: true }).click();
    await expect(menu.locator("small.error")).toContainText("Path must start with one of");
    await expect(input).toHaveAttribute("aria-invalid", "true");

    await input.fill("component/Button.tsx");
    await menu.getByRole("button", { name: "Create", exact: true }).click();
    await expect(menu.locator("small.error")).toContainText('"component/Button.tsx" already exists.');

    // Nothing was written for either attempt.
    const paths = await listSourcePaths(page);
    expect(paths).not.toContain("nowhere/Thing.tsx");

    await menu.getByRole("button", { name: "Cancel" }).click();
    await expect(menu.getByLabel("New file path")).toHaveCount(0);
  });

  test("creates a file in a root other than the open tab", async ({ page }) => {
    const notePath = `md/${TEMP_DIR}-note.md`;
    try {
      await openBuilder(page, "/");
      const menu = await openFileMenu(page);
      // The pages tab is open; a path naming another root is still accepted -
      // what is typed decides where the file goes, not the active tab.
      await menu.getByRole("button", { name: "New file" }).click();
      await menu.getByLabel("New file path").fill(notePath);
      await menu.getByRole("button", { name: "Create", exact: true }).click();

      // A non-page file opens in the file dialog straight after creation.
      await expect(fileDialog(page)).toBeVisible();
      await expect(fileDialog(page)).toHaveAttribute("aria-label", notePath);
      await closeFileDialog(page);

      expect(await listSourcePaths(page)).toContain(notePath);
      const menu2 = await openFileMenu(page);
      await selectRootTab(menu2, "md");
      await expect(menu2.getByText(`${TEMP_DIR}-note.md`, { exact: true })).toBeVisible();
    } finally {
      await deleteSource(page, notePath);
    }
  });

  test("creates, renames (rewriting imports) and deletes component files", async ({ page }) => {
    const widget = `component/${TEMP_DIR}/Widget.tsx`;
    const host = `component/${TEMP_DIR}/Host.tsx`;
    const movedWidget = `component/${TEMP_DIR}/nested/Widget.tsx`;
    try {
      await openBuilder(page, "/");

      const menu = await openFileMenu(page);
      await menu.getByRole("button", { name: "New file" }).click();
      await menu.getByLabel("New file path").fill(widget);
      await menu.getByRole("button", { name: "Create", exact: true }).click();
      await expect(fileDialog(page)).toHaveAttribute("aria-label", widget);
      // A brand-new component starts from a real template, not an empty file
      // (an empty module fails the build).
      expect(await readSource(page, widget)).toContain("export default function Widget()");
      await closeFileDialog(page);

      const menu2 = await openFileMenu(page);
      await menu2.getByRole("button", { name: "New file" }).click();
      await menu2.getByLabel("New file path").fill(host);
      await menu2.getByRole("button", { name: "Create", exact: true }).click();
      await expect(fileDialog(page)).toHaveAttribute("aria-label", host);
      // The specifier is extension-qualified on purpose: `import-rewrite.ts`
      // resolves `./Widget` to "component/e2e-tmp/Widget" and compares that
      // against the moved path verbatim, so only `./Widget.tsx` is recognised
      // as pointing at the file being moved (see its own unit tests).
      await fillEditor(
        fileDialog(page),
        'import Widget from "./Widget.tsx";\n\nexport default function Host() {\n  return <Widget />;\n}\n',
      );
      // Typing persists itself - there is no Save button anywhere in Page
      // Builder - so the assertion is on the store, not on a click.
      await expectStoredSource(page, host, 'from "./Widget.tsx"');
      await closeFileDialog(page);

      // Rename = move: the file's bytes relocate AND every relative import
      // that pointed at it is rewritten, or the next build breaks.
      const menu3 = await openFileMenu(page);
      await selectRootTab(menu3, "component");
      await menu3.getByRole("button", { name: "Rename Widget.tsx" }).click();
      await menu3.getByLabel("New path").fill(movedWidget);
      await menu3.getByRole("button", { name: "Rename", exact: true }).click();
      await expect(menu3.getByText("nested", { exact: true })).toBeVisible({ timeout: 30_000 });

      expect(await listSourcePaths(page)).toContain(movedWidget);
      expect(await listSourcePaths(page)).not.toContain(widget);
      await expectStoredSource(page, host, 'from "./nested/Widget.tsx"');

      // Delete both again, leaving the fixture tree as it was found.
      for (const [label, path] of [["Widget.tsx", movedWidget], ["Host.tsx", host]] as const) {
        await menu3.getByRole("button", { name: `Delete ${label}` }).click();
        const confirm = page.getByRole("dialog", { name: `Delete "${path}"?` });
        await expect(confirm).toBeVisible();
        await confirm.getByRole("button", { name: "Delete", exact: true }).click();
        await expect(confirm).toBeHidden();
      }
      const remaining = await listSourcePaths(page);
      expect(remaining).not.toContain(movedWidget);
      expect(remaining).not.toContain(host);
    } finally {
      await deleteSource(page, `component/${TEMP_DIR}`);
    }
  });

  test("opens page.tsx in the preview and every other route file in a dialog", async ({ page }) => {
    await openBuilder(page, "/");

    // `layout.tsx`/`404.tsx`/`500.tsx` live under pages/ but have no pathname
    // of their own to preview against, so they open in the file dialog.
    const menu = await openFileMenu(page);
    await menu.getByRole("button", { name: "layout.tsx", exact: true }).click();
    await expect(fileDialog(page)).toHaveAttribute("aria-label", "pages/layout.tsx");
    await closeFileDialog(page);

    // A page.tsx instead re-points the whole preview at its route.
    const menu2 = await openFileMenu(page);
    await menu2.locator(".page-components-tree-children").getByRole("button", { name: "page.tsx", exact: true }).click();
    await page.waitForURL(/path=%2Fabout/);
    await expect(codePanel(page).locator(".page-builder-code-panel-path")).toHaveText("pages/about/page.tsx");
    await expectPreviewText(page, "Built with drycms");
  });

  test("built-in style files cannot be deleted from the tree", async ({ page }) => {
    await openBuilder(page, "/");
    const menu = await openFileMenu(page);
    await selectRootTab(menu, "styles");

    // `globals.css`/`theme.css`/`base.css` back a hardcoded build entry and
    // each other's `@import`s; storage refuses to delete them, so the button
    // is not offered at all. Renaming stays available.
    for (const name of ["globals.css", "theme.css", "base.css"]) {
      await expect(menu.getByRole("button", { name: `Delete ${name}` })).toHaveCount(0);
      await expect(menu.getByRole("button", { name: `Rename ${name}` })).toBeVisible();
    }
  });
});
