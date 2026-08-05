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

async function editAndSave(newTitle) {
  const tabA = await context.newPage();
  await tabA.goto(`${BASE}/vei/enter?to=${encodeURIComponent(`/blogs/${SLUG}`)}`);
  await tabA.waitForLoadState("networkidle");
  await tabA.locator("h1").first().click();
  await tabA.waitForTimeout(1000);
  const frameHandle = await tabA.evaluateHandle(() => {
    const host = document.getElementById("dry-vei-overlay");
    return host.shadowRoot.querySelector(".panel iframe");
  });
  const frame = await frameHandle.asElement().contentFrame();
  await frame.waitForSelector('[data-field-name="title"] input', { timeout: 15000 });
  await frame.locator('[data-field-name="title"] input').first().fill(newTitle);
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
  await tabA.close();
}

// Tab B open on the page BEFORE the edit happens.
const tabB = await context.newPage();
await tabB.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabB.waitForLoadState("networkidle");
await tabB.evaluate(() => { window.__testMarker = "still-here"; });

await editAndSave("CROSS TAB DELETE BROADCAST TEST");

await tabB.waitForTimeout(1500);
console.log("tabB h1 after remote save (should show new title, via reload):", await tabB.locator("h1").first().textContent());
console.log("tabB reloaded (marker wiped):", await tabB.evaluate(() => window.__testMarker === undefined));

// Restore original title so the dev DB isn't left modified.
await editAndSave(ORIGINAL_TITLE);
console.log("restored title.");

await browser.close();
