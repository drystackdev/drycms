import { expect, test, type Page } from "@playwright/test";
import {
  apiFetch,
  BUILDER_TIMEOUT,
  deleteSource,
  dock,
  expectPreviewText,
  openBuilder,
  preview,
  saveBadgeCount,
  writeSource,
} from "./page-builder-utils.js";

/**
 * Visual editing - the dock's second panel. Clicking a `dry()`-rendered value
 * in the preview opens that entry's real admin form beside it, edits stream
 * back into the preview live, and they queue as content drafts alongside code
 * changes in Build & publish.
 *
 * The fixture (`mock/`) has no content-backed page, so this spec builds one:
 * a singleton content type, a value for it, and a page rendering the field.
 * Everything it creates is torn down again.
 */
test.describe.configure({ timeout: BUILDER_TIMEOUT });

const TYPE_ID = "e2e-vei-type";
const TYPE_NAME = "e2eVei";
const TYPE_LABEL = "E2E VEI";
const PAGE_PATH = "pages/e2e-vei/page.tsx";
const ROUTE = "/e2e-vei";
const HEADLINE = "Original headline";

const PAGE_SOURCE = `export default async function Page() {
  const site = await dry().singleton("${TYPE_NAME}").get();
  setTitle("E2E VEI");
  return (
    <main>
      <h1>{site.headline}</h1>
    </main>
  );
}
`;

async function createSingletonType(page: Page): Promise<void> {
  const definition = {
    id: TYPE_ID,
    kind: "singleton",
    name: TYPE_NAME,
    label: TYPE_LABEL,
    version: 0,
    fields: [{ id: `${TYPE_ID}-headline`, name: "headline", label: "Headline", type: "text", config: {}, validation: {}, order: 0 }],
  };
  const { status, body } = await apiFetch(page, "/dry/api/content-types", {
    method: "POST",
    json: true,
    body: JSON.stringify({ definition, confirm: true }),
  });
  expect(status, `creating the VEI fixture content type: ${body}`).toBeLessThan(300);
}

async function saveSingletonValue(page: Page, value: Record<string, unknown>): Promise<void> {
  const { status, body } = await apiFetch(page, `/dry/api/content/${TYPE_NAME}`, {
    method: "PUT",
    json: true,
    body: JSON.stringify(value),
  });
  expect(status, `saving the fixture singleton: ${body}`).toBeLessThan(300);
}

async function deleteContentType(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await apiFetch(page, `/dry/api/content-types/${encodeURIComponent(TYPE_ID)}`, { method: "DELETE" }).catch(() => undefined);
}

test.describe("Page Builder visual editing", () => {
  test("edits a dry() field from the preview and queues it as a content draft", async ({ page }) => {
    try {
      // Fixture: a singleton, a value, and a page that renders one field of it.
      await page.goto("/dry/dashboard");
      await createSingletonType(page);
      await saveSingletonValue(page, { headline: HEADLINE });
      await writeSource(page, PAGE_PATH, PAGE_SOURCE);

      await openBuilder(page, ROUTE);
      await expectPreviewText(page, HEADLINE);

      // Off by default: no dashed markers until visual editing is on.
      await expect(preview(page).locator("html")).not.toHaveClass(/dry-vei-enabled/);
      await dock(page).getByRole("button", { name: "Visual editing" }).click();
      await expect(page.locator(".page-builder-vei-sheet")).toContainText("Select content in the preview");
      await expect(preview(page).locator("html")).toHaveClass(/dry-vei-enabled/);

      // The value carries its own provenance out of `dry()`, so the element
      // that rendered it is marked without the page author doing anything.
      const marked = preview(page).locator("h1[data-dry]");
      await expect(marked).toHaveText(HEADLINE);
      await marked.click();

      // Clicking opens that entry's REAL admin form in the side panel,
      // aimed at the clicked field (`?_vei=1&_field=headline`).
      const editor = page.frameLocator('.page-builder-vei-panel iframe[title="Edit content"]');
      const field = editor.getByLabel("Headline", { exact: true });
      await expect(field).toHaveValue(HEADLINE, { timeout: 60_000 });

      // Typing streams back out through the bridge as a `vei:input` message.
      // The badge reacts immediately; the preview follows a moment later,
      // once it rebuilds with the pending value applied as an override.
      // (`PageBuilder.tsx` also tries a direct DOM patch, but the preview
      // frame is sandboxed without `allow-same-origin`, so its
      // `contentDocument` is always null and that path never runs.)
      await field.fill("Edited through VEI");
      await expect
        .poll(() => saveBadgeCount(page), { timeout: 30_000, message: "waiting for the content draft to queue" })
        .toBeGreaterThan(0);
      await expect(marked).toHaveText("Edited through VEI", { timeout: 60_000 });

      // It shows up as a content entry, not a code file, in Build & publish.
      await dock(page).getByRole("button", { name: "Build and publish" }).click();
      const dialog = page.getByRole("dialog", { name: "Preview changes before saving" });
      const contentGroup = dialog.locator(".page-builder-save-group").nth(1);
      await expect(contentGroup.getByText(TYPE_LABEL)).toBeVisible();
      await expect(dialog.locator(".page-builder-save-group").first()).toContainText("No code changes.");

      // Reverting the draft drops it from the queue and from the preview.
      await contentGroup.getByRole("button", { name: "Revert" }).click();
      await expect(contentGroup.getByText(TYPE_LABEL)).toHaveCount(0);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(marked).toHaveText(HEADLINE, { timeout: 30_000 });
    } finally {
      await deleteSource(page, "pages/e2e-vei");
      await deleteContentType(page);
    }
  });

  test("leaving visual editing clears the markers", async ({ page }) => {
    await openBuilder(page, "/");
    await expectPreviewText(page, "Your drycms project starts here");

    const veiToggle = dock(page).getByRole("button", { name: "Visual editing" });
    await veiToggle.click();
    await expect(preview(page).locator("html")).toHaveClass(/dry-vei-enabled/);

    // The panel's own Cancel closes the mode, not just the panel - the
    // preview has to stop offering editable affordances with it.
    await page.locator(".page-builder-vei-sheet").getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".page-builder-vei-sheet")).toHaveCount(0);
    await expect(preview(page).locator("html")).not.toHaveClass(/dry-vei-enabled/);
    await expect(veiToggle).toHaveAttribute("aria-pressed", "false");
  });
});
