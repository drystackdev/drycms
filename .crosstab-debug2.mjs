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
tabA.on("console", (msg) => { if (msg.text().includes("[DEBUG crosstab")) console.log("[tabA]", msg.text()); });
await tabA.goto(`${BASE}/vei/enter?to=${encodeURIComponent(`/blogs/${SLUG}`)}`);
await tabA.waitForLoadState("networkidle");

const tabB = await context.newPage();
tabB.on("console", (msg) => { if (msg.text().includes("[DEBUG crosstab")) console.log("[tabB]", msg.text()); });
await tabB.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabB.waitForLoadState("networkidle");
await tabB.waitForTimeout(500);

await tabA.locator("h1").first().click();
await tabA.waitForTimeout(1000);
const frameHandle = await tabA.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  return host.shadowRoot.querySelector(".panel iframe");
});
const frame = await frameHandle.asElement().contentFrame();
await frame.waitForSelector('[data-field-name="title"] input', { timeout: 15000 });
await frame.locator('[data-field-name="title"] input').first().fill("CROSS TAB LIVE EDIT 2");
await tabB.waitForTimeout(2000);
console.log("tabB h1:", await tabB.locator("h1").first().textContent());
await browser.close();
