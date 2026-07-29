import { expect, test, type Page } from "@playwright/test";

/** Creates a fresh collection via the "new" flow so the rest of the suite
 * doesn't depend on any particular content type already existing in the
 * dev database, then leaves the page on its edit URL. Returns its id too,
 * so callers can delete it again via the API once done (see
 * `deleteContentType`) - this suite runs against the real dev database, not
 * a throwaway fixture, so it must not leave test rows behind. */
async function createTestCollection(page: Page, options?: { slug?: boolean }): Promise<{ id: string; title: string }> {
  await page.goto("/dry/content-types/new/collection");
  const uniqueTitle = `E2E Test ${Date.now()}`;
  await page.getByLabel("Table Name*", { exact: true }).fill(uniqueTitle);
  if (options?.slug) {
    // `CheckField`'s description text lives inside the same `<label>`, so the
    // accessible name is "Slug Adds a URL-friendly Slug field, ..." - matched
    // as a prefix rather than pinned to that whole description string.
    await page.getByLabel(/^Slug\b/).check();
  }
  await page.getByRole("button", { name: "Save & apply schema" }).click();
  await page.waitForURL("**/dry/content-types");
  // Filter down to the one row - repeated runs leave earlier collections
  // around, which would otherwise push this one onto a later table page.
  await page.getByPlaceholder("Filter…").fill(uniqueTitle);
  await page.getByRole("row", { name: new RegExp(uniqueTitle) }).click();
  await page.waitForURL(/\/dry\/content-types\/.+\/edit/);
  const id = page.url().match(/\/content-types\/([^/]+)\/edit/)?.[1];
  if (!id) throw new Error("Could not extract content type id from URL.");
  return { id, title: uniqueTitle };
}

/** Adds a custom text field via the dialog, using its default settings. */
async function addTextField(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Add Field" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Label", { exact: true }).fill(label);
  await dialog.getByRole("button", { name: "Select…" }).click();
  await page.getByRole("option", { name: "Text" }).click();
  await dialog.getByRole("button", { name: "Save field" }).click();
  await expect(dialog).toBeHidden();
}

/** Deletes via `fetch()` run inside the page itself (not Playwright's
 * out-of-process `page.request`) - Astro's CSRF check rejects cross-origin
 * DELETEs, and `page.request` doesn't carry the real page origin the way an
 * in-page `fetch()` does. */
async function deleteContentType(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (deleteId) => fetch(`/dry/api/content-types/${encodeURIComponent(deleteId)}`, { method: "DELETE" }),
    id,
  );
}

test.describe("Content Type editor", () => {
  test("SlugField auto-derives the slug from the title, editably", async ({ page }) => {
    await page.goto("/dry/content-types/new/collection");

    const titleInput = page.getByLabel("Table Name*", { exact: true });
    const slugInput = page.getByLabel("Table", { exact: true });

    await titleInput.fill("My Blog Post");
    await expect(slugInput).toHaveValue("my-blog-post");

    // Editing the slug directly stops auto-derivation.
    await slugInput.fill("custom-slug");
    await titleInput.fill("My Blog Post Two");
    await expect(slugInput).toHaveValue("custom-slug");

    // The regenerate button re-syncs it from the current title.
    await page.getByRole("button", { name: "Regenerate slug from title" }).click();
    await expect(slugInput).toHaveValue("my-blog-post-two");
  });

  test("Add Field dialog: 2-column layout, type-gated placeholder, default value at top of right column", async ({
    page,
  }) => {
    await page.goto("/dry/content-types/new/collection");
    await page.getByLabel("Table Name*", { exact: true }).fill("Dialog Test");

    await page.getByRole("button", { name: "Add Field" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 2-column grid at desktop width.
    const columns = await dialog
      .locator(".field-dialog-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(2);

    // Right column shows a bordered placeholder until a type is chosen.
    await expect(dialog.getByText("Choose a field type to configure its settings.")).toBeVisible();
    await expect(dialog.getByText("Display")).toHaveCount(0);
    await expect(dialog.getByLabel("Default value", { exact: true })).toHaveCount(0);

    // Label -> Name via the dialog's own SlugField.
    await dialog.getByLabel("Label", { exact: true }).fill("My Field");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("my-field");

    await dialog.getByRole("button", { name: "Select…" }).click();
    await page.getByRole("option", { name: "Text" }).click();
    await expect(dialog.getByText("Choose a field type")).toHaveCount(0);

    // Default value renders at the very top of the (now populated) right column.
    const rightColumnFirstControl = dialog.locator(".field-dialog-grid > div:last-child > *").first();
    await expect(rightColumnFirstControl.getByLabel("Default value")).toBeVisible();
  });

  test("text validation: regex/format mutually exclusive, minLength=0 does not force Required, minLength>0 does", async ({
    page,
  }) => {
    await page.goto("/dry/content-types/new/collection");
    await page.getByLabel("Table Name*", { exact: true }).fill("Dialog Test 2");
    await page.getByRole("button", { name: "Add Field" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Select…" }).click();
    await page.getByRole("option", { name: "Text" }).click();

    const regexInput = dialog.getByLabel("Regex", { exact: true });
    const formatSelect = dialog.locator(".field", { hasText: "Format" }).getByRole("button");
    const requiredCheckbox = dialog.getByLabel("Required", { exact: true });
    const minLengthInput = dialog.getByLabel("Min length", { exact: true });

    // Untouched minLength (displays 0 by default) must NOT force Required.
    await expect(requiredCheckbox).not.toBeChecked();
    await expect(requiredCheckbox).toBeEnabled();

    await regexInput.fill("^[a-z]+$");
    await expect(formatSelect).toBeDisabled();
    await expect(requiredCheckbox).toBeChecked();
    await expect(requiredCheckbox).toBeDisabled();
    await regexInput.fill("");
    await expect(formatSelect).toBeEnabled();
    await expect(requiredCheckbox).toBeEnabled();

    // A real (>0) minLength forces Required.
    await minLengthInput.fill("3");
    await expect(requiredCheckbox).toBeChecked();
    await expect(requiredCheckbox).toBeDisabled();

    // Required + Unique share a row; Min length + Max length share a row.
    const uniqueCheckbox = dialog.getByLabel("Unique", { exact: true });
    const maxLengthInput = dialog.getByLabel("Max length", { exact: true });
    const requiredBox = await requiredCheckbox.boundingBox();
    const uniqueBox = await uniqueCheckbox.boundingBox();
    const minBox = await minLengthInput.boundingBox();
    const maxBox = await maxLengthInput.boundingBox();
    expect(Math.abs(requiredBox!.y - uniqueBox!.y)).toBeLessThan(4);
    expect(Math.abs(minBox!.y - maxBox!.y)).toBeLessThan(4);

    // Switch to "number" - step defaults to 1.
    await dialog.getByRole("button", { name: "Text" }).click();
    await page.getByRole("option", { name: "Number" }).click();
    const stepInput = dialog.getByLabel("Step", { exact: true });
    await expect(stepInput).toHaveValue("1");
  });

  test("Add Field dialog scrolls its own body instead of the window when content overflows", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 500 });
    await page.goto("/dry/content-types/new/collection");
    await page.getByLabel("Table Name*", { exact: true }).fill("Scroll Test");

    await page.getByRole("button", { name: "Add Field" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Select…" }).click();
    await page.getByRole("option", { name: "Text" }).click();
    await expect(dialog.getByText("Validation")).toBeVisible();

    // Scrolling is handled by native overflow on `.field-dialog-scroll` (the
    // grid's wrapper), not by the grid itself or the window.
    const scrollRoot = dialog.locator(".field-dialog-scroll");
    const gridOverflows = await scrollRoot.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(gridOverflows).toBe(true);

    const windowScrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
    );
    expect(windowScrollable).toBe(false);
  });

  test("Remove field shows a confirm dialog before removing", async ({ page }) => {
    const { id } = await createTestCollection(page);
    try {
      await addTextField(page, "Removable");
      await page.getByRole("button", { name: "Remove" }).click();
      const confirm = page.getByRole("dialog", { name: /Remove "Removable"/ });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByText("Removable")).toHaveCount(0);
    } finally {
      await deleteContentType(page, id);
    }
  });

  test("Editing an existing content type shows the apply-schema confirm before saving", async ({ page }) => {
    const { id } = await createTestCollection(page);
    try {
      await page.getByRole("button", { name: "Save & apply schema" }).click();
      const confirm = page.getByRole("dialog", { name: "Apply schema changes?" });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Save & apply" }).click();
      await page.waitForURL("**/dry/content-types");
    } finally {
      await deleteContentType(page, id);
    }
  });

  test("Fields list: system rows have no click-to-edit/Remove, ID has no drag handle, Title does", async ({
    page,
  }) => {
    const { id } = await createTestCollection(page, { slug: true });
    try {
      const list = page.locator(".content-type-editor-grid ul.content-type-list");
      const idRow = list.locator("li", { hasText: "ID" }).first();
      const titleRow = list.locator("li", { hasText: "Title" }).first();

      await expect(idRow.getByRole("button", { name: "Reorder" })).toHaveCount(0);
      await expect(idRow.getByRole("button", { name: "Remove" })).toHaveCount(0);
      await expect(titleRow.getByRole("button", { name: "Reorder" })).toBeVisible();
      await expect(titleRow.getByRole("button", { name: "Remove" })).toHaveCount(0);

      // Clicking a system row does nothing (no dialog opens).
      await idRow.click();
      await expect(page.getByRole("dialog")).toBeHidden();
    } finally {
      await deleteContentType(page, id);
    }
  });

  test("Dragging a field's handle reorders the unified fields list", async ({ page }) => {
    const { id } = await createTestCollection(page);
    try {
      await addTextField(page, "First");
      await addTextField(page, "Second");

      const list = page.locator(".content-type-editor-grid ul.content-type-list");
      const firstHandle = list.locator("li", { hasText: "First" }).getByRole("button", { name: "Reorder" });
      const secondRow = list.locator("li", { hasText: "Second" });

      const firstBox = await firstHandle.boundingBox();
      const secondBox = await secondRow.boundingBox();
      if (!firstBox || !secondBox) throw new Error("rows not found");

      await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(
          firstBox.x + firstBox.width / 2,
          firstBox.y + firstBox.height / 2 + (i * (secondBox.y - firstBox.y + secondBox.height)) / 8,
        );
        await page.waitForTimeout(15);
      }
      await page.mouse.up();

      const rows = await list.locator("li").allTextContents();
      const firstIndex = rows.findIndex((t) => t.includes("First"));
      const secondIndex = rows.findIndex((t) => t.includes("Second"));
      expect(secondIndex).toBeLessThan(firstIndex);
    } finally {
      await deleteContentType(page, id);
    }
  });
});
