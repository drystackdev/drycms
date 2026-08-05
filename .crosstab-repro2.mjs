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

const tabA = await context.newPage();
await tabA.goto(`${BASE}/vei/enter?to=${encodeURIComponent(`/blogs/${SLUG}`)}`);
await tabA.waitForLoadState("networkidle");

const tabB = await context.newPage();
await tabB.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabB.waitForLoadState("networkidle");

await tabA.locator("h1").first().click();
await tabA.waitForTimeout(1000);
const frameHandle = await tabA.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  return host.shadowRoot.querySelector(".panel iframe");
});
const frame = await frameHandle.asElement().contentFrame();
await frame.waitForSelector('[data-field-name="title"] input', { timeout: 15000 });
await frame.locator('[data-field-name="title"] input').first().fill("Vestibulum ante ipsum primis in faucibus");
await tabA.waitForTimeout(1000);
await tabA.keyboard.press("Escape");
await tabA.waitForTimeout(300);
await tabB.evaluate(() => { window.__testMarker = "still-here"; });

// Trigger Save via the dock (drives the real editor's save, then discards draft -> broadcasts "delete")
const saveBtnHandle = await tabA.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  const buttons = [...host.shadowRoot.querySelectorAll(".dock button")];
  return buttons.find(b => b.textContent.includes("Save"));
});
await saveBtnHandle.asElement().click();

// tabA reloads after successful save; tabB should reload too via the "delete" broadcast branch
await tabB.waitForEvent("load", { timeout: 15000 }).catch(() => console.log("tabB did not navigate/reload"));
await tabB.waitForLoadState("networkidle");
await tabB.waitForTimeout(500);
console.log("tabB h1 after remote save+delete broadcast:", await tabB.locator("h1").first().textContent());
const markerGone = await tabB.evaluate(() => window.__testMarker === undefined);
console.log("tabB actually reloaded (marker wiped):", markerGone);

await browser.close();
