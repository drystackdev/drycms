import { expect, test } from "@playwright/test";

test.describe("Code editer demo", () => {
  test.setTimeout(60000);

  test("tabs switch the editor between files", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.getByRole("tab", { name: "Button.tsx" }).click();
    await page.waitForTimeout(800);
    const button = (await page.locator(".pce-line").allTextContents()).join("\n");
    await page.getByRole("tab", { name: "Demo.tsx" }).click();
    await page.waitForTimeout(800);
    const demo = (await page.locator(".pce-line").allTextContents()).join("\n");
    expect(button).toContain("function Button");
    expect(demo).toContain("function Demo");
  });

  test("hovering an identifier shows a styled Quick Info panel", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    const token = page.locator(".pce-line span", { hasText: /^useState$/ }).first();
    const box = await token.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(900);
    const panel = page.locator(".editer-hover-panel");
    await expect(panel).toHaveCSS("display", "block");
    // Regression guard: the panel used to be parented outside `.prism-code-editor` in the
    // shadow root, where the theme's `--pce-widget-*` custom properties don't reach it.
    const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    await expect(panel).toContainText("useState");
  });

  test("an unresolved name gets a squiggly underline and a working quick fix", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.locator(".pce-textarea").click();
    await page.keyboard.type("\nuseEffect(() => {}, []);");
    await page.waitForTimeout(900);

    const underline = page.locator(".editer-diagnostic-error").first();
    await expect(underline).toHaveCount(1);
    const maskSet = await underline.evaluate(
      (el) => (getComputedStyle(el).webkitMaskImage || getComputedStyle(el).maskImage) !== "none",
    );
    expect(maskSet).toBe(true);

    const box = await underline.boundingBox();
    if (box) await page.mouse.click(box.x + 2, box.y + 1);
    const menu = page.locator(".editer-quickfix-menu");
    await expect(menu).toBeVisible();
    // "Update import from ..." only surfaces with `includeCompletionsForModuleExports`
    // set in `getCodeFixesAtPosition`'s preferences - regression guard for that.
    await expect(menu).toContainText("import");

    await menu.getByText("import", { exact: false }).first().click();
    await page.waitForTimeout(600);
    const code = (await page.locator(".pce-line").allTextContents()).join("\n");
    expect(code).toContain("useEffect");
    expect(code).toMatch(/import \{[^}]*useEffect/);
  });

  test("signature help appears while typing a call's arguments", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.getByRole("tab", { name: "Button.tsx" }).click();
    await page.waitForTimeout(500);
    await page.locator(".pce-textarea").click();
    await page.keyboard.type("\nButton(");
    await page.waitForTimeout(800);
    const tooltip = page.locator(".editer-sig-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Button(");
  });

  test("Shift+Alt+F formats and Mod+F opens find & replace", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.locator(".pce-textarea").click();
    await page.keyboard.press("Home");
    await page.keyboard.type("   \n");
    await page.waitForTimeout(500);
    const before = (await page.locator(".pce-line").allTextContents()).join("\n");
    await page.keyboard.press("Shift+Alt+F");
    await page.waitForTimeout(800);
    const after = (await page.locator(".pce-line").allTextContents()).join("\n");
    expect(before).not.toBe(after);

    // `Control+F` doesn't reach "Mod+F" bindings on this Mac Playwright host - see
    // the project's other `Meta+`-vs-`Control+` notes for the same class of issue.
    await page.keyboard.press("Meta+f");
    await expect(page.locator(".prism-search")).toBeVisible();
  });

  test("completions include plain TS keywords (const, number, console)", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    const textarea = page.locator(".pce-textarea");

    // Regression guard: the worker used to truncate to the top 50 entries by symbol
    // kind/sortText *before* narrowing by the typed prefix, so for a broad scope (global,
    // thousands of candidates) common keywords like `const`/`number` could get silently
    // truncated away before the client ever got a chance to fuzzy-match them.
    await textarea.fill("");
    await textarea.type("let myValue: numb");
    await page.waitForTimeout(700);
    const numberRows = await page.locator(".pce-ac-row").allTextContents();
    expect(numberRows.some((row) => row.includes("number"))).toBe(true);

    await textarea.fill("");
    await textarea.type("cons");
    await page.waitForTimeout(700);
    const consRows = await page.locator(".pce-ac-row").allTextContents();
    expect(consRows.some((row) => row.includes("const"))).toBe(true);
    expect(consRows.some((row) => row.includes("console"))).toBe(true);
  });

  test("import specifiers get bare-module and relative-file completions", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    const textarea = page.locator(".pce-textarea");

    // Regression guard: TS's own module-specifier completions need a real `node_modules`/
    // directory listing to enumerate, which this virtual FS doesn't have - without the
    // dedicated `computeImportSpecifierCompletions` path, both of these returned nothing.
    await textarea.fill("");
    await textarea.type('import { useState } from "pre');
    await page.waitForTimeout(700);
    const bareRows = await page.locator(".pce-ac-row").allTextContents();
    expect(bareRows.some((row) => row.includes("preact/hooks"))).toBe(true);

    await page.reload();
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.locator(".pce-textarea").fill("");
    await page.locator(".pce-textarea").type('import Button from "./B');
    await page.waitForTimeout(700);
    const relativeRows = await page.locator(".pce-ac-row").allTextContents();
    expect(relativeRows.some((row) => row.includes("./Button.tsx"))).toBe(true);
  });
});
