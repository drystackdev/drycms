import { expect, test, type Page } from "@playwright/test";

/**
 * Pasting into RichText (`status/richtext-paste-images.md`): a pasted image
 * is confirmed, uploaded into the ENTRY's own media folder and its blob URL
 * replaced with the real storage path, and pasted inline styles are cut down
 * to the vocabulary the editor actually supports.
 *
 * Creates its own collection rather than reusing a fixture type: the e2e
 * server boots a fresh database seeded with the packaged system types only
 * (`content-types/seed.ts`), which has no content type carrying a richtext
 * field.
 */

/** Creates (and applies) a slugged collection with one RichText field, then
 * returns the table name to open its entry form at. Same shape as
 * `entry-media-picker.spec.ts`'s own helper - see that file for why each
 * label match is written the way it is. */
async function createSluggedCollectionWithRichText(page: Page): Promise<string> {
  await page.goto("/dry/content-types/");
  await page.getByRole("button", { name: "Add" }).click();

  const addDialog = page.getByRole("dialog", { name: "Add collection" });
  await addDialog.getByLabel("Table Name*", { exact: true }).fill(`E2E Paste ${Date.now()}`);
  await addDialog.getByLabel(/^Slug/).check();
  const tableName = await addDialog.getByLabel("Table", { exact: true }).inputValue();

  await addDialog.getByRole("button", { name: "Add Field" }).click();
  const fieldDialog = page.getByRole("dialog", { name: "Add field" });
  await fieldDialog.getByRole("button", { name: "Select…" }).click();
  await page.getByRole("option", { name: "RichText", exact: true }).click();
  await fieldDialog.getByLabel("Label*", { exact: true }).fill("Body");
  await fieldDialog.getByLabel("Name", { exact: true }).fill("body");
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

test.describe("RichText pasted content", () => {
  test("cleans pasted styles, uploads a pasted image into Entry, and replaces its blob URL", async ({ page }) => {
    const tableName = await createSluggedCollectionWithRichText(page);
    await page.goto(`/dry/content/${tableName}/new`);

    const editor = page.locator(".richtext-content-host .dry-tx-content");
    await expect(editor).toBeVisible();

    await editor.evaluate((element) => {
      const data = new DataTransfer();
      data.setData(
        "text/html",
        '<p style="font-family: serif; margin: 40px; text-align: center"><span style="font-size: 42px; background-color: yellow; color: red; font-weight: normal">Pasted text</span></p>',
      );
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    });

    const pastedParagraph = editor.locator("p", { hasText: "Pasted text" });
    await expect(pastedParagraph).toBeVisible();
    const pastedText = pastedParagraph.locator("span", { hasText: "Pasted text" });
    await expect(pastedText).toHaveAttribute("style", /color:\s*red/);
    const cleanedStyle = await pastedText.getAttribute("style");
    expect(cleanedStyle).not.toMatch(/font-size|font-family|background|margin|font-weight/);

    const filename = `pasted-${Date.now()}.png`;
    await editor.evaluate((element, name) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    }, filename);

    const dialog = page.getByRole("dialog", { name: "Upload pasted image" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(filename);
    await dialog.getByRole("button", { name: "Upload" }).click();
    await expect(dialog).toBeHidden();

    // The whole point: the node's `src` is a real storage path under this
    // admin's staging folder for the not-yet-saved entry, never the local
    // blob URL the paste started as.
    const image = editor.locator(`img[alt="${filename}"]`);
    await expect(image).toHaveAttribute(
      "src",
      new RegExp(`/dry/api/storage/\\.tmp\\.${tableName}\\.[^/]+/${filename}$`),
    );

    const stored = await page.evaluate(
      async ({ table, name }) => {
        const response = await fetch(`/dry/api/storage/.tmp.${table}.e2e-admin-example-test`);
        if (!response.ok) return [];
        const body = (await response.json()) as { entries: { name: string }[] };
        return body.entries.map((entry) => entry.name);
      },
      { table: tableName, name: filename },
    );
    expect(stored).toContain(filename);
  });
});
