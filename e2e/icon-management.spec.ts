import { expect, test } from "@playwright/test";

// Self-closing tags round-trip through `sanitizeSvg` with a space before
// `/>` (its own re-serialization, not a copy of whatever the input used) -
// written pre-normalized here so the edit-form-prefill assertion below can
// compare directly against what `iconsApi.get()` actually returns.
const TEST_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 7v13h20V7z" fill="currentColor" /></svg>';

test.describe("Icon Management", () => {
  test("sidebar nav links to the page, and it starts from an empty grid", async ({ page }) => {
    await page.goto("/dry/dashboard");
    await page.locator("nav a", { hasText: "Icon Management" }).click();
    await expect(page).toHaveURL(/\/dry\/icon-management$/);
    await expect(page.locator(".page-header h1")).toHaveText("Icon Management");
    await expect(page.getByRole("button", { name: "Add icon Manual" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add icon", exact: true })).toBeVisible();
  });

  test("add manual -> shows a live preview while typing -> appears in the grid -> preview dialog -> edit/rename -> delete", async ({
    page,
  }) => {
    // --- Add icon Manual ---
    await page.goto("/dry/icon-management/manual");
    await expect(page.locator(".page-header h1")).toHaveText("Add icon Manual");

    await page.getByLabel("Name").fill("E2E Test Icon");
    await page.getByLabel("SVG code").fill(TEST_SVG);

    // Live preview renders from the textarea content before Save is even clicked
    // - `IconGlyph` masks a `<span>` (for `currentColor` tinting), not an `<img>`.
    await expect(page.locator('[data-tooltip="Primary"] span')).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/dry\/icon-management$/);

    // --- Appears in the grid ---
    const cell = page.locator(".icon-grid .icon-cell", { hasText: "e2e-test-icon" });
    await expect(cell).toBeVisible();
    // Same `IconGlyph` span (mask-image), not an `<img src>` - the icon URL
    // shows up inside the `style` attribute's `mask: url(...)` instead.
    await expect(cell.locator("span").first()).toHaveAttribute("style", /\/api\/icons\/e2e-test-icon\.svg/);

    // --- Preview dialog ---
    await cell.click();
    const dialog = page.locator("dialog.icon-preview-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h3")).toHaveText("e2e-test-icon");
    // The copy-paste snippet is Iconify's own CSS-mask <i> technique, pointed at this icon's own storage URL.
    const codeText = await dialog.locator(".demo-code, pre").first().innerText();
    expect(codeText).toContain("<i");
    expect(codeText).toContain("mask:url");
    expect(codeText).toContain("e2e-test-icon.svg");

    // --- Edit -> rename ---
    await dialog.getByRole("button", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/dry\/icon-management\/manual\/e2e-test-icon\.svg$/);
    await expect(page.getByLabel("Name")).toHaveValue("e2e-test-icon");
    await expect(page.getByLabel("SVG code")).toHaveValue(TEST_SVG);

    await page.getByLabel("Name").fill("E2E Renamed Icon");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/dry\/icon-management$/);

    await expect(page.locator(".icon-grid .icon-cell", { hasText: "e2e-test-icon" })).toHaveCount(0);
    const renamedCell = page.locator(".icon-grid .icon-cell", { hasText: "e2e-renamed-icon" });
    await expect(renamedCell).toBeVisible();

    // --- Delete from the preview dialog ---
    await renamedCell.click();
    const dialog2 = page.locator("dialog.icon-preview-dialog");
    await dialog2.getByRole("button", { name: "Delete" }).click();
    // The confirm dialog is a separate <dialog>, scoped by its own aria-label
    // (ConfirmDialog's `title` prop) so this can't accidentally hit the
    // preview dialog's own (still-mounted) Delete trigger button.
    const confirmDialog = page.getByRole("dialog", { name: "Delete icon?" });
    await confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.locator(".icon-grid .icon-cell", { hasText: "e2e-renamed-icon" })).toHaveCount(0);
  });
});
