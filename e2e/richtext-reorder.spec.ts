import { expect, test, type Locator, type Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  const token = process.env.E2E_SESSION_TOKEN;
  if (!token) return;
  await context.addCookies([
    {
      name: "drycms_session",
      value: encodeURIComponent(token),
      domain: "localhost",
      path: "/dry",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});

async function openPreset(page: Page, name: string) {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto("/dry/richtext-demo");
  await page.getByRole("button", { name, exact: true }).click();
  const mount = page.locator(".richtext-content-mount").first();
  await expect(mount).toBeVisible();
  return mount;
}

async function enableReorder(page: Page, mount: Locator) {
  const toggle = page.getByRole("button", { name: "Reorder blocks" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const surface = mount.locator(".dry-html-reorder-surface");
  await expect(surface).toBeVisible();
  return { surface, toggle };
}

async function dragHandle(page: Page, source: Locator, target: Locator, targetY = 0.8) {
  const ownerId = await source.getAttribute("data-reorder-item");
  if (!ownerId) throw new Error("Drag source has no reorder identity");
  const handle = source.locator(`.dry-html-reorder-handle[data-reorder-handle-item="${ownerId}"]`).first();
  await expect(handle).toBeAttached();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("Missing drag source geometry");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("Missing drag target geometry");
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * targetY, { steps: 1 });
  await page.mouse.up();
}

test("HTML reorder surface reorders blocks and commits only when the mode is closed", async ({ page }) => {
  const mount = await openPreset(page, "Headings + quote");
  const { surface, toggle } = await enableReorder(page, mount);

  await expect(page.getByRole("button", { name: "Bold" })).toBeDisabled();
  await expect(surface.locator(":scope > h2")).toHaveText("Heading two");
  await expect(surface.locator(":scope > blockquote > p")).toContainText("A quoted excerpt");

  const h2 = surface.locator(":scope > h2");
  const h4 = surface.locator(":scope > h4");
  await dragHandle(page, h2, h4);

  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(surface.locator(":scope > *").nth(0)).toHaveText("Heading three");
  await expect(surface.locator(":scope > *").nth(1)).toHaveText("Heading four");
  await expect(surface.locator(":scope > *").nth(2)).toHaveText("Heading two");

  // A second move in the same mode verifies handles are rebuilt with their
  // new owner identities rather than retaining stale pre-move metadata.
  await dragHandle(page, surface.locator(":scope > h3"), surface.locator(":scope > h2"));
  await expect(surface.locator(":scope > *").nth(0)).toHaveText("Heading four");
  await expect(surface.locator(":scope > *").nth(1)).toHaveText("Heading two");
  await expect(surface.locator(":scope > *").nth(2)).toHaveText("Heading three");

  await toggle.click();
  await expect(surface).toHaveCount(0);
  const editor = mount.locator(".dry-tx-content");
  await expect(editor.locator(":scope > *").nth(0)).toHaveText("Heading four");
  await expect(editor.locator(":scope > *").nth(1)).toHaveText("Heading two");
  await expect(editor.locator(":scope > *").nth(2)).toHaveText("Heading three");
  await expect(mount.locator("[data-reorder-item], .dry-html-reorder-handle, .dry-html-reorder-placeholder")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bold" })).toBeEnabled();
});

test("list conversion unwraps li outside a list and wraps a block entering a list", async ({ page }) => {
  const mount = await openPreset(page, "Lists");
  const { surface, toggle } = await enableReorder(page, mount);

  const intro = surface.locator(":scope > p", { hasText: "Intro paragraph" });
  const firstBullet = surface.locator(":scope > ul > li").first();
  await dragHandle(page, firstBullet, intro);

  const lifted = surface.locator(":scope > p", { hasText: "First bullet" });
  await expect(lifted).toHaveCount(1);
  await expect(surface.locator(":scope > ul > li")).toHaveCount(1);

  const orderedFirst = surface.locator(":scope > ol > li").first();
  await dragHandle(page, lifted, orderedFirst, 0.2);
  await expect(surface.locator(":scope > ol > li").first()).toContainText("First bullet");
  await expect(surface.locator(":scope > p", { hasText: "First bullet" })).toHaveCount(0);

  await toggle.click();
  const editor = mount.locator(".dry-tx-content");
  await expect(editor.locator(":scope > ol > li").first()).toContainText("First bullet");
});

test("table rows use anchored handles and only reorder inside their table section", async ({ page }) => {
  const mount = await openPreset(page, "Table");
  const { surface, toggle } = await enableReorder(page, mount);

  const rows = surface.locator("tbody > tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2).locator(":scope > td").first()).not.toHaveAttribute("data-reorder-item");
  await expect(rows.nth(2).locator(":scope > td").first().locator(".dry-html-reorder-handle")).toHaveCount(1);

  const bob = rows.filter({ hasText: "Bob" });
  const alice = rows.filter({ hasText: "Alice" });
  await dragHandle(page, bob, alice, 0.2);
  await expect(rows.nth(0)).toContainText("Name");
  await expect(rows.nth(1)).toContainText("Bob");
  await expect(rows.nth(2)).toContainText("Alice");

  await toggle.click();
  const editorRows = mount.locator(".dry-tx-content tbody > tr");
  await expect(editorRows.nth(1)).toContainText("Bob");
  await expect(editorRows.nth(2)).toContainText("Alice");
});

test("tables remain valid flow blocks inside list items and table cells", async ({ page }) => {
  const mount = await openPreset(page, "Nested structures");
  const { surface, toggle } = await enableReorder(page, mount);

  const listItem = surface.locator(":scope > ul > li");
  const tableInList = listItem.locator(":scope > table");
  const outerTable = surface.locator(":scope > table");
  const outerCell = outerTable.locator(":scope > tbody > tr > td");
  const nestedCellTable = outerCell.locator(":scope > table");
  await expect(tableInList).toHaveCount(1);
  await expect(nestedCellTable).toHaveCount(1);
  await expect(outerCell).not.toHaveAttribute("data-reorder-item");

  await dragHandle(page, nestedCellTable, listItem.locator(":scope > p"));
  await expect(listItem.locator(":scope > table")).toHaveCount(2);
  await expect(outerCell.locator(":scope > table")).toHaveCount(0);

  const movedTable = listItem.locator(":scope > table", { hasText: "Nested cell table" });
  await dragHandle(page, movedTable, outerCell.locator(":scope > p"));
  await expect(listItem.locator(":scope > table")).toHaveCount(1);
  await expect(outerCell.locator(":scope > table")).toHaveCount(1);

  await toggle.click();
  const editor = mount.locator(".dry-tx-content");
  await expect(editor.locator("li table")).toHaveCount(1);
  await expect(editor.locator("td table")).toHaveCount(1);
});

test("grid is a draggable container and accepts blocks as sibling grid items", async ({ page }) => {
  const mount = await openPreset(page, "Grid");
  const { surface, toggle } = await enableReorder(page, mount);
  const grid = surface.locator(":scope > .dry-tx-grid");
  const outside = surface.locator(":scope > p", { hasText: "Outside grid block" });
  const existing = grid.locator(":scope > p", { hasText: "Existing grid cell" });

  const gridId = await grid.getAttribute("data-reorder-item");
  await expect(grid.locator(`.dry-html-reorder-handle[data-reorder-handle-item="${gridId}"]`)).toHaveCount(1);
  await dragHandle(page, outside, existing);
  await expect(grid.locator(":scope > p")).toHaveCount(2);

  await toggle.click();
  await expect(mount.locator(".dry-tx-content .dry-tx-grid > .dry-tx-grid-item")).toHaveCount(2);
});

test("blockquote accepts blocks while figure remains one atomic draggable item", async ({ page }) => {
  let mount = await openPreset(page, "Headings + quote");
  let active = await enableReorder(page, mount);
  const quote = active.surface.locator(":scope > blockquote");
  const paragraph = active.surface.locator(":scope > p", { hasText: "A regular paragraph" });
  await dragHandle(page, paragraph, quote.locator("p"), 0.8);
  await expect(quote.locator(":scope > p")).toHaveCount(2);
  await active.toggle.click();
  await expect(mount.locator(".dry-tx-content > blockquote > p")).toHaveCount(2);

  mount = await openPreset(page, "Captioned image");
  active = await enableReorder(page, mount);
  const figure = active.surface.locator("figure");
  await expect(figure).toHaveAttribute("data-reorder-atomic", "true");
  await expect(figure.locator(":scope > .dry-html-reorder-handle")).toHaveCount(1);
  await expect(figure.locator("figcaption[data-reorder-item]")).toHaveCount(0);
  await expect(figure.locator("img[data-reorder-item]")).toHaveCount(0);
  const trailingParagraph = active.surface.locator(":scope > p", { hasText: "Paragraph after the captioned image" });
  await dragHandle(page, figure, trailingParagraph);
  expect(await trailingParagraph.evaluate((element) => element.nextElementSibling?.tagName)).toBe("FIGURE");
  await dragHandle(page, trailingParagraph, figure, 0.5);
  await expect(figure.locator(":scope > p")).toHaveCount(0);
  await expect(figure.locator(":scope > img")).toHaveCount(1);
  await expect(figure.locator(":scope > figcaption")).toHaveCount(1);
  await active.toggle.click();
});
