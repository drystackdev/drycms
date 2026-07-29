import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto("http://localhost:4321/dry/richtext-demo", { waitUntil: "networkidle" });
await page.waitForSelector(".richtext-content, [contenteditable]", { timeout: 15000 }).catch(() => {});

await page.getByRole("button", { name: "Table", exact: true }).click();
await page.screenshot({ path: "/private/tmp/claude-501/-Users-kcoder-drycms/2b866eb1-3458-4262-a16e-e0fa88bc23ca/scratchpad/01b-after-preset.png", fullPage: false });
console.log("table count (light dom):", await page.locator("table").count());
await page.waitForSelector("table", { timeout: 10000 });

// Click inside the first cell to put the selection in the table, revealing the table menu card.
await page.locator("table td, table th").first().click();
await page.waitForSelector('button[aria-label="Cell alignment"]', { timeout: 10000 });
await page.waitForTimeout(400);

await page.screenshot({ path: "/private/tmp/claude-501/-Users-kcoder-drycms/2b866eb1-3458-4262-a16e-e0fa88bc23ca/scratchpad/02-table-menu.png", fullPage: false });
console.log("cell align disabled?", await page.locator('button[aria-label="Cell alignment"]').isDisabled());

// Open the "Cell alignment" popover.
await page.locator('button[aria-label="Cell alignment"]').click();
console.log("errors after click:", errors);
console.log("matches(:popover-open):", await page.locator(".richtext-align-grid").evaluate((el) => el.closest("ul")?.matches(":popover-open")));
await page.waitForTimeout(300);
console.log("matches(:popover-open) later:", await page.locator(".richtext-align-grid").evaluate((el) => el.closest("ul")?.matches(":popover-open")));
console.log("errors:", errors);
console.log(
  "grid box + style:",
  await page.locator(".richtext-align-grid").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { rect: el.getBoundingClientRect().toJSON(), display: cs.display, visibility: cs.visibility, opacity: cs.opacity, width: cs.width, height: cs.height };
  }),
);
console.log(
  "cell box + style:",
  await page.locator(".richtext-align-grid-cell").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { rect: el.getBoundingClientRect().toJSON(), display: cs.display, width: cs.width, height: cs.height, border: cs.border };
  }),
);
await page.waitForSelector(".richtext-align-grid", { timeout: 5000 });
await page.screenshot({ path: "/private/tmp/claude-501/-Users-kcoder-drycms/2b866eb1-3458-4262-a16e-e0fa88bc23ca/scratchpad/03-align-popover.png", fullPage: false });

// Pick center/bottom (row 2, col 1) and reopen to confirm the trigger icon + active dot moved.
await page.locator(".richtext-align-grid-row").nth(2).locator(".richtext-align-grid-cell").nth(1).click();
await page.screenshot({ path: "/private/tmp/claude-501/-Users-kcoder-drycms/2b866eb1-3458-4262-a16e-e0fa88bc23ca/scratchpad/04-align-picked.png", fullPage: false });

// Close and reopen the popover, screenshot again to confirm state + trigger icon dot position.
await page.keyboard.press("Escape");
await page.locator('button[aria-label="Cell alignment"]').click();
await page.waitForSelector(".richtext-align-grid", { timeout: 5000 });
await page.screenshot({ path: "/private/tmp/claude-501/-Users-kcoder-drycms/2b866eb1-3458-4262-a16e-e0fa88bc23ca/scratchpad/05-align-reopened.png", fullPage: false });
await page.keyboard.press("Escape");

// Now the "Insert table" 6x6 grid picker, for visual contrast.
await page.locator('button[aria-label="Insert table"]').click();
await page.waitForSelector(".richtext-table-grid", { timeout: 5000 });
await page.screenshot({ path: "/private/tmp/claude-501/-Users-kcoder-drycms/2b866eb1-3458-4262-a16e-e0fa88bc23ca/scratchpad/06-insert-table-popover.png", fullPage: false });
await page.keyboard.press("Escape");

console.log("errors:", errors);

await browser.close();
