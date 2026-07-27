import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(String(err)));

const base = "http://localhost:4321/dry";
const outDir = "/private/tmp/claude-501/-Users-kcoder-drycms/676f8cf8-3e07-44ec-b9cf-dd1d4e4acd0a/scratchpad/screens";

await page.goto(`${base}/content-types/system-menu/edit`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Add Field", { timeout: 15000 });
await page.click("text=Add Field");
await page.waitForSelector('dialog[open] >> text=Type', { timeout: 15000 });

// Pick "Relation" as the field type via the custom Select component.
await page.locator('dialog[open] .field:has(label:text("Type")) .select > button').click();
await page.locator('dialog[open] [role="option"]:has-text("Relation")').click();

// Give it a name so validation isn't the thing shown.
await page.fill('dialog[open] input[placeholder="e.g. Title"]', "Owner");

// Open the Cardinality select.
await page.locator('dialog[open] .field:has(label:text("Cardinality")) .select > button').click();
await page.waitForSelector('dialog[open] [role="listbox"]', { timeout: 5000 });

await page.waitForTimeout(400);
 await page.screenshot({ path: `${outDir}/6b-cardinality-narrow.png`, fullPage: false });

console.log("ERRORS:", JSON.stringify(errors));
await browser.close();
