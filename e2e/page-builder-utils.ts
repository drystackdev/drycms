import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared helpers for the `page-builder*.spec.ts` files.
 *
 * One thing worth knowing before reading any of those specs: `scripts/
 * e2e-server.mjs` deliberately blanks `GITHUB_REPO`/`GITHUB_BRANCH`/
 * `GITHUB_PAT_KEY`, so every e2e run exercises Page Builder's
 * **no-repository** path - `use-page-builder-source.ts`'s `usingGit === false`
 * branch, which reads and writes `/api/pages-source` over HTTP. The git
 * working-copy branch (ZenFS + isomorphic-git, commit/push on Build &
 * publish) can't be covered here without a real remote to clone from, and is
 * covered by `src/server/routes/git.test.ts` plus the unit tests around
 * `git-state`. Assertions below therefore describe HTTP-store behaviour and
 * say so wherever the two differ.
 */

/** Every path the fixture tree (`mock/`, seeded into a fresh e2e store) is
 * expected to contain, so a spec can assert it left the tree as it found it. */
export const FIXTURE_PATHS = [
  "pages/page.tsx",
  "pages/about/page.tsx",
  "pages/layout.tsx",
  "pages/404.tsx",
  "pages/500.tsx",
  "component/Button.tsx",
  "component/ThemeToggle.tsx",
  "component/lib/cva.ts",
  "component/lib/utils.ts",
  "styles/globals.css",
  "styles/theme.css",
  "styles/base.css",
  "md/README.md",
  "md/components.md",
];

/** Opening the builder compiles the previewed page in-browser (Sucrase +
 * Tailwind inside a throwaway iframe), which routinely takes longer than
 * Playwright's 30s default on a cold run. Every page-builder spec sets this. */
export const BUILDER_TIMEOUT = 180_000;

/**
 * A fresh Page Builder at `pathname`, with any persisted panel state dropped
 * on the way in.
 *
 * That clearing matters whenever a test opens the builder a SECOND time:
 * `PageBuilder.tsx` restores `panelMode`/`fileDialogPath` from
 * `sessionStorage`, so a `FileDialog` left open earlier re-opens over the
 * dock and swallows its clicks. It is deliberately done here (before the
 * navigation) rather than in an `addInitScript`, which would re-run on every
 * later `page.reload()` and make the restore itself untestable. A brand-new
 * Playwright context starts with empty `sessionStorage` anyway - `storageState`
 * carries cookies and localStorage only.
 */
export async function openBuilder(page: Page, pathname = "/"): Promise<void> {
  if (page.url().startsWith("http")) {
    await page
      .evaluate(() => {
        sessionStorage.removeItem("drycms:page-builder-state");
        // The "written but not yet published" ledger (no-repository mode) -
        // deliberately session-scoped so a reload can't strand a change, which
        // also means it outlives a re-open inside one test.
        sessionStorage.removeItem("drycms:page-builder-unpublished");
      })
      .catch(() => undefined);
  }
  await page.goto(`/dry/page-builder?path=${encodeURIComponent(pathname)}`);
  await expect(page.locator(".dock")).toBeVisible({ timeout: 60_000 });
}

export function dock(page: Page): Locator {
  return page.locator(".dock");
}

/** The full-viewport preview iframe's own document. Sandboxed (`allow-scripts`
 * only, opaque origin), so nothing but Playwright's own frame access can
 * reach inside it - which is exactly what a real visitor sees. */
export function preview(page: Page) {
  return page.frameLocator(".page-builder-preview-frame");
}

/** Waits for the preview to have finished a build and rendered real page
 * markup, rather than the empty frame it shows while compiling. */
export async function expectPreviewText(page: Page, text: string | RegExp): Promise<void> {
  await expect(preview(page).locator("body")).toContainText(text, { timeout: 120_000 });
}

export async function openFileMenu(page: Page): Promise<Locator> {
  await dock(page).getByRole("button", { name: "Open file menu" }).click();
  const menu = page.getByRole("dialog", { name: "Page source files" });
  await expect(menu).toBeVisible();
  return menu;
}

/** `PAGES_SOURCE_ROOTS` order - the tab strip has no accessible names beyond
 * its icons' `title`, so the specs address tabs by root id through here. */
const ROOT_TAB_INDEX: Record<string, number> = { pages: 0, component: 1, styles: 2, md: 3 };

export async function selectRootTab(menu: Locator, root: keyof typeof ROOT_TAB_INDEX | string): Promise<void> {
  const index = ROOT_TAB_INDEX[root];
  if (index === undefined) throw new Error(`Unknown source root "${root}".`);
  const tab = menu.locator(".page-builder-bubble-tabs [role=tab]").nth(index);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Reads a file straight out of `pagesSourceStorage`, bypassing the UI - the
 * only way to prove an edit actually landed in the store rather than just in
 * the editor's buffer. Must run from an ADMIN page: the request needs the
 * session cookie, and `lib/native/csrf-fetch.ts` (loaded by the admin bundle
 * only) is what attaches `X-CSRF-Token` to the mutating calls below. */
export async function readSource(page: Page, path: string): Promise<string> {
  return page.evaluate(async (filePath) => {
    const response = await fetch(`/dry/api/pages-source/${filePath.split("/").map(encodeURIComponent).join("/")}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GET ${filePath} failed: HTTP ${response.status}`);
    return response.text();
  }, path);
}

export async function writeSource(page: Page, path: string, code: string): Promise<void> {
  const status = await page.evaluate(
    async ([filePath, body]) => {
      const response = await fetch(`/dry/api/pages-source/${filePath.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT",
        body,
      });
      return response.status;
    },
    [path, code],
  );
  expect(status, `PUT ${path}`).toBeLessThan(300);
}

/** Best-effort cleanup - a spec's `finally` block calls this for paths that
 * may or may not exist, so a 404 is not a failure. */
export async function deleteSource(page: Page, path: string): Promise<void> {
  if (page.isClosed()) return;
  await page
    .evaluate(
      (filePath) =>
        fetch(`/dry/api/pages-source/${filePath.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" }).then(
          () => undefined,
        ),
      path,
    )
    .catch(() => undefined);
}

/**
 * The PUBLISHED HTML for `pathname`, or `null` when that route has never been
 * built (`GET /api/pages-build?path=`, reading `built/live/*`).
 *
 * This is the only way to tell a real publish apart from a source edit while
 * running against the dev server: `bun run dev` renders public pages live from
 * `pagesSourceStorage`, so visiting the route shows an unpublished change too.
 */
export async function readBuiltPage(page: Page, pathname: string): Promise<string | null> {
  return page.evaluate(async (target) => {
    const response = await fetch(`/dry/api/pages-build?path=${encodeURIComponent(target)}`, { cache: "no-store" });
    if (!response.ok) return null;
    return response.text();
  }, pathname);
}

export async function listSourcePaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const response = await fetch("/dry/api/pages-source?tree", { cache: "no-store" });
    const body = (await response.json()) as { entries?: Array<{ id: string; kind: string }> };
    return (body.entries ?? []).filter((entry) => entry.kind === "file").map((entry) => entry.id);
  });
}

/**
 * Types into the `Editer` mounted inside `container`.
 *
 * `Editer` stacks a real `<textarea>` transparently over its highlighted
 * lines (see its own doc comment), so the textarea IS the editing surface and
 * `fill()` drives it exactly as typing would - including the `input` event
 * the component listens on. `pressSequentially` would be closer to real
 * typing but costs a full re-highlight per character on a multi-KB file.
 */
export async function fillEditor(container: Locator, code: string): Promise<void> {
  const textarea = container.locator("textarea").first();
  await expect(textarea).toBeVisible();
  await textarea.fill(code);
}

/**
 * Waits until `path`'s content in storage satisfies `match`.
 *
 * Editing is deliberately fire-and-forget: `Editer` debounces its own
 * `onChange` off the keystroke path, then `updateSource` debounces the write
 * again (400ms), so an edit reaches storage roughly a second and a half after
 * the last keypress with no UI event that reliably marks the moment. Polling
 * the store is the only assertion that can't race it.
 */
export async function expectStoredSource(page: Page, path: string, match: string | RegExp): Promise<void> {
  await expect
    .poll(async () => readSource(page, path), { timeout: 20_000, message: `waiting for ${path} to be written` })
    .toEqual(typeof match === "string" ? expect.stringContaining(match) : expect.stringMatching(match));
}

export function codePanel(page: Page): Locator {
  return page.locator(".page-builder-code-panel");
}

export function fileDialog(page: Page): Locator {
  return page.locator("dialog.page-builder-file-dialog");
}

/**
 * Dismisses the file dialog through its own Close button rather than
 * `Escape`.
 *
 * Escape is unreliable here: focus usually sits in `Editer`'s textarea, whose
 * autocomplete/find extensions consume the key, and a `<dialog>` that closes
 * natively without `onClose` running leaves `fileDialogPath` set - so the very
 * next re-render calls `showModal()` again and the dialog silently reappears
 * over the dock, swallowing its clicks.
 */
export async function closeFileDialog(page: Page): Promise<void> {
  await fileDialog(page).getByRole("button", { name: "Close" }).click();
  await expect(fileDialog(page)).toHaveCount(0);
}

/** The dock's Build & publish badge, as a number (`0` when absent). */
export async function saveBadgeCount(page: Page): Promise<number> {
  const badge = dock(page).locator(".dock-save-badge");
  if ((await badge.count()) === 0) return 0;
  return Number((await badge.first().textContent())?.trim() ?? "0");
}
