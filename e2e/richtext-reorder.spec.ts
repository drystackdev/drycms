import { expect, test } from "@playwright/test";

/** Covers the RichText "reorder mode" feature (RichTextField/reorder-mode.ts)
 * end-to-end against the "Rich Text Demo" sandbox page: the toggle's chrome
 * (gray background on every block, an extra outline only on grid/table/
 * children-component containers - no drag handle, every block is dragged by
 * a pointerdown anywhere on itself), every other control (and typing itself)
 * suspended while it's on, a real pointer-drag on a plain block actually
 * committing a new block order (not just previewing one), dropping into a
 * grid cell, and toggling back off restoring normal editing. Asserts on
 * computed styles/classes rather than just screenshots, same established
 * convention `richtext-grid.spec.ts` already uses.
 *
 * Every element lookup here goes through `body` (`.dry-tx-content`), not
 * `content` (`.richtext-content-mount`) directly - `buildDragOverlay`
 * appends its floating clone as a SIBLING of `.dry-tx-content`, inside the
 * same shadow root, and Playwright's locators pierce shadow roots by
 * default, so a bare `content.locator("h2", ...)` while a drag is live
 * matches both the real element AND the overlay's clone of it. Scoping to
 * `.dry-tx-content` excludes that sibling entirely. */
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
  const body = content.locator(".dry-tx-content");

  await page.getByRole("button", { name: "Headings + quote" }).click();
  const h2 = body.locator("h2", { hasText: "Heading two" });
  const h4 = body.locator("h4", { hasText: "Heading four" });
  await expect(h2).toBeVisible();

  const toggle = page.getByRole("button", { name: "Reorder blocks" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Off: no reorder chrome, and every plain block is a normal, editable node.
  await expect(body.locator(".dry-tx-reorder-block")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Every block-level node gets the gray-background chrome - this preset's
  // trailing paragraph has real text, not an empty landing-spot filler
  // (`dry-tx-reorder-hidden` covers that case, see the "Insert grid" test
  // below), so it's included in this count same as everything else.
  const blocks = body.locator(".dry-tx-reorder-block");
  await expect(blocks).toHaveCount(5); // h2, h3, h4, blockquote, trailing paragraph
  await expect(body.locator(".dry-tx-reorder-hidden")).toHaveCount(0);
  await expect(body.locator(".dry-tx-reorder-handle")).toHaveCount(0);

  // Every other toolbar control (undo, bold, block-type, ...) is suspended -
  // the toggle button itself stays the one exception.
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Bold" })).toBeDisabled();
  await expect(toggle).toBeEnabled();

  // Typing is a hard no-op while active - `editable` reads `isReorderActive`.
  await h2.click();
  await page.keyboard.type("SHOULD_NOT_APPEAR");
  await expect(h2).toHaveText("Heading two");

  // Drag h2 down past h4 by pressing on the block itself - h2 is a plain,
  // non-container block, so it has no handle of its own; the whole block IS
  // the handle (`onBlockPointerDown` in reorder-mode.ts). Drop target is
  // decided by pointer Y vs. the hovered sibling's own vertical midpoint
  // (`computeDropTarget`), so landing near h4's bottom edge means "after h4".
  const h2Box = await h2.boundingBox();
  if (!h2Box) throw new Error("missing bounding box for dragged block");

  await page.mouse.move(h2Box.x + h2Box.width / 2, h2Box.y + h2Box.height / 2);
  await page.mouse.down();
  await expect(h2).toHaveClass(/dry-tx-reorder-dragging/);
  // Measured AFTER mouse.down() - a floating clone of h2 now tracks the
  // pointer (`dry-tx-reorder-overlay`), but a stale box could still be
  // wrong once a `before`/`after` gap opens up elsewhere on the page.
  const targetBox = await h4.boundingBox();
  if (!targetBox) throw new Error("missing bounding box for drop target");
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.85, { steps: 1 });
  // The hovered drop target gets its own highlight class while the drag is live.
  await expect(h4).toHaveClass(/dry-tx-reorder-drop-after/);
  await page.mouse.up();

  // h2 actually moved - now the 3rd top-level child, right after h4.
  const topLevel = body.locator(":scope > *");
  await expect(topLevel.nth(0)).toHaveText("Heading three");
  await expect(topLevel.nth(1)).toHaveText("Heading four");
  await expect(topLevel.nth(2)).toHaveText("Heading two");

  // No stray "dragging"/"selected" chrome left behind on anything once the
  // move has committed, and the floating overlay is gone too.
  await expect(body.locator(".dry-tx-reorder-dragging")).toHaveCount(0);
  await expect(body.locator(".dry-tx-reorder-selected")).toHaveCount(0);
  await expect(content.locator(".dry-tx-reorder-overlay")).toHaveCount(0);

  // Toggling off removes every bit of reorder chrome and restores editing.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(body.locator(".dry-tx-reorder-block")).toHaveCount(0);
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
 * reorder-mode.ts), and the container itself (unlike a plain block) gets the
 * extra outline class. */
test("reorder mode: grid/table containers get the extra outline, and dropping onto an occupied cell adds a new sibling cell", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // Same reasoning as the taller viewport in the test above - reorder mode's
  // per-block padding/border/margin pushes the grid below Playwright's
  // default 720px fold, where `elementFromPoint` (`computeDropTarget`) sees
  // nothing at all.
  await page.setViewportSize({ width: 1280, height: 1400 });

  await page.goto("/dry/richtext-demo");
  const content = page.locator(".richtext-content-mount").first();
  const body = content.locator(".dry-tx-content");

  await page.getByRole("button", { name: "Plain paragraph" }).click();
  const paragraph = body.locator("p").first();
  await paragraph.click();
  await page.keyboard.type("dragged paragraph");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Insert grid" }).click();
  const grid = body.locator("div.dry-tx-grid");
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

  // The dragged paragraph is a plain block - pressing down anywhere on it
  // starts the drag, there's no separate handle for anything, container or
  // not (`onBlockPointerDown` in reorder-mode.ts).
  const draggedParagraph = body.locator("p", { hasText: "dragged paragraph" });
  const paragraphBox = await draggedParagraph.boundingBox();
  if (!paragraphBox) throw new Error("missing bounding box for dragged paragraph");

  await page.mouse.move(paragraphBox.x + paragraphBox.width / 2, paragraphBox.y + paragraphBox.height / 2);
  await page.mouse.down();
  // Measured AFTER mouse.down() - a floating clone of the dragged paragraph
  // now tracks the pointer, and any `before`/`after` gap opening elsewhere
  // could shift the grid, so a box measured beforehand could be stale.
  const cellBox = await gridItem.boundingBox();
  if (!cellBox) throw new Error("missing bounding box for grid cell");
  await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, { steps: 1 });
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

/** Covers the 3-way mode selector (`reorder-mode-menu.tsx`) added alongside
 * the handle removal above: it only exists while reorder mode is active and
 * defaults to "Block"; "Container" mode still lets a top-level block reorder
 * among its top-level siblings but rejects a drop INTO the grid's cell
 * (`computeDropTarget`'s `mode === "container"` scope filter in
 * reorder-mode.ts); "Nested container" mode leaves a plain block alone
 * entirely (no drag starts) while a real container (the grid) still drags
 * normally. Also covers the trailing landing-spot paragraph `insertGrid`
 * leaves after itself when it lands last in the doc - reorder mode hides it
 * rather than showing it as just another empty card. */
test("reorder mode: the block/container/nested-container mode selector", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto("/dry/richtext-demo");
  const content = page.locator(".richtext-content-mount").first();
  await expect(content).toBeVisible();
  const body = content.locator(".dry-tx-content");

  await page.getByRole("button", { name: "Plain paragraph" }).click();
  const paragraph = body.locator("p").first();
  await paragraph.click();
  await page.keyboard.type("top level paragraph");
  await page.keyboard.press("Enter");

  // Inserted with the cursor sitting in the trailing empty paragraph the
  // "Enter" above created - `insertGrid` consumes it and, since the grid
  // lands last in the doc either way, adds a fresh one after itself so
  // there's still somewhere to land the cursor (see its own doc comment).
  await page.getByRole("button", { name: "Insert grid" }).click();
  const grid = body.locator("div.dry-tx-grid");
  await expect(grid).toHaveCount(1);
  const gridItem = grid.locator(":scope > div.dry-tx-grid-item").first();
  await gridItem.locator("p").click();
  await page.keyboard.type("cell content");

  const toggle = page.getByRole("button", { name: "Reorder blocks" });
  await toggle.click();

  // The trailing landing-spot paragraph is hidden, not shown as a card.
  await expect(body.locator(".dry-tx-reorder-hidden")).toHaveCount(1);

  const blockModeBtn = page.getByRole("radio", { name: "Block" });
  const containerModeBtn = page.getByRole("radio", { name: "Container", exact: true });
  const nestedModeBtn = page.getByRole("radio", { name: "Nested container" });
  await expect(blockModeBtn).toHaveAttribute("aria-checked", "true");

  // --- "container" mode: the top-level paragraph can no longer be dropped
  // INTO the grid's cell (a different scope) - the drag just finds no valid
  // target and cancels, doc unchanged.
  await containerModeBtn.click();
  await expect(containerModeBtn).toHaveAttribute("aria-checked", "true");

  const draggedParagraph = body.locator("p", { hasText: "top level paragraph" });
  const paragraphBox = await draggedParagraph.boundingBox();
  if (!paragraphBox) throw new Error("missing bounding box for dragged paragraph");

  await page.mouse.move(paragraphBox.x + paragraphBox.width / 2, paragraphBox.y + paragraphBox.height / 2);
  await page.mouse.down();
  // Measured AFTER mouse.down(), same staleness reasoning as elsewhere in
  // this file.
  const cellBox = await gridItem.boundingBox();
  if (!cellBox) throw new Error("missing bounding box for grid cell");
  await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, { steps: 1 });
  await expect(gridItem).not.toHaveClass(/dry-tx-reorder-drop-target/);
  await expect(body.locator(".dry-tx-reorder-drop-before, .dry-tx-reorder-drop-after")).toHaveCount(0);
  await page.mouse.up();
  await expect(grid.locator(":scope > div.dry-tx-grid-item")).toHaveCount(1);

  // --- "nested-container" mode: a plain block is frozen - a pointerdown on
  // it never starts a drag at all - but the grid, a real container, still
  // drags normally.
  await nestedModeBtn.click();
  await expect(nestedModeBtn).toHaveAttribute("aria-checked", "true");
  await expect(draggedParagraph).toHaveClass(/dry-tx-reorder-frozen/);

  await page.mouse.move(paragraphBox.x + paragraphBox.width / 2, paragraphBox.y + paragraphBox.height / 2);
  await page.mouse.down();
  await expect(draggedParagraph).not.toHaveClass(/dry-tx-reorder-dragging/);
  await page.mouse.up();

  await expect(grid).not.toHaveClass(/dry-tx-reorder-frozen/);
  const gridBox = await grid.boundingBox();
  if (!gridBox) throw new Error("missing grid bounding box");
  // A couple px into the grid's own border/padding, clear of its one cell's
  // content - lands on the grid element itself, not a descendant.
  await page.mouse.move(gridBox.x + 3, gridBox.y + 3);
  await page.mouse.down();
  await expect(grid).toHaveClass(/dry-tx-reorder-dragging/);
  await page.mouse.up();

  const realErrors = consoleErrors.filter((msg) => !msg.includes("Outdated Optimize Dep"));
  expect(realErrors).toEqual([]);
});

/** Covers deleting the current reorder-mode selection
 * (`deleteSelectedBlocks` in reorder-mode.ts) both ways it's reachable: the
 * "Delete selected" toolbar button (`reorder-mode-menu.tsx`, disabled with
 * nothing selected) and the Delete/Backspace key itself - the latter needs
 * `useRichTextEditor.ts`'s conditional `tabindex` (reorder mode turns off
 * `contenteditable`, which normally makes this div focusable by click) and
 * `onBlockPointerDown`'s own `view.dom.focus()` call to even be reachable. */
test("reorder mode: deleting the current selection via the toolbar button and the Delete key", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/dry/richtext-demo");
  const content = page.locator(".richtext-content-mount").first();
  await expect(content).toBeVisible();
  const body = content.locator(".dry-tx-content");

  await page.getByRole("button", { name: "Headings + quote" }).click();
  const toggle = page.getByRole("button", { name: "Reorder blocks" });
  await toggle.click();

  const deleteBtn = page.getByRole("button", { name: "Delete selected" });
  await expect(deleteBtn).toBeDisabled();

  const h3 = body.locator("h3", { hasText: "Heading three" });
  await h3.click({ modifiers: ["Meta"] });
  await expect(h3).toHaveClass(/dry-tx-reorder-selected/);
  await expect(deleteBtn).toBeEnabled();
  await deleteBtn.click();
  await expect(body.locator("h3")).toHaveCount(0);
  await expect(deleteBtn).toBeDisabled();

  const h4 = body.locator("h4", { hasText: "Heading four" });
  await h4.click({ modifiers: ["Meta"] });
  await page.keyboard.press("Delete");
  await expect(body.locator("h4")).toHaveCount(0);

  const realErrors = consoleErrors.filter((msg) => !msg.includes("Outdated Optimize Dep"));
  expect(realErrors).toEqual([]);
});

/** Covers the other two changes from the same pass as the mode selector
 * above: a floating clone of the dragged block tracks the pointer
 * (`.dry-tx-reorder-overlay`, `buildDragOverlay` in reorder-mode.ts) while
 * its original spot is hidden outright (`.dry-tx-reorder-dragging`,
 * `display: none`); and dropping onto a table cell whose only content is
 * the empty placeholder `table.ts` seeds replaces that placeholder outright
 * (`"replaceCellContent"`) instead of leaving it behind as a second,
 * pointless empty block. */
test("reorder mode: dragging hides the dragged block behind a floating clone; dropping replaces a cell's empty placeholder", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto("/dry/richtext-demo");
  const content = page.locator(".richtext-content-mount").first();
  await expect(content).toBeVisible();
  const body = content.locator(".dry-tx-content");

  await page.getByRole("button", { name: "Headings + quote" }).click();
  const toggle = page.getByRole("button", { name: "Reorder blocks" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const h2 = body.locator("h2", { hasText: "Heading two" });
  const h3 = body.locator("h3", { hasText: "Heading three" });
  await expect(h2).toHaveClass(/dry-tx-reorder-block/);
  const h2Box = await h2.boundingBox();
  if (!h2Box) throw new Error("missing bounding box");

  await page.mouse.move(h2Box.x + h2Box.width / 2, h2Box.y + h2Box.height / 2);
  await page.mouse.down();
  await expect(h2).toHaveClass(/dry-tx-reorder-dragging/);
  // h2 itself is hidden outright - a floating clone with the real text now
  // tracks the pointer instead, appended as a sibling of `body`
  // (`.dry-tx-content`), which is why this one lookup goes through
  // `content` rather than `body`.
  await expect(h2).toHaveCSS("display", "none");
  const overlay = content.locator(".dry-tx-reorder-overlay");
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toContainText("Heading two");

  const h3Box = await h3.boundingBox();
  if (!h3Box) throw new Error("missing bounding box for h3");
  await page.mouse.move(h3Box.x + h3Box.width / 2, h3Box.y + h3Box.height * 0.1, { steps: 1 });
  await expect(h3).toHaveClass(/dry-tx-reorder-drop-before/);
  await page.mouse.up();

  // The actual reorder-on-drop commit path (`commitReorderMove`) is the
  // same one the first test in this file already exercises end to end -
  // this test's own job is the new chrome above (hidden dragged block,
  // matching gap) and the cell-replace behavior below, not re-proving that.
  await expect(body.locator(".dry-tx-reorder-dragging")).toHaveCount(0);
  await expect(content.locator(".dry-tx-reorder-overlay")).toHaveCount(0);
  await toggle.click(); // off

  // --- table cell empty-placeholder replacement
  await page.getByRole("button", { name: "Plain paragraph" }).click();
  const paragraph = body.locator("p").first();
  await paragraph.click({ clickCount: 3 });
  await page.keyboard.type("dragged paragraph");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Insert table" }).click();
  await page.locator(".richtext-table-grid-cell").nth(0).click();
  const table = body.locator("table");
  await expect(table).toHaveCount(1);
  const cell = table.locator("td, th").first();
  await expect(cell.locator("p")).toHaveText("");

  await toggle.click();
  const draggedParagraph = body.locator("p", { hasText: "dragged paragraph" });
  const draggedBox = await draggedParagraph.boundingBox();
  if (!draggedBox) throw new Error("missing dragged paragraph bounding box");
  await page.mouse.move(draggedBox.x + draggedBox.width / 2, draggedBox.y + draggedBox.height / 2);
  await page.mouse.down();

  // Measured AFTER mouse.down(), and moved to in a single jump rather than
  // an interpolated multi-step sweep - each intermediate step along the way
  // would itself open its own margin gap, shifting the very target this is
  // heading toward before it gets there.
  const cellBox = await cell.boundingBox();
  if (!cellBox) throw new Error("missing cell bounding box");
  await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, { steps: 1 });
  await expect(cell.locator("p")).toHaveClass(/dry-tx-reorder-drop-target/);
  await page.mouse.up();

  await expect(cell.locator("p")).toHaveCount(1);
  await expect(cell.locator("p")).toHaveText("dragged paragraph");

  const realErrors = consoleErrors.filter((msg) => !msg.includes("Outdated Optimize Dep"));
  expect(realErrors).toEqual([]);
});
