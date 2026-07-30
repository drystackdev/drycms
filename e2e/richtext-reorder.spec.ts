import { expect, test } from "@playwright/test";

/** Covers the RichText "reorder mode" feature (RichTextField/reorder-mode.ts)
 * end-to-end against the "Rich Text Demo" sandbox page: the toggle's chrome
 * (gray background + handle on every block, an extra outline on grid/table
 * containers), every other control (and typing itself) suspended while it's
 * on, a real pointer-drag actually committing a new block order (not just
 * previewing one), dropping into a grid cell, and toggling back off restoring
 * normal editing. Asserts on computed styles/classes rather than just
 * screenshots, same established convention `richtext-grid.spec.ts` already
 * uses. */
test("reorder mode toggle: chrome, suspended editing, and a real drag actually reorders", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // Taller than Playwright's default 1280x720 - the drag below needs both
  // the dragged handle and its drop target visible (and painted) at once,
  // and `elementFromPoint` (reorder-mode.ts's `computeDropTarget`) returns
  // nothing for a point that's below the fold, even though `boundingBox()`
  // still reports its geometrically-correct-but-not-yet-scrolled-into-view
  // position.
  await page.setViewportSize({ width: 1280, height: 1400 });

  await page.goto("/dry/richtext-demo");
  const content = page.locator(".richtext-content-mount").first();
  await expect(content).toBeVisible();

  await page.getByRole("button", { name: "Headings + quote" }).click();
  const h2 = content.locator("h2", { hasText: "Heading two" });
  const h4 = content.locator("h4", { hasText: "Heading four" });
  await expect(h2).toBeVisible();

  const toggle = page.getByRole("button", { name: "Reorder blocks" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Off: no reorder chrome, and every plain block is a normal, editable node.
  await expect(content.locator(".dry-tx-reorder-block")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Every block-level node gets the gray-background/handle chrome.
  const blocks = content.locator(".dry-tx-reorder-block");
  await expect(blocks).toHaveCount(5); // h2, h3, h4, blockquote, trailing paragraph
  await expect(content.locator(".dry-tx-reorder-handle")).toHaveCount(5);

  // Every other toolbar control (undo, bold, block-type, ...) is suspended -
  // the toggle button itself stays the one exception.
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Bold" })).toBeDisabled();
  await expect(toggle).toBeEnabled();

  // Typing is a hard no-op while active - `editable` reads `isReorderActive`.
  await h2.click();
  await page.keyboard.type("SHOULD_NOT_APPEAR");
  await expect(h2).toHaveText("Heading two");

  // Drag h2's own handle down past h4 - drop target is decided by pointer Y
  // vs. the hovered sibling's own vertical midpoint (`computeDropTarget` in
  // reorder-mode.ts), so landing near h4's bottom edge means "after h4".
  const handle = h2.locator(".dry-tx-reorder-handle");
  const handleBox = await handle.boundingBox();
  const targetBox = await h4.boundingBox();
  if (!handleBox || !targetBox) throw new Error("missing bounding box for drag handle or drop target");

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await expect(h2).toHaveClass(/dry-tx-reorder-dragging/);
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.85, { steps: 10 });
  // The hovered drop target gets its own highlight class while the drag is live.
  await expect(h4).toHaveClass(/dry-tx-reorder-drop-after/);
  await page.mouse.up();

  // h2 actually moved - now the 3rd top-level child, right after h4.
  const topLevel = content.locator(".dry-tx-content > *");
  await expect(topLevel.nth(0)).toHaveText("Heading three");
  await expect(topLevel.nth(1)).toHaveText("Heading four");
  await expect(topLevel.nth(2)).toHaveText("Heading two");

  // No stray "dragging"/"selected" chrome left behind on anything once the
  // move has committed.
  await expect(content.locator(".dry-tx-reorder-dragging")).toHaveCount(0);
  await expect(content.locator(".dry-tx-reorder-selected")).toHaveCount(0);

  // Toggling off removes every bit of reorder chrome and restores editing.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(content.locator(".dry-tx-reorder-block")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bold" })).toBeEnabled();

  await h2.click();
  await page.keyboard.type("X");
  await expect(h2).toContainText("X");

  const realErrors = consoleErrors.filter((msg) => !msg.includes("Outdated Optimize Dep"));
  expect(realErrors).toEqual([]);
});

/** Covers dropping into a grid's own cell specifically - the schema's one
 * cardinality-1 container (`grid_item.content = "block"`), where landing on
 * an *occupied* cell must append a new sibling cell rather than trying to
 * replace/merge into it (see `computeDropTarget`'s own doc comment in
 * reorder-mode.ts), and the container itself gets the extra outline class
 * plain blocks don't. */
test("reorder mode: grid/table containers get the extra outline, and dropping onto an occupied cell adds a new sibling cell", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/dry/richtext-demo");
  const content = page.locator(".richtext-content-mount").first();

  await page.getByRole("button", { name: "Plain paragraph" }).click();
  const paragraph = content.locator("p").first();
  await paragraph.click();
  await page.keyboard.type("dragged paragraph");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Insert grid" }).click();
  const grid = content.locator("div.dry-tx-grid");
  await expect(grid).toHaveCount(1);
  const gridItem = grid.locator(":scope > div.dry-tx-grid-item").first();
  await gridItem.locator("p").click();
  await page.keyboard.type("existing cell content");

  const toggle = page.getByRole("button", { name: "Reorder blocks" });
  await toggle.click();

  // Both container types (only the grid exists on this doc, but the class
  // itself is shared) get the outline on top of the plain gray background.
  await expect(grid).toHaveClass(/dry-tx-reorder-container/);
  await expect(grid).toHaveClass(/dry-tx-reorder-block/);
  // The grid_item cell itself isn't a `group:"block"` node - no handle of
  // its own, only its enclosing grid does.
  await expect(gridItem.locator(":scope > .dry-tx-reorder-handle")).toHaveCount(0);

  const draggedParagraph = content.locator("p", { hasText: "dragged paragraph" });
  const handle = draggedParagraph.locator(".dry-tx-reorder-handle");
  const handleBox = await handle.boundingBox();
  const cellBox = await gridItem.boundingBox();
  if (!handleBox || !cellBox) throw new Error("missing bounding box for drag handle or grid cell");

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, { steps: 10 });
  // Dropping onto the occupied cell highlights the whole grid_item, not a
  // before/after edge on some sibling paragraph.
  await expect(gridItem).toHaveClass(/dry-tx-reorder-drop-target/);
  await page.mouse.up();

  const items = grid.locator(":scope > div.dry-tx-grid-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("existing cell content");
  await expect(items.nth(1)).toContainText("dragged paragraph");

  const realErrors = consoleErrors.filter((msg) => !msg.includes("Outdated Optimize Dep"));
  expect(realErrors).toEqual([]);
});
