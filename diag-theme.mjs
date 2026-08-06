import { chromium } from "@playwright/test";

const BASE = "http://localhost:5173/dry";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"], input[name="email"]', "kcoder282@gmail.com");
await page.fill('input[type="password"], input[name="password"]', "Khan1213");
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 15000 });
console.log("Logged in, at", page.url());

await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Primary");

const before = await page.evaluate(() => {
  const link = document.querySelector('link[href*="system-settings"]');
  return {
    linkExists: !!link,
    linkHref: link ? link.getAttribute("href") : null,
    computedPrimary: getComputedStyle(document.querySelector(".dry") ?? document.body).getPropertyValue("--dry-primary"),
    headLinks: Array.from(document.querySelectorAll("link[rel=stylesheet]")).map((l) => l.getAttribute("href")),
  };
});
console.log("BEFORE change:", JSON.stringify(before, null, 2));

// fetch the raw theme.css content directly to see server truth
const rawCssBefore = await page.evaluate(async () => (await fetch(document.querySelector('link[href*="system-settings"]').href)).text());
console.log("theme.css BEFORE save:\n", rawCssBefore);

// Change the Primary color text field to a distinctive red and save
const primaryInput = page.locator("text=Primary").locator("..").locator("input[type=text]");
await primaryInput.fill("");
await primaryInput.fill("#ff0000");
await primaryInput.dispatchEvent("input");
await page.click('button:has-text("Save")');
await page.waitForTimeout(1500);

const afterNoReload = await page.evaluate(async () => {
  const link = document.querySelector('link[href*="system-settings"]');
  const css = link ? await (await fetch(link.href)).text() : null;
  return {
    linkHref: link ? link.getAttribute("href") : null,
    computedPrimary: getComputedStyle(document.querySelector(".dry") ?? document.body).getPropertyValue("--dry-primary"),
    serverCssNow: css,
  };
});
console.log("AFTER save, NO reload:", JSON.stringify(afterNoReload, null, 2));

await page.reload({ waitUntil: "networkidle" });
const afterReload = await page.evaluate(() => ({
  computedPrimary: getComputedStyle(document.querySelector(".dry") ?? document.body).getPropertyValue("--dry-primary"),
  linkHref: document.querySelector('link[href*="system-settings"]')?.getAttribute("href"),
}));
console.log("AFTER hard reload:", JSON.stringify(afterReload, null, 2));

await page.screenshot({ path: "/private/tmp/claude-501/-Users-kcoder-drycms/e10281d0-5584-44bb-b945-aad4888a2b82/scratchpad/settings-after-reload.png", fullPage: true });

console.log("Console errors:", errors);
await browser.close();
