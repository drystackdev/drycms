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
    // `expect.poll` instead of a fixed wait + single snapshot - the worker
    // round-trip this depends on doesn't have a fixed latency (varies with
    // system/CPU load, e.g. under parallel Playwright workers), so a single
    // timed check is inherently racy where polling isn't.
    await expect
      .poll(async () => (await page.locator(".pce-ac-row").allTextContents()).some((row) => row.includes("number")))
      .toBe(true);

    await textarea.fill("");
    await textarea.type("cons");
    await expect
      .poll(async () => (await page.locator(".pce-ac-row").allTextContents()).some((row) => row.includes("const")))
      .toBe(true);
    const consRows = await page.locator(".pce-ac-row").allTextContents();
    expect(consRows.some((row) => row.includes("console"))).toBe(true);
  });

  test("completions still work after a completed string literal earlier in the file", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    const textarea = page.locator(".pce-textarea");

    // Regression guard: `wordStart`'s old "nearest preceding quote with no quote chars
    // after it" check couldn't tell an actually-open string apart from an already-closed
    // one earlier in the file with nothing but non-quote characters since - any import
    // statement (or any other string literal) before the cursor silently broke every
    // completion query for the rest of the file, since the computed replacement range
    // (and therefore the fuzzy-match query) pointed at garbage starting mid-string.
    await textarea.fill("");
    await textarea.type('import {useState} from "preact/hooks";\n\nexport default function () {\n  const [] = useS');
    await expect
      .poll(async () => (await page.locator(".pce-ac-row").allTextContents()).some((row) => row.includes("useState")))
      .toBe(true);
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
    await expect
      .poll(async () => (await page.locator(".pce-ac-row").allTextContents()).some((row) => row.includes("preact/hooks")))
      .toBe(true);

    await page.reload();
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.locator(".pce-textarea").fill("");
    await page.locator(".pce-textarea").type('import Button from "./B');
    await expect
      .poll(async () => (await page.locator(".pce-ac-row").allTextContents()).some((row) => row.includes("./Button.tsx")))
      .toBe(true);
  });

  test("applying a quick fix doesn't wipe the rest of the undo history", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.locator(".pce-textarea").click();
    await page.keyboard.type("\nuseEffect(() => {}, []);");
    await page.waitForTimeout(1200);

    const underline = page.locator(".editer-diagnostic-error").first();
    await expect(underline).toHaveCount(1);
    const box = await underline.boundingBox();
    if (box) await page.mouse.click(box.x + 2, box.y + 1);
    const menu = page.locator(".editer-quickfix-menu");
    await expect(menu).toBeVisible();

    // Regression guard: `commitEdits` used to apply fixes via `editor.setOptions({value})`,
    // which `basicEditor`'s `editHistory` extension treats as "a whole new document" and
    // collapses the *entire* undo stack to one entry - not one new undo step, every prior
    // one gone. `insertText` (from `prism-code-editor/utils`) goes through the real
    // `beforeinput`/`input` pipeline instead, so undo/redo keeps working normally.
    await menu.getByText("import", { exact: false }).first().click();
    await page.waitForTimeout(700);
    const afterFix = (await page.locator(".pce-line").allTextContents()).join("\n");
    expect(afterFix).toMatch(/import \{[^}]*useEffect/);

    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(400);
    const afterOneUndo = (await page.locator(".pce-line").allTextContents()).join("\n");
    // Still has the typed call - one undo didn't jump past it to some fully-collapsed state.
    expect(afterOneUndo).toContain("useEffect(() => {}, [])");

    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(300);
    const afterTwoUndos = (await page.locator(".pce-line").allTextContents()).join("\n");
    // A second undo keeps making incremental progress instead of being a no-op - the
    // stack wasn't collapsed down to a single (post-fix) entry.
    expect(afterTwoUndos).not.toBe(afterOneUndo);
  });

  test("readOnly (toggled via the demo's own checkbox) blocks edits but keeps hover", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);

    await page.locator("#code-editer-readonly").check();
    await page.waitForTimeout(500);
    await expect(page.locator(".pce-textarea")).toHaveAttribute("aria-readonly", "true");

    const before = (await page.locator(".pce-line").allTextContents()).join("\n");
    await page.locator(".pce-textarea").click();
    await page.keyboard.type("nope");
    await page.waitForTimeout(400);
    const after = (await page.locator(".pce-line").allTextContents()).join("\n");
    expect(after).toBe(before);

    // Diagnostics/hover stay active in read-only mode - only editing is disabled.
    const token = page.locator(".pce-line span", { hasText: /^useState$/ }).first();
    const box = await token.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(900);
    await expect(page.locator(".editer-hover-panel")).toHaveCSS("display", "block");

    await page.locator("#code-editer-readonly").uncheck();
    await page.waitForTimeout(500);
    await expect(page.locator(".pce-textarea")).toHaveAttribute("aria-readonly", "false");
    await page.locator(".pce-textarea").click();
    await page.keyboard.type("yep");
    await page.waitForTimeout(400);
    const afterUncheck = (await page.locator(".pce-line").allTextContents()).join("\n");
    expect(afterUncheck).toContain("yep");
  });

  test("diagnostics live region announces error/warning counts for screen readers", async ({ page }) => {
    await page.goto("/dry/code-editer-demo");
    await page.waitForSelector(".prism-code-editor", { timeout: 15000 });
    await page.waitForTimeout(500);
    const liveRegion = page.locator(".editer-sr-only");
    await expect(liveRegion).toHaveAttribute("aria-live", "polite");
    await expect(liveRegion).toHaveText("No problems");

    await page.locator(".pce-textarea").click();
    await page.keyboard.type("\nmath.random();");
    await page.waitForTimeout(900);
    await expect(liveRegion).not.toHaveText("No problems");
    await expect(liveRegion).toContainText(/error|warning/);
  });
});
