import { chromium } from "playwright";

const BASE = "http://localhost:5173/dry";
const EMAIL = "kcoder282@gmail.com";
const PASSWORD = "Khan1213";
const SLUG = "vestibulum-ante-ipsum";
const ORIGINAL_TITLE = "Vestibulum ante ipsum primis in faucibus";

const browser = await chromium.launch();
const context = await browser.newContext();

const loginPage = await context.newPage();
await loginPage.goto(`${BASE}/login`);
await loginPage.fill('input[name="email"]', EMAIL);
await loginPage.fill('input[name="password"]', PASSWORD);
await loginPage.click('button[type="submit"]');
await loginPage.waitForLoadState("networkidle");
await loginPage.goto(`${BASE}/vei/enter?to=${encodeURIComponent(`/blogs/${SLUG}`)}`);
await loginPage.waitForLoadState("networkidle");
await loginPage.close();

const tabA = await context.newPage();
tabA.on("console", (msg) => { if (msg.text().includes("[DEBUG]")) console.log("[tabA-top]", msg.text()); });
tabA.on("frameattached", (f) => {
  f.on("console", (msg) => { if (msg.text().includes("[DEBUG]")) console.log("[tabA-frame]", msg.text()); });
});
await tabA.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabA.waitForLoadState("networkidle");

await tabA.locator("h1").first().click();
await tabA.waitForTimeout(1000);
const frameHandle = await tabA.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  return host.shadowRoot.querySelector(".panel iframe");
});
const frame = await frameHandle.asElement().contentFrame();
frame.on("console", (msg) => { if (msg.text().includes("[DEBUG]")) console.log("[dialog-frame]", msg.text()); });
await frame.waitForSelector('[data-field-name="title"] input', { timeout: 15000 });
await frame.locator('[data-field-name="title"] input').first().fill("CROSSTAB DEBUG TITLE 4");
await tabA.waitForTimeout(1000);
await tabA.keyboard.press("Escape");
await tabA.waitForTimeout(300);

const saveBtnHandle = await tabA.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  const buttons = [...host.shadowRoot.querySelectorAll(".dock button")];
  return buttons.find(b => b.textContent.includes("Save"));
});
await saveBtnHandle.asElement().click();
await tabA.waitForTimeout(3000);
console.log("done, tabA url:", tabA.url());

await browser.close();
