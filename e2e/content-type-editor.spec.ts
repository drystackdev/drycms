import { expect, test, type Page } from "@playwright/test";

/** Creates a fresh collection via the "Add" dialog on the Content Types list
 * page (there is no dedicated `/content-types/new/:kind` route anymore -
 * creation/editing both happen through `CollectionEditorDialog`'s modal,
 * see `pages/BuilderContentType.tsx`), applies it so it's real/queryable,
 * then re-opens it in the edit dialog and leaves the page there for the
 * rest of the test. Returns its id too, so callers can delete it again via
 * the API once done (see `deleteContentType`) - this suite runs against the
 * real dev database, not a throwaway fixture, so it must not leave test
 * rows behind. */
async function createTestCollection(page: Page, options?: { slug?: boolean }): Promise<{ id: string; title: string }> {
  await page.goto("/dry/content-types/");
  const uniqueTitle = `E2E Test ${Date.now()}`;

  await page.getByRole("button", { name: "Add" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add collection" });
  await addDialog.getByLabel("Table Name*", { exact: true }).fill(uniqueTitle);
  if (options?.slug) {
    // `CheckField`'s description text lives inside the same `<label>` with no
    // separator, so the accessible name is "SlugAdds a URL-friendly Slug
    // field, ..." (no space between label and description) - matched as a
    // prefix rather than pinned to that whole description string. No `\b`
    // here: "g"/"A" are both word characters, so a boundary never appears.
    await addDialog.getByLabel(/^Slug/).check();
  }
  await addDialog.getByRole("button", { name: "Save draft" }).click();
  await expect(addDialog).toBeHidden();

  await page.locator(".page-header").getByRole("button", { name: "Apply Builder" }).click();
  const applyDialog = page.getByRole("dialog", { name: "Apply and build" });
  await applyDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(applyDialog).toContainText("No conflicts found");
  await applyDialog.getByRole("button", { name: "Save" }).click();
  await expect(applyDialog).toBeHidden();

  // No more URL to read an id off - the list is dialog-driven now, so look
  // the newly-applied type up by its (unique) label through the same API
  // `deleteContentType` already uses an in-page `fetch()` for.
  const id = await page.evaluate(async (title) => {
    const response = await fetch("/dry/api/content-types");
    const body = (await response.json()) as { definitions: { id: string; label: string }[] };
    return body.definitions.find((d) => d.label === title)?.id;
  }, uniqueTitle);
  if (!id) throw new Error("Could not find the newly-applied content type via the API.");

  // Filter down to the one card, then open it for editing - repeated runs
  // leave earlier collections around, which could otherwise match more than
  // one card for a loose title. Scoped to the panel: the sidebar nav lists
  // every collection too (including this brand-new one), so an unscoped
  // text match would also hit that link.
  await page.getByPlaceholder("e.g. blog_posts").fill(uniqueTitle);
  await page.locator("#builder-collections-panel").getByText(uniqueTitle, { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit collection" })).toBeVisible();

  return { id, title: uniqueTitle };
}

/** Adds a custom text field via the dialog, using its default settings. */
async function addTextField(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Add Field" }).click();
  const dialog = page.getByRole("dialog", { name: "Add field" });
  await dialog.getByRole("button", { name: "Select…" }).click();
  await page.getByRole("option", { name: "Text", exact: true }).click();
  // Choosing a type initializes that type's draft/config, so fill identity
  // fields after it rather than racing the initialization render.
  await dialog.getByLabel("Label*", { exact: true }).fill(label);
  const fieldName = label
    .replace(/[^A-Za-z0-9]+(.)/g, (_match, next: string) => next.toUpperCase())
    .replace(/^./, (first) => first.toLowerCase());
  await dialog.getByLabel("Name", { exact: true }).fill(fieldName);
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
    await page.goto("/dry/content-types/");
    await page.getByRole("button", { name: "Add" }).click();
    const dialog = page.getByRole("dialog", { name: "Add collection" });

    const titleInput = dialog.getByLabel("Table Name*", { exact: true });
    const slugInput = dialog.getByLabel("Table", { exact: true });

    await titleInput.fill("My Blog Post");
    await expect(slugInput).toHaveValue("my-blog-post");

    // Editing the slug directly stops auto-derivation.
    await slugInput.fill("custom-slug");
    await titleInput.fill("My Blog Post Two");
    await expect(slugInput).toHaveValue("custom-slug");

    // The regenerate button re-syncs it from the current title.
    await dialog.getByRole("button", { name: "Regenerate slug from title" }).click();
    await expect(slugInput).toHaveValue("my-blog-post-two");
  });

  test("Add Field dialog: 2-column layout, type-gated placeholder, default value at top of right column", async ({
    page,
  }) => {
    await page.goto("/dry/content-types/");
    await page.getByRole("button", { name: "Add" }).click();
    const addDialog = page.getByRole("dialog", { name: "Add collection" });
    await addDialog.getByLabel("Table Name*", { exact: true }).fill("Dialog Test");

    await addDialog.getByRole("button", { name: "Add Field" }).click();
    const dialog = page.getByRole("dialog", { name: "Add field" });
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
    await dialog.getByLabel("Label*", { exact: true }).fill("My Field");
    // Field names are camelCase identifiers now (matching JS property-name
    // convention), not kebab-case slugs like a content type's own "Table".
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("myField");

    await dialog.getByRole("button", { name: "Select…" }).click();
    await page.getByRole("option", { name: "Text", exact: true }).click();
    await expect(dialog.getByText("Choose a field type")).toHaveCount(0);

    // Default value renders at the very top of the (now populated) right column.
    const rightColumnFirstControl = dialog.locator(".field-dialog-grid > div:last-child > *").first();
    await expect(rightColumnFirstControl.getByLabel("Default value")).toBeVisible();
  });

  test("text validation: regex/format mutually exclusive, minLength=0 does not force Required, minLength>0 does", async ({
    page,
  }) => {
    await page.goto("/dry/content-types/");
    await page.getByRole("button", { name: "Add" }).click();
    const addDialog = page.getByRole("dialog", { name: "Add collection" });
    await addDialog.getByLabel("Table Name*", { exact: true }).fill("Dialog Test 2");
    await addDialog.getByRole("button", { name: "Add Field" }).click();
    const dialog = page.getByRole("dialog", { name: "Add field" });
    await dialog.getByRole("button", { name: "Select…" }).click();
    await page.getByRole("option", { name: "Text", exact: true }).click();

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
    await page.goto("/dry/content-types/");
    await page.getByRole("button", { name: "Add" }).click();
    const addDialog = page.getByRole("dialog", { name: "Add collection" });
    await addDialog.getByLabel("Table Name*", { exact: true }).fill("Scroll Test");

    await addDialog.getByRole("button", { name: "Add Field" }).click();
    const dialog = page.getByRole("dialog", { name: "Add field" });
    await dialog.getByRole("button", { name: "Select…" }).click();
    await page.getByRole("option", { name: "Text", exact: true }).click();
    await expect(dialog.getByText("Validation")).toBeVisible();

    // The dialog owns the scroll root; at this viewport the current field
    // settings fit, so the root may not need to overflow.
    const scrollRoot = dialog.locator(".field-dialog-scroll");
    await expect(scrollRoot).toBeVisible();

    const windowScrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
    );
    expect(windowScrollable).toBe(false);
  });

  test("Remove field stages it in the archive immediately", async ({ page }) => {
    const { id } = await createTestCollection(page);
    try {
      await addTextField(page, "Removable");
      await page.getByRole("button", { name: "Remove" }).click();
      // Removing a field now stages it immediately in the archive; the extra
      // confirmation only applies to deleting it forever from that archive.
      await expect(page.getByText("Removable")).toHaveCount(0);
    } finally {
      await deleteContentType(page, id);
    }
  });

  test("Editing an existing content type stages a draft before applying it", async ({ page }) => {
    const { id } = await createTestCollection(page);
    try {
      // Save draft is disabled until the form is actually dirty - add a field
      // first so there is a real schema change to stage.
      await addTextField(page, "Some Field");
      const editDialog = page.getByRole("dialog", { name: "Edit collection" });
      await editDialog.getByRole("button", { name: "Save draft" }).click();
      await expect(editDialog).toBeHidden();
      // Back on the list, the pending draft surfaces as the header's "Apply
      // Builder" button (only rendered while `pendingCount > 0`) rather than
      // a dedicated "Unapplied changes" banner.
      await expect(page.locator(".page-header").getByRole("button", { name: "Apply Builder" })).toBeVisible();

      const applyDialog = page.getByRole("dialog", { name: "Apply and build" });
      await page.locator(".page-header").getByRole("button", { name: "Apply Builder" }).click();
      await applyDialog.getByRole("button", { name: "Confirm" }).click();
      await expect(applyDialog).toContainText("No conflicts found");
      await applyDialog.getByRole("button", { name: "Save" }).click();
      await expect(applyDialog).toBeHidden();
    } finally {
      await deleteContentType(page, id);
    }
  });

  test("Fields list: ID is implicit, Title & Slug is one reorderable system row", async ({
    page,
  }) => {
    const { id } = await createTestCollection(page, { slug: true });
    try {
      const list = page.locator(".content-type-editor-grid ul.content-type-list");
      await expect(list.locator("li", { hasText: /^ID$/ })).toHaveCount(0);
      const titleSlugRow = list.locator("li", { hasText: "Title & Slug" });
      await expect(titleSlugRow).toBeVisible();
      await expect(titleSlugRow.getByRole("button", { name: "Reorder" })).toBeVisible();
      await expect(titleSlugRow.getByRole("button", { name: "Remove" })).toHaveCount(0);
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
