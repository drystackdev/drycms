import { expect, test, type Page } from "@playwright/test";

const TEST_PATH = "pages/e2e-page-editor/page.tsx";
const EDITOR_URL = `/dry/page-editor?file=${encodeURIComponent(TEST_PATH)}`;
const INITIAL_MARKER = "Page Editor E2E initial";
const EDITED_MARKER = "Page Editor E2E saved and built";

function pageSource(marker: string): string {
  return `export default function Page() {
  return (
    <main>
      <h1>${marker}</h1>
      <button type="button" onClick={(event) => (event.currentTarget.textContent = "Interactive preview works")}>
        Test interaction
      </button>
    </main>
  );
}
`;
}

async function writeSource(page: Page, source: string): Promise<void> {
  // Use the admin app's CSRF-aware fetch wrapper. A pages-source write also
  // triggers Vite's page-source HMR, so let that cycle settle before opening
  // the file under test.
  await page.goto("/dry/page-editor");
  await expect(page.getByText("Page Builder", { exact: true })).toBeVisible();
  const result = await page.evaluate(
    async ({ path, code }) => {
      const response = await fetch(`/dry/api/pages-source/${path}`, { method: "PUT", body: code });
      return { ok: response.ok, body: await response.text() };
    },
    { path: TEST_PATH, code: source },
  );
  expect(result.ok, `Could not seed ${TEST_PATH}: ${result.body}`).toBe(true);
  await page.waitForTimeout(750);
}

async function removeSource(page: Page): Promise<void> {
  await page.goto("/dry/page-editor");
  await expect(page.getByText("Page Builder", { exact: true })).toBeVisible();
  const result = await page.evaluate(async (path) => {
    const response = await fetch(`/dry/api/pages-source/${path}`, { method: "DELETE" });
    return { ok: response.ok || response.status === 404, body: await response.text() };
  }, TEST_PATH);
  expect(result.ok, `Could not clean up ${TEST_PATH}: ${result.body}`).toBe(true);
}

test.describe("Page Editor", () => {
  test("edits, previews, saves, reloads, and builds a page", async ({ page }) => {
    await writeSource(page, pageSource(INITIAL_MARKER));

    try {
      await page.goto(EDITOR_URL);

      const editor = page.locator(".page-components-editor textarea");
      const save = page.getByRole("button", { name: "Save", exact: true });
      const preview = page.frameLocator('iframe[title="Page preview"]');

      await expect(editor).toBeVisible();
      await expect(editor).toHaveValue(new RegExp(INITIAL_MARKER));
      await expect(preview.getByRole("heading", { name: INITIAL_MARKER })).toBeVisible();

      await editor.fill(pageSource(EDITED_MARKER));
      await expect(page.getByText("1 unsaved", { exact: true })).toBeVisible();
      await expect(save).toBeEnabled();
      await expect(preview.getByRole("heading", { name: EDITED_MARKER })).toBeVisible();

      await preview.getByRole("button", { name: "Test interaction" }).click();
      await expect(preview.getByRole("button", { name: "Interactive preview works" })).toBeVisible();

      await save.click();
      await expect(save).toBeDisabled();
      await expect(page.getByText("1 to build", { exact: true })).toBeVisible();

      await page.reload();
      await expect(editor).toHaveValue(new RegExp(EDITED_MARKER));
      await expect(preview.getByRole("heading", { name: EDITED_MARKER })).toBeVisible();

      const build = page.getByRole("button", { name: "Build", exact: true });
      await expect(build).toBeVisible();
      await build.click();
      await expect(build).toBeHidden();

      await page.goto("/e2e-page-editor");
      await expect(page.getByRole("heading", { name: EDITED_MARKER })).toBeVisible();
    } finally {
      await removeSource(page);
    }
  });
});
