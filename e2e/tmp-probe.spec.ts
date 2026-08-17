import { expect, test } from "@playwright/test";
import { codePanel, dock, expectPreviewText, fillEditor, openBuilder, readSource, writeSource } from "./page-builder-utils.js";

test.describe.configure({ timeout: 180_000 });

test("probe autosave -> publish affordances", async ({ page }) => {
  const original = "";
  try {
    await openBuilder(page, "/");
    await expectPreviewText(page, "Your drycms project starts here");
    const before = await readSource(page, "pages/page.tsx");
    console.log("ORIGINAL LENGTH", before.length);

    await fillEditor(codePanel(page), 'export default function HomePage() {\n  setTitle("Home");\n  return <main>E2E MARKER</main>;\n}\n');
    await page.waitForTimeout(3000);

    console.log("status:", (await codePanel(page).locator(".page-builder-code-panel-status").textContent())?.trim());
    console.log("discard disabled:", await codePanel(page).getByRole("button", { name: "Discard" }).isDisabled());
    console.log("build disabled:", await dock(page).getByRole("button", { name: "Build and publish" }).isDisabled());
    console.log("badge count:", await dock(page).locator(".dock-save-badge").count());
    console.log("stored:", JSON.stringify((await readSource(page, "pages/page.tsx")).slice(0, 60)));

    await writeSource(page, "pages/page.tsx", before);
  } finally {
    void original;
  }
});
