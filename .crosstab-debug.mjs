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
await loginPage.close();

const tabB = await context.newPage();
tabB.on("console", (msg) => { if (msg.text().includes("[DEBUG crosstab")) console.log("[tabB]", msg.text()); });
await tabB.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabB.waitForLoadState("networkidle");

const tabA = await context.newPage();
tabA.on("console", (msg) => { if (msg.text().includes("[DEBUG crosstab")) console.log("[tabA]", msg.text()); });
await tabA.goto(`${BASE}/vei/enter?to=${encodeURIComponent(`/blogs/${SLUG}`)}`);
await tabA.waitForLoadState("networkidle");
await tabA.locator("h1").first().click();
await tabA.waitForTimeout(1000);
const frameHandle = await tabA.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  return host.shadowRoot.querySelector(".panel iframe");
});
const frame = await frameHandle.asElement().contentFrame();
frame.on("console", (msg) => { if (msg.text().includes("[DEBUG crosstab")) console.log("[agent-or-dialog-frame]", msg.text()); });
await frame.waitForSelector('[data-field-name="title"] input', { timeout: 15000 });
await frame.locator('[data-field-name="title"] input').first().fill("CROSSTAB DEBUG TITLE");
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

console.log("tabB h1 final:", await tabB.locator("h1").first().textContent());

// restore
await tabA.close();
const tabC = await context.newPage();
await tabC.goto(`${BASE}/vei/enter?to=${encodeURIComponent(`/blogs/${SLUG}`)}`);
await tabC.waitForLoadState("networkidle");
await tabC.locator("h1").first().click();
await tabC.waitForTimeout(1000);
const frameHandle2 = await tabC.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  return host.shadowRoot.querySelector(".panel iframe");
});
const frame2 = await frameHandle2.asElement().contentFrame();
await frame2.waitForSelector('[data-field-name="title"] input', { timeout: 15000 });
await frame2.locator('[data-field-name="title"] input').first().fill(ORIGINAL_TITLE);
await tabC.waitForTimeout(1000);
await tabC.keyboard.press("Escape");
await tabC.waitForTimeout(300);
const saveBtnHandle2 = await tabC.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  const buttons = [...host.shadowRoot.querySelectorAll(".dock button")];
  return buttons.find(b => b.textContent.includes("Save"));
});
await saveBtnHandle2.asElement().click();
await tabC.waitForTimeout(3000);
console.log("restored.");

await browser.close();
