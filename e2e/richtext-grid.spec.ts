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

  // `insertGrid`'s `replaceSelectionWith` (same as `insertTable`) doesn't
  // land the selection inside the newly-inserted node's own content -
  // `selectedGrid`/the Grid menu card only appear once the user actually
  // clicks into the grid cell, so do that before checking for them.
  await items.first().locator("p").click();

  const highlightBtn = page.getByRole("button", { name: "Toggle highlight lines" });
  const deleteGridBtn = page.getByRole("button", { name: "Delete grid" });
  await expect(highlightBtn).toBeVisible();
  await expect(deleteGridBtn).toBeVisible();

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

  // highlightLine toggle - dashed border + both resize handles appear on
  // the focused cell.
  await highlightBtn.click();
  const focusedItem = grid.locator(":scope > div.dry-tx-grid-item.dry-tx-grid-focused");
  await expect(focusedItem).toHaveCount(1);
  await expect(focusedItem).toHaveCSS("border-style", "dashed");

  const colHandle = focusedItem.locator(".dry-tx-grid-handle-col");
  const rowHandle = focusedItem.locator(".dry-tx-grid-handle-row");
  await expect(colHandle).toBeVisible();
  await expect(rowHandle).toBeVisible();

  // Dragging the column handle must actually commit a new `colSpan` -
  // the exact CSS gotcha (an unchanged/collapsed `grid-column`) that only a
  // real browser render catches.
  const styleBefore = await focusedItem.getAttribute("style");
  expect(styleBefore).toContain("grid-column:span 12");
  const handleBox = await colHandle.boundingBox();
  if (!handleBox) throw new Error("no bounding box for the column resize handle");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 150, handleBox.y + handleBox.height / 2, { steps: 10 });
  await page.mouse.up();
  const styleAfter = await focusedItem.getAttribute("style");
  expect(styleAfter).not.toBe(styleBefore);
  expect(styleAfter).not.toContain("grid-column:span 12");

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
