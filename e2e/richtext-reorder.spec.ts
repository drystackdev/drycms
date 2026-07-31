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
  // Switching the live hover target to a genuinely new spot is itself
  // debounced 250ms (`startReorderDrag`'s own `hoverDebounceTimer`) - waited
  // out explicitly here, since the assertion right below would otherwise
  // pass trivially even before it fires (h2's own origin ghost already
  // satisfies "exactly one ghost" on its own, so it doesn't prove anything
  // about h4 actually having been resolved as the new target) and
  // `mouse.up()` right after would commit the OLD target instead.
  await page.waitForTimeout(300);
  // Still just ONE ghost slot - h2's own resting spot and the hover target
  // near h4 are different POSITIONS, but the same top-level container, so
  // the origin ghost gets replaced rather than shown alongside the hover
  // one (see `ReorderDragging.originTarget`'s own doc comment in
  // reorder-mode.ts - only crossing into a genuinely different container
  // keeps both up at once).
  await expect(body.locator(".dry-tx-reorder-ghost")).toHaveCount(1);
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

/** Covers deleting the current reorder-mode selection
 * (`deleteSelectedBlocks` in reorder-mode.ts) via the Delete/Backspace key -
 * the keyboard path needs `useRichTextEditor.ts`'s conditional `tabindex`
 * (reorder mode turns off `contenteditable`, which normally makes this div
 * focusable by click) and `onBlockPointerDown`'s own `view.dom.focus()` call
 * to even be reachable - and exiting reorder mode is done via the main
 * toggle button itself (clicking it again while active). */
test("reorder mode: deleting the current selection via the Delete key, and exiting via the toggle button", async ({
  page,
}) => {
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

  const h3 = body.locator("h3", { hasText: "Heading three" });
  await h3.click({ modifiers: ["Meta"] });
  await expect(h3).toHaveClass(/dry-tx-reorder-selected/);
  // `onBlockPointerDown`'s own focus call is deferred a tick
  // (`win.setTimeout(..., 0)`, see its own doc comment in reorder-mode.ts) -
  // pressing Delete/Backspace before that macrotask actually runs would
  // land on whatever was focused beforehand instead (a toolbar button),
  // never reaching this field's own `handleDOMEvents.keydown` at all.
  await page.waitForTimeout(50);
  await page.keyboard.press("Delete");
  await expect(body.locator("h3")).toHaveCount(0);

  const h4 = body.locator("h4", { hasText: "Heading four" });
  await h4.click({ modifiers: ["Meta"] });
  await page.waitForTimeout(50);
  await page.keyboard.press("Backspace");
  await expect(body.locator("h4")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(body.locator(".dry-tx-reorder-block")).toHaveCount(0);

  const realErrors = consoleErrors.filter((msg) => !msg.includes("Outdated Optimize Dep"));
  expect(realErrors).toEqual([]);
});

/** Covers a floating clone of the dragged block tracking the pointer
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
  // A "ghost slot" widget marks the live drop target while the drag is live.
  await expect(body.locator(".dry-tx-reorder-ghost")).toHaveCount(1);
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

/** Covers the two-ghost case specifically: dragging from a top-level
 * position INTO a genuinely different container (here, hovering directly
 * over an EXISTING, non-empty paragraph inside a table cell - a plain
 * `"before"`/`"after"` target same as any other, just scoped to that cell
 * rather than the top level; landing on the cell's own padding, or an
 * empty placeholder paragraph, would resolve to a `"replaceCellContent"`/
 * outline-highlight target instead, which isn't a ghost-widget case at
 * all) keeps the origin ghost open at its own top-level resting spot while
 * a second ghost shows at the live hover target inside the cell - unlike
 * moving between two positions in the SAME container (the test above),
 * which only ever shows one. Dropping resolves both down to nothing at
 * once, since the whole drag ends in the same instant. */
test("reorder mode: dragging into a different container keeps both the origin and hover ghost slots up at once", async ({
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

  await page.getByRole("button", { name: "Plain paragraph" }).click();
  const paragraph = body.locator("p").first();
  // Triple-click to select the preset's own default text first - a plain
  // click only places the cursor, leaving that text in place for
  // "dragged paragraph" to land in the MIDDLE of instead of replacing it.
  await paragraph.click({ clickCount: 3 });
  await page.keyboard.type("dragged paragraph");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Insert table" }).click();
  await page.locator(".richtext-table-grid-cell").nth(0).click();
  const table = body.locator("table");
  const cell = table.locator("td, th").first();
  await cell.locator("p").click();
  await page.keyboard.type("existing cell content");

  const toggle = page.getByRole("button", { name: "Reorder blocks" });
  await toggle.click();

  const draggedParagraph = body.locator("p", { hasText: "dragged paragraph" });
  const paragraphBox = await draggedParagraph.boundingBox();
  if (!paragraphBox) throw new Error("missing bounding box for dragged paragraph");

  await page.mouse.move(paragraphBox.x + paragraphBox.width / 2, paragraphBox.y + paragraphBox.height / 2);
  await page.mouse.down();
  // Just one ghost so far - the origin, right where the paragraph itself
  // used to be (nothing else has been hovered yet).
  await expect(body.locator(".dry-tx-reorder-ghost")).toHaveCount(1);

  // Measured AFTER mouse.down() - hiding the dragged paragraph shifts the
  // table upward. Hovering the cell's own EXISTING paragraph directly
  // (not its padding, and not an empty placeholder) resolves to a plain
  // before/after target scoped to that cell.
  const cellParagraphBox = await cell.locator("p").boundingBox();
  if (!cellParagraphBox) throw new Error("missing bounding box for cell paragraph");
  await page.mouse.move(cellParagraphBox.x + cellParagraphBox.width / 2, cellParagraphBox.y + 2, { steps: 1 });
  // Now TWO - the table cell is a different container than the top level,
  // so the origin ghost stays up alongside the new hover one instead of
  // being replaced by it.
  await expect(body.locator(".dry-tx-reorder-ghost")).toHaveCount(2);
  await page.mouse.up();

  // Both resolve away together once the drop actually commits - the cell
  // now holds both paragraphs (the pre-existing one and the dropped one),
  // not just the dragged one alone.
  await expect(body.locator(".dry-tx-reorder-ghost")).toHaveCount(0);
  await expect(cell.locator("p")).toHaveCount(2);
  await expect(cell.locator("p", { hasText: "dragged paragraph" })).toHaveCount(1);

  const realErrors = consoleErrors.filter((msg) => !msg.includes("Outdated Optimize Dep"));
  expect(realErrors).toEqual([]);
});
