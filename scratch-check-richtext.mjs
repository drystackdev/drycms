import { chromium, request } from "playwright-core";

const base = "http://127.0.0.1:4173";
const email = "manual-check@example.test";
const password = "manual-check-password-123";

const ctx = await request.newContext({ baseURL: base });
const csrfCookie = async () => {
  const state = await ctx.storageState();
  const c = state.cookies.find((c) => c.name === "drycms_csrf");
  return decodeURIComponent(c.value);
};

// bootstrap first admin
await ctx.get("/dry/api/auth/session");
const bootRes = await ctx.post("/dry/api/auth/register-first-admin", {
  data: { name: "Manual Check", email, password },
  headers: {
    "X-CSRF-Token": await csrfCookie(),
    "X-DryCMS-Bootstrap-Token": "drycms-e2e-bootstrap-token-do-not-use-outside-tests",
  },
});
console.log("register:", bootRes.status(), await bootRes.text());

const csrf = await csrfCookie();

// create a content type with 2 richtext fields: one inline, one block-level
const ctRes = await ctx.post("/dry/api/content-types", {
  headers: { "X-CSRF-Token": csrf },
  data: {
    definition: {
      id: "rt-check",
      kind: "collection",
      name: "rt-check",
      label: "RT Check",
      fields: [
        { id: "title", name: "title", label: "Title", type: "text", config: {}, validation: { required: true }, order: 0 },
        {
          id: "blockContent",
          name: "blockContent",
          label: "Block Content",
          type: "richtext",
          config: { inline: false, layoutContent: false, bold: true, italic: true, underline: true, color: true, link: true, heading: true, alignment: true, lists: true, image: true, component: true, table: true, grid: true, fullscreen: true },
          validation: {},
          order: 1,
        },
        {
          id: "inlineContent",
          name: "inlineContent",
          label: "Inline Content",
          type: "richtext",
          config: { inline: true, layoutContent: false, bold: true, italic: true, underline: true, color: true, link: true, heading: false, alignment: false, lists: false, image: false, component: false, table: false, grid: false, fullscreen: false },
          validation: {},
          order: 2,
        },
      ],
    },
  },
});
console.log("create content type:", ctRes.status(), await ctRes.text());

const entryRes = await ctx.post("/dry/api/content/rt-check", {
  headers: { "X-CSRF-Token": csrf },
  data: {
    title: "Hello world",
    blockContent: "<h2>A heading</h2><p>Some fairly long paragraph content that would be unwieldy to dump raw into a table cell as tag soup.</p><ul><li>one</li><li>two</li></ul>",
    inlineContent: "<span>Short inline blurb</span>",
  },
});
console.log("create entry:", entryRes.status(), await entryRes.text());

await ctx.dispose();

// now visually check the list page
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/dry/login`);
await page.fill('input[type="email"]', email);
await page.fill('input[type="password"]', password);
await page.click('button[type="submit"]');
await page.waitForTimeout(1000);
await page.goto(`${base}/dry/content/rt-check`);
await page.waitForTimeout(1500);
await page.screenshot({ path: "/private/tmp/claude-501/-Users-kcoder-drycms/f4ac4dba-0ecb-4bb8-b286-2b617c5ae86d/scratchpad/rt-check-list.png", fullPage: true });
const bodyText = await page.locator("table").innerText().catch(() => "(no table found)");
console.log("TABLE TEXT:\n", bodyText);
await browser.close();
