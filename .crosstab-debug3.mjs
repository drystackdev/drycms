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
// Establish the VEI cookie BEFORE tabB ever loads, so tabB genuinely enters edit mode.
await loginPage.goto(`${BASE}/vei/enter?to=${encodeURIComponent(`/blogs/${SLUG}`)}`);
await loginPage.waitForLoadState("networkidle");
await loginPage.close();

const tabB = await context.newPage();
tabB.on("console", (msg) => { if (msg.text().includes("[DEBUG crosstab")) console.log("[tabB]", msg.text()); });
await tabB.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabB.waitForLoadState("networkidle");
await tabB.evaluate(() => { window.__testMarker = "still-here"; });

async function editAndSave(page, newTitle) {
  await page.locator("h1").first().click();
  await page.waitForTimeout(1000);
  const frameHandle = await page.evaluateHandle(() => {
    const host = document.getElementById("dry-vei-overlay");
    return host.shadowRoot.querySelector(".panel iframe");
  });
  const frame = await frameHandle.asElement().contentFrame();
  await frame.waitForSelector('[data-field-name="title"] input', { timeout: 15000 });
  await frame.locator('[data-field-name="title"] input').first().fill(newTitle);
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const saveBtnHandle = await page.evaluateHandle(() => {
    const host = document.getElementById("dry-vei-overlay");
    const buttons = [...host.shadowRoot.querySelectorAll(".dock button")];
    return buttons.find(b => b.textContent.includes("Save"));
  });
  await saveBtnHandle.asElement().click();
  await page.waitForTimeout(3000);
}

const tabA = await context.newPage();
tabA.on("console", (msg) => { if (msg.text().includes("[DEBUG crosstab")) console.log("[tabA]", msg.text()); });
await tabA.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabA.waitForLoadState("networkidle");
await editAndSave(tabA, "CROSSTAB DEBUG TITLE 3");
await tabA.close();

console.log("tabB h1 final:", await tabB.locator("h1").first().textContent());
console.log("tabB reloaded:", await tabB.evaluate(() => window.__testMarker === undefined));

// restore
const tabC = await context.newPage();
await tabC.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabC.waitForLoadState("networkidle");
await editAndSave(tabC, ORIGINAL_TITLE);
console.log("restored.");

await browser.close();
