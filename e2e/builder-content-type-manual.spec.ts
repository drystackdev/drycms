import { expect, test, type Page } from "@playwright/test";

async function addTextField(page: Page, label: string): Promise<void> {
  const editor = page.locator("dialog.builder-editor-dialog");
  await editor.getByRole("button", { name: "Add Field" }).click();
  const fieldDialog = page.getByRole("dialog", { name: "Add field" });
  await fieldDialog.getByLabel("Label*", { exact: true }).fill(label);
  await fieldDialog.getByRole("button", { name: "Select…" }).click();
  await page.getByRole("option", { name: "Text", exact: true }).click();
  await fieldDialog.getByRole("button", { name: "Save field" }).click();
  await expect(fieldDialog).toBeHidden();
}

async function deleteContentType(page: Page, id: string): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(
    (contentTypeId) =>
      fetch(`/dry/api/content-types/${encodeURIComponent(contentTypeId)}`, {
        method: "DELETE",
      }),
    id,
  );
}

test.describe("Builder Content type manual workflow", () => {
  test("creates a draft, applies the schema, and manages a collection entry", async ({ page }) => {
    const label = `E2E Builder ${Date.now()}`;
    const fieldLabel = "Summary";
    let contentTypeId: string | undefined;

    try {
      await page.goto("/dry/content-types/");
      await page.getByRole("button", { name: "Add" }).click();

      const editor = page.locator("dialog.builder-editor-dialog");
      await expect(editor).toBeVisible();
      await editor.getByLabel("Table Name*", { exact: true }).fill(label);
      await addTextField(page, fieldLabel);
      await editor.locator(".builder-editor-footer").getByRole("button", { name: "Save draft" }).click();
      await expect(editor).toBeHidden();

      const applyBuilderButton = page.locator(".page-header").getByRole("button", { name: "Apply Builder" });
      await expect(applyBuilderButton).toBeEnabled();
      await applyBuilderButton.click();

      const applyDialog = page.getByRole("dialog", { name: "Apply and build" });
      await expect(applyDialog).toContainText(label);
      await applyDialog.getByRole("button", { name: "Confirm" }).click();
      await expect(applyDialog).toContainText("No conflicts found");
      await applyDialog.getByRole("button", { name: "Save" }).click();
      await expect(applyDialog).toBeHidden();

      // The list is a card grid now (`.builder-collection-card`), not a
      // table - "Collection" is already the default-selected kind, so no
      // `?selectedKind=` navigation is needed either.
      const card = page.locator(".builder-collection-card").filter({ hasText: label });
      await expect(card).toBeVisible();
      const applied = await page.evaluate(async (contentTypeLabel) => {
        const response = await fetch("/dry/api/content-types");
        const body = (await response.json()) as {
          definitions: Array<{ id: string; label: string; name: string }>;
        };
        const definition = body.definitions.find((item) => item.label === contentTypeLabel);
        if (!definition) throw new Error("Could not find the applied content type.");
        return { id: definition.id, name: definition.name };
      }, label);
      contentTypeId = applied.id;
      // A card opens the SAME dialog-based editor as "Add" (edit mode this
      // time) instead of navigating to a dedicated `/edit` URL.
      await card.click();
      const editDialog = page.getByRole("dialog", { name: "Edit collection" });
      await expect(editDialog).toBeVisible();
      await editDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(editDialog).toBeHidden();

      await page.goto(`/dry/content/${encodeURIComponent(applied.name)}/new`);
      await expect(page.getByLabel(fieldLabel, { exact: true })).toBeVisible();
      await page.getByLabel(fieldLabel, { exact: true }).fill("Manual entry");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForURL(new RegExp(`/dry/content/${applied.name}$`));

      const entryRow = page.getByRole("row", { name: /Manual entry/ });
      await expect(entryRow).toBeVisible();
      await entryRow.click();
      await page.waitForURL(/\/dry\/content\/[^/]+\/\d+/);
      await expect(page.getByLabel(fieldLabel, { exact: true })).toHaveValue("Manual entry");
      await page.getByRole("button", { name: "Delete entry" }).click();
      const deleteDialog = page.getByRole("dialog", { name: "Delete this entry?" });
      await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
      await page.waitForURL(/\/dry\/content\/[^/]+$/);
      await expect(page.getByText("No entries yet.")).toBeVisible();
    } finally {
      if (contentTypeId) await deleteContentType(page, contentTypeId);
    }
  });
});
