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
await loginPage.goto(`${BASE}/vei/enter?to=${encodeURIComponent(`/blogs/${SLUG}`)}`);
await loginPage.waitForLoadState("networkidle");
await loginPage.close();

const tabA = await context.newPage();
await tabA.goto(`http://localhost:5173/blogs/${SLUG}`);
await tabA.waitForLoadState("networkidle");

await tabA.locator("h1").first().click();
await tabA.waitForTimeout(1000);
const frameHandle = await tabA.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  return host.shadowRoot.querySelector(".panel iframe");
});
const frame = await frameHandle.asElement().contentFrame();
await frame.waitForSelector('[data-field-name="title"] input', { timeout: 15000 });
await frame.locator('[data-field-name="title"] input').first().fill("CROSSTAB DEBUG TITLE 5");
await tabA.waitForTimeout(1500);

// Check IndexedDB drafts before save
const draftsBefore = await tabA.evaluate(async () => {
  return await new Promise((resolve) => {
    const req = indexedDB.open("drycms-entry-drafts");
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("drafts", "readonly");
      const getAll = tx.objectStore("drafts").getAll();
      getAll.onsuccess = () => resolve(getAll.result.map(r => r.key));
    };
  });
});
console.log("drafts before save:", draftsBefore);

await tabA.keyboard.press("Escape");
await tabA.waitForTimeout(300);

const saveBtnHandle = await tabA.evaluateHandle(() => {
  const host = document.getElementById("dry-vei-overlay");
  const buttons = [...host.shadowRoot.querySelectorAll(".dock button")];
  return buttons.find(b => b.textContent.includes("Save"));
});
await saveBtnHandle.asElement().click();

// Poll status text during save
for (let i = 0; i < 10; i++) {
  await tabA.waitForTimeout(300);
  const status = await tabA.evaluate(() => {
    const host = document.getElementById("dry-vei-overlay");
    return host.shadowRoot.querySelector(".label")?.textContent;
  });
  console.log(`status[${i}]:`, status);
}

await tabA.waitForTimeout(2000);
console.log("tabA url after save:", tabA.url());

await browser.close();
