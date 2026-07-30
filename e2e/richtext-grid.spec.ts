import { expect, test } from "@playwright/test";

/** Covers the RichText grid layout feature (RichTextField/grid.ts and
 * friends) end-to-end against the "Rich Text Demo" sandbox page: insert,
 * typing/Enter producing a new sibling cell rather than a nested paragraph,
 * the highlightLine toggle's chrome, drag-resize actually committing a new
 * `colSpan` (not just previewing it), and delete unwrapping content back
 * into plain flow. Asserts on computed styles/attributes rather than just
 * screenshots - this project's own established convention, and the only
 * way to catch the exact class of bug (an unset/wrong `grid-column` style
 * silently collapsing an item) that bit this feature's first, reverted
 * attempt and wouldn't show up in a type check or unit test. */
test("richtext grid layout feature works end-to-end", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/dry/richtext-demo");

  const content = page.locator(".richtext-content-mount").first();
  await expect(content).toBeVisible();

  const insertGridBtn = page.getByRole("button", { name: "Insert grid" });
  await expect(insertGridBtn).toBeVisible();
  await insertGridBtn.click();

  const grid = content.locator("div.dry-tx-grid");
  await expect(grid).toHaveCount(1);
  let items = grid.locator(":scope > div.dry-tx-grid-item");
  await expect(items).toHaveCount(1);

  // `insertGrid` defaults a freshly-inserted grid's own `highlightLine` to
  // on (see grid.ts's `GRID_INSERTED_META`/grid-resize.ts) - no toggle
  // click needed to see it right away.
  const highlightedGrid = content.locator("div.dry-tx-grid.dry-tx-grid-highlight");
  await expect(highlightedGrid).toHaveCount(1);

  // `insertGrid`'s `replaceSelectionWith` (same as `insertTable`) doesn't
  // land the selection inside the newly-inserted node's own content -
  // `selectedGrid`/the Grid menu card only appear once the user actually
  // clicks into the grid cell, so do that before checking for them.
  await items.first().locator("p").click();

  const highlightBtn = page.getByRole("button", { name: "Toggle highlight lines" });
  const deleteGridBtn = page.getByRole("button", { name: "Delete grid" });
  await expect(highlightBtn).toBeVisible();
  await expect(deleteGridBtn).toBeVisible();
  await expect(highlightBtn).toHaveAttribute("aria-pressed", "true");

  // The toggle button itself still works both ways - off, then back on.
  await highlightBtn.click();
  await expect(highlightedGrid).toHaveCount(0);
  await highlightBtn.click();
  await expect(highlightedGrid).toHaveCount(1);

  // Enter inside a grid cell must create a new sibling grid_item, not a
  // 2nd paragraph inside the same one (grid_item's content is exactly one
  // block - see splitGridItem's own doc comment in grid.ts).
  await page.keyboard.type("hello");
  await page.keyboard.press("Enter");
  await page.keyboard.type("world");
  items = grid.locator(":scope > div.dry-tx-grid-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator("p")).toHaveText("hello");
  await expect(items.nth(1).locator("p")).toHaveText("world");
  await expect(items.nth(0).locator("p")).toHaveCount(1);

  // Dashed outline on every highlighted cell, solid on the focused one -
  // both live on the `outline` property (never `border`), so switching
  // between them can't shift layout either way.
  const focusedItem = grid.locator(":scope > div.dry-tx-grid-item.dry-tx-grid-focused");
  await expect(focusedItem).toHaveCount(1);
  await expect(focusedItem).toHaveCSS("outline-style", "solid");
  const otherItem = grid.locator(":scope > div.dry-tx-grid-item:not(.dry-tx-grid-focused)");
  await expect(otherItem).toHaveCount(1);
  await expect(otherItem).toHaveCSS("outline-style", "dashed");

  const colHandle = focusedItem.locator(".dry-tx-grid-handle-col");
  const rowHandle = focusedItem.locator(".dry-tx-grid-handle-row");
  await expect(colHandle).toBeVisible();
  await expect(rowHandle).toBeVisible();

  // highlightLine is anchored to the grid itself, not to live selection -
  // clicking away to a paragraph outside the grid must NOT clear the
  // dashed-border chrome (though the focused item's own outline/handles,
  // which are selection-driven, do go away - nothing is "focused" once the
  // selection has actually left).
  const plainParagraph = content.locator("p", { hasText: "Just a plain paragraph" });
  await plainParagraph.click();
  await expect(highlightedGrid).toHaveCount(1);
  await expect(grid.locator(".dry-tx-grid-focused")).toHaveCount(0);
  await expect(grid.locator(".dry-tx-grid-handle-col:visible")).toHaveCount(0);

  // Clicking back into the grid re-shows the Grid menu card so it can be
  // toggled off again, and re-focuses that item's own handles.
  await items.first().locator("p").click();
  await expect(highlightBtn).toBeVisible();

  // Dragging the column handle must actually commit a new `colSpan` -
  // the exact CSS gotcha (an unchanged/collapsed `grid-column`) that only a
  // real browser render catches.
  // 4 columns (schema.ts's GRID_COLUMNS) - default full-width span.
  const styleBefore = await focusedItem.getAttribute("style");
  expect(styleBefore).toContain("grid-column:span 4");
  const handleBox = await colHandle.boundingBox();
  if (!handleBox) throw new Error("no bounding box for the column resize handle");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 150, handleBox.y + handleBox.height / 2, { steps: 10 });
  await page.mouse.up();
  const styleAfter = await focusedItem.getAttribute("style");
  expect(styleAfter).not.toBe(styleBefore);
  expect(styleAfter).not.toContain("grid-column:span 4");

  // Dragging the row handle must also visibly change the rendered box, not
  // just the committed attr - `rowSpan` has zero visual effect unless the
  // grid container gives its implicit row tracks a real minimum height
  // (`grid-auto-rows: minmax(...)`, not bare `auto` - see
  // `gridContainerStyleString`'s own doc comment in schema.ts for how an
  // earlier version of this passed the attr-only check while doing
  // nothing on screen).
  const heightBefore = (await focusedItem.boundingBox())?.height ?? 0;
  const rowHandleBox = await rowHandle.boundingBox();
  if (!rowHandleBox) throw new Error("no bounding box for the row resize handle");
  await page.mouse.move(rowHandleBox.x + rowHandleBox.width / 2, rowHandleBox.y + rowHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rowHandleBox.x + rowHandleBox.width / 2, rowHandleBox.y + 200, { steps: 10 });
  await page.mouse.up();
  const rowStyleAfter = await focusedItem.getAttribute("style");
  // Exact match, not `.toContain("grid-row:span 1")` - "span 10" contains
  // that substring too, a real false-negative this test hit once the row
  // unit shrank (schema.ts's `GRID_ROW_HEIGHT_REM`) and the same drag
  // distance started producing a 2-digit span.
  expect(rowStyleAfter).not.toMatch(/grid-row:span 1(?!\d)/);
  const heightAfter = (await focusedItem.boundingBox())?.height ?? 0;
  expect(heightAfter).toBeGreaterThan(heightBefore + 50);

  // The exported HTML (the demo page's own live "Output (HTML)" panel) has
  // no per-item wrapper div - each item's block carries its own span as a
  // plain inline style directly on its own tag, but only when it's not the
  // all-default span (the fixed <style> tag's own default + !important
  // mobile-override rule covers the rest).
  const htmlOutput = page.locator(".field", { has: page.getByText("Output (HTML)") }).locator("code");
  const exportedHtml = (await htmlOutput.textContent()) ?? "";
  expect(exportedHtml).toContain("<style>");
  expect(exportedHtml).not.toContain("dry-tx-grid-item");
  expect(exportedHtml).toContain('class="dry-tx-grid"');
  expect(exportedHtml).toContain("@media (width < 48rem)");
  expect(exportedHtml).toContain("!important");
  // "hello" was just resized off the default span (both axes) - its
  // exported tag carries the exact same inline style the live editor just
  // committed.
  expect(exportedHtml).toContain(`<p style="${rowStyleAfter}">hello</p>`);
  // "world" was never touched - still at the all-default span, so it gets
  // no inline style at all (the fixed default rule covers it instead).
  expect(exportedHtml).toContain("<p>world</p>");

  // Delete grid unwraps - content survives as plain paragraphs.
  await deleteGridBtn.click();
  await expect(content.locator("div.dry-tx-grid")).toHaveCount(0);
  await expect(content.locator("p", { hasText: "hello" })).toHaveCount(1);
  await expect(content.locator("p", { hasText: "world" })).toHaveCount(1);

  // Filters out Vite dev-mode's own "Outdated Optimize Dep" 504 noise - a
  // transient dep-reoptimization artifact of the dev server itself (fires
  // on the first request after any restart, regardless of page/feature),
  // not a real app error.
  const realErrors = consoleErrors.filter((msg) => !msg.includes("Outdated Optimize Dep"));
  expect(realErrors).toEqual([]);
});

/** A plain `replaceSelectionWith`-based insert (table, or another grid)
 * doesn't know `grid_item`'s content is exactly one block - left to its own
 * generic fitting logic, it escapes the grid entirely rather than landing
 * inside the cell the user actually clicked into (confirmed empirically
 * before `insertBlockAfterFocusedGridItem`, grid.ts, existed - it happened
 * for both an empty and a non-empty cell, and even escaped the whole
 * grid's own boundary, not just the cell's). Covers both branches of that
 * fix: an empty cell's own block is replaced in place, a non-empty one
 * gets a new sibling cell instead - plus that a grid nested inside another
 * grid's cell actually renders live with no errors. */
test("table and nested grid both land inside the focused cell, not escape it", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/dry/richtext-demo");
  const content = page.locator(".richtext-content-mount").first();

  // Empty cell: a table replaces its own (empty) paragraph directly - no
  // new cell needed.
  await page.getByRole("button", { name: "Insert grid" }).click();
  const grid = content.locator("div.dry-tx-grid").first();
  let items = grid.locator(":scope > div.dry-tx-grid-item");
  await items.first().locator("p").click();
  await page.getByRole("button", { name: "Insert table" }).click();
  await page.locator(".richtext-table-grid-cell").nth(0).click();
  await expect(items).toHaveCount(1);
  await expect(grid.locator(":scope > div.dry-tx-grid-item table")).toHaveCount(1);

  // Non-empty cell: typing first, then inserting a table, must leave that
  // text in its own cell and add the table as a new sibling cell instead
  // of overwriting it.
  await page.goto("/dry/richtext-demo");
  await page.getByRole("button", { name: "Insert grid" }).click();
  items = grid.locator(":scope > div.dry-tx-grid-item");
  await items.first().locator("p").click();
  await page.keyboard.type("existing text");
  await page.getByRole("button", { name: "Insert table" }).click();
  await page.locator(".richtext-table-grid-cell").nth(0).click();
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator("p")).toHaveText("existing text");
  await expect(items.nth(1).locator("table")).toHaveCount(1);

  // Nested grid: inserting a grid while already inside one lands a live,
  // rendered inner grid inside the (empty) outer cell.
  await page.goto("/dry/richtext-demo");
  await page.getByRole("button", { name: "Insert grid" }).click();
  await items.first().locator("p").click();
  const insertGridBtn = page.getByRole("button", { name: "Insert grid" });
  await expect(insertGridBtn).toBeEnabled();
  await insertGridBtn.click();
  await expect(content.locator("div.dry-tx-grid")).toHaveCount(2);
  await expect(content.locator("div.dry-tx-grid div.dry-tx-grid")).toHaveCount(1);

  const realErrors = consoleErrors.filter((msg) => !msg.includes("Outdated Optimize Dep"));
  expect(realErrors).toEqual([]);
});
