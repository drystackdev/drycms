import { chromium } from "playwright";

const BASE = "http://localhost:5173/dry";
const EMAIL = "kcoder282@gmail.com";
const PASSWORD = "Khan1213";
const SLUG = "vestibulum-ante-ipsum";

const browser = await chromium.launch();
const context = await browser.newContext();

const loginPage = await context.newPage();
await loginPage.goto(`${BASE}/login`);
await loginPage.fill('input[name="email"]', EMAIL);
await loginPage.fill('input[name="password"]', PASSWORD);
await loginPage.click('button[type="submit"]');
await loginPage.waitForLoadState("networkidle");
await loginPage.close();

// Tab A and Tab B both open on the same VEI edit-mode page, already loaded.
const tabA = await context.newPage();
await tabA.goto(`${BASE}/vei/enter?to=${encodeURIComponent(`/blogs/${SLUG}`)}`);
await tabA.waitForLoadState("networkidle");

const tabB = await context.newPage();
await tabB.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabB.waitForLoadState("networkidle");
await tabB.waitForTimeout(500);

console.log("tabB h1 before:", await tabB.locator("h1").first().textContent());
const badgeBefore = await tabB.evaluate(() => {
  const host = document.getElementById("dry-vei-overlay");
  return host?.shadowRoot?.querySelector(".badge")?.textContent ?? null;
});
console.log("tabB preview badge before:", badgeBefore);

// Edit title in tab A's dialog
await tabA.locator("h1").first().click();
await tabA.waitForTimeout(1000);
const frameHandle = await tabA.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  return host.shadowRoot.querySelector(".panel iframe");
});
const frame = await frameHandle.asElement().contentFrame();
await frame.waitForSelector('[data-field-name="title"] input', { timeout: 15000 });
await frame.locator('[data-field-name="title"] input').first().fill("CROSS TAB LIVE EDIT");

// Give the 300ms debounce + broadcast + tabB's DOM patch time to land
await tabB.waitForTimeout(2000);

console.log("tabB h1 after (should be updated WITHOUT reload):", await tabB.locator("h1").first().textContent());
const badgeAfter = await tabB.evaluate(() => {
  const host = document.getElementById("dry-vei-overlay");
  return host?.shadowRoot?.querySelector(".badge")?.textContent ?? null;
});
console.log("tabB preview badge after:", badgeAfter);

await browser.close();
