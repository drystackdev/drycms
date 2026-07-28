import { chromium } from "@playwright/test";

const BASE = "http://localhost:4321/dry";
const errors = [];

async function freshPage(page) {
  await page.goto(`${BASE}/richtext-demo`, { waitUntil: "networkidle" });
  await page.waitForSelector(".richtext-content", { timeout: 15000 });
  await page.click('button:has-text("Plain paragraph")');
  await page.waitForSelector(".richtext-content p");
}

async function insertImageAtEndOfParagraph(page) {
  const p = page.locator(".richtext-content p").first();
  const insertBtn = page.locator('button[aria-label="Insert image"]');
  const dialog = page.locator('dialog[aria-label="Insert image"]');
  const checkbox = page.locator('input[aria-label="Select test-image.png"]');
  const insertConfirm = dialog.locator('footer button:has-text("Insert")');

  const pBox = await p.boundingBox();
  await page.mouse.click(pBox.x + pBox.width - 5, pBox.y + pBox.height / 2);
  await page.keyboard.press("End");
  await page.waitForTimeout(100);
  await insertBtn.click();
  await dialog.waitFor({ state: "visible" });
  await checkbox.waitFor({ timeout: 10000 });
  await checkbox.check({ force: true });
  await insertConfirm.click();
  await page.waitForSelector('dialog[aria-label="Insert image"][open]', { state: "hidden", timeout: 5000 });

  await page.waitForFunction(() => {
    const img = document.querySelector(".richtext-content img.richtext-image");
    return !!img && img.complete && img.naturalWidth > 0;
  }, { timeout: 10000 });
}

// Places the native selection collapsed immediately BEFORE the <img> inside
// its parent <p> - precise DOM-offset placement, not pixel-guessing, so
// Lexical's own selectionchange sync gets an unambiguous starting point.
async function placeCaretBeforeImage(page) {
  await page.evaluate(() => {
    const p = document.querySelector(".richtext-content p");
    const img = document.querySelector(".richtext-content img.richtext-image");
    const idx = Array.from(p.childNodes).indexOf(img);
    const range = document.createRange();
    range.setStart(p, idx);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  const content = page.locator(".richtext-content");

  // --- Scenario 4: forward Delete right before the image removes it whole ---
  await freshPage(page);
  await insertImageAtEndOfParagraph(page);
  await placeCaretBeforeImage(page);
  const before4 = await content.locator("img.richtext-image").count();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);
  const after4 = await content.locator("img.richtext-image").count();
  const text4 = await content.innerText();
  console.log("SCENARIO4 images before/after single forward-Delete:", before4, after4);
  console.log("SCENARIO4 removed whole image in one keystroke:", before4 - after4 === 1);
  console.log("SCENARIO4 text preserved:", JSON.stringify(text4));

  // --- Scenario 5: ArrowRight from right before the image hops over it ---
  await freshPage(page);
  await insertImageAtEndOfParagraph(page);
  await placeCaretBeforeImage(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("HOPMARK");
  await page.waitForTimeout(200);
  const html5 = await content.innerHTML();
  console.log("SCENARIO5 html:", html5);
  console.log("SCENARIO5 single ArrowRight hopped past the image:", html5.indexOf("richtext-image") < html5.indexOf("HOPMARK"));

  // --- Scenario 6: ArrowLeft from right after the image hops back over it ---
  await freshPage(page);
  await insertImageAtEndOfParagraph(page);
  const img6 = content.locator("img.richtext-image").first();
  const box6 = await img6.boundingBox();
  await page.mouse.click(box6.x + box6.width + 4, box6.y + box6.height / 2);
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("BACKHOP");
  await page.waitForTimeout(200);
  const html6 = await content.innerHTML();
  console.log("SCENARIO6 html:", html6);
  console.log("SCENARIO6 single ArrowLeft hopped back before the image:", html6.indexOf("BACKHOP") < html6.indexOf("richtext-image"));

  console.log("CONSOLE_ERRORS:", JSON.stringify(errors));

  await browser.close();
})().catch((err) => {
  console.error("SCRIPT_FAILED", err);
  process.exit(1);
});
