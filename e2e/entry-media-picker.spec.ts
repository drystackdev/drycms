import { expect, test, type Page } from "@playwright/test";

/**
 * The entry-scoped "Entry" tab in the entry form's own pickers
 * (`status/entry-media-folders.md`). Regression cover for the bug where a
 * pick made on that tab vanished: the scoped source used to hand back
 * PREFIX-STRIPPED ids ("cover.jpg"), so the value stored on the field was
 * not a real storage path and resolved to nothing - on the field, on the
 * public site, and for Magic's `storage.stat()` checks.
 */

/** A 1x1 PNG - the smallest thing the picker will accept as an image. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Creates (and applies) a slugged collection with one Image field, then
 * returns the table name to open its entry form at. */
async function createSluggedCollectionWithImage(page: Page): Promise<string> {
  await page.goto("/dry/content-types/");
  await page.getByRole("button", { name: "Add" }).click();

  const addDialog = page.getByRole("dialog", { name: "Add collection" });
  await addDialog.getByLabel("Table Name*", { exact: true }).fill(`E2E Media ${Date.now()}`);
  // See `content-type-editor.spec.ts` on why this is a prefix match.
  await addDialog.getByLabel(/^Slug/).check();
  const tableName = await addDialog.getByLabel("Table", { exact: true }).inputValue();

  await addDialog.getByRole("button", { name: "Add Field" }).click();
  const fieldDialog = page.getByRole("dialog", { name: "Add field" });
  await fieldDialog.getByRole("button", { name: "Select…" }).click();
  await page.getByRole("option", { name: "Image", exact: true }).click();
  await fieldDialog.getByLabel("Label*", { exact: true }).fill("Cover");
  await fieldDialog.getByLabel("Name", { exact: true }).fill("cover");
  await fieldDialog.getByRole("button", { name: "Save field" }).click();
  await expect(fieldDialog).toBeHidden();

  await addDialog.getByRole("button", { name: "Save draft" }).click();
  await expect(addDialog).toBeHidden();

  await page.locator(".page-header").getByRole("button", { name: "Apply Builder" }).click();
  const applyDialog = page.getByRole("dialog", { name: "Apply and build" });
  await applyDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(applyDialog).toContainText("No conflicts found");
  await applyDialog.getByRole("button", { name: "Save" }).click();
  await expect(applyDialog).toBeHidden();

  return tableName;
}

test.describe("Entry media picker", () => {
  test("an image uploaded and picked on the Entry tab shows on the field, as a full storage path", async ({ page }) => {
    const tableName = await createSluggedCollectionWithImage(page);
    await page.goto(`/dry/content/${tableName}/new`);

    // The trigger's accessible name is the field's own label ("Cover"); the
    // "Choose image" text is a `<span>` inside it.
    await page.locator("button.image-field-empty").click();
    const picker = page.getByRole("dialog", { name: "Choose image" });
    // A brand-new entry's own folder is where the picker opens.
    await expect(picker.getByRole("tab", { name: "Entry" })).toHaveAttribute("aria-selected", "true");

    // Upload into the entry folder - it doesn't exist on disk yet, so this
    // also covers `scopeFileSource`'s create-then-retry at the scoped root.
    await picker.getByRole("button", { name: "Upload" }).click();
    const uploadDialog = page.getByRole("dialog", { name: "Upload files" });
    await uploadDialog.locator('input[type="file"]').setInputFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    await uploadDialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(uploadDialog).toBeHidden();

    // Uploads are converted to WebP by the picker's own "Optimize" switch,
    // which is on by default for images (`file-manager-image-optimize.ts`).
    await picker.getByRole("checkbox", { name: "Select cover.webp" }).check();
    // `exact` matters: the selection toolbar's "Unselect" contains this name
    // as a substring, which a loose match would resolve to as well.
    await picker.getByRole("button", { name: "Select", exact: true }).click();
    await expect(picker).toBeHidden();

    // The bug: this stayed on "Choose image" with no thumbnail, because the
    // stored id was scope-relative and resolved to no `FileEntry` at all.
    const thumb = page.locator("img.image-field-thumb");
    await expect(thumb).toBeVisible();
    await expect(page.getByRole("button", { name: "Change cover.webp" })).toBeVisible();
    // A real storage path under this admin's staging folder for the entry -
    // rewritten to `entry/<slug>/cover.webp` by the first save.
    await expect(thumb).toHaveAttribute("src", /\/api\/storage\/\.tmp\.[^/]+\/cover\.webp$/);

    // And the value survives that rewrite: saving moves the staging folder to
    // `entry/<slug>` and rewrites the field with it (`entry-media.ts`), which
    // only works because what got stored was a real storage path to begin
    // with. Re-opened from the list, the cover still resolves.
    await page.getByLabel("Title*", { exact: true }).fill("Cover Test");
    // The entry form hands its actions to the layout topbar, not a local
    // `.page-header` (that one only exists inside the VEI dialog).
    await page.getByRole("banner").getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(`**/content/${tableName}`);
    await page.getByText("Cover Test").click();

    await expect(page.locator("img.image-field-thumb")).toHaveAttribute(
      "src",
      /\/api\/storage\/entry\/cover-test\/cover\.webp$/,
    );
  });

  test("Magic's attach-images picker offers the same Entry tab", async ({ page }) => {
    const tableName = await createSluggedCollectionWithImage(page);
    await page.goto(`/dry/content/${tableName}/new`);

    await page.getByRole("button", { name: "Magic", exact: true }).click();
    await page.getByRole("button", { name: "Attach images" }).first().click();

    const attachDialog = page.getByRole("dialog", { name: "Attach images" });
    await expect(attachDialog.getByRole("tab", { name: "Entry" })).toHaveAttribute("aria-selected", "true");
    await expect(attachDialog.getByRole("tab", { name: "File" })).toBeVisible();
  });
});
