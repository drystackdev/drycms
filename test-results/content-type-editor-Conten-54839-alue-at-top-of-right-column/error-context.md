# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: content-type-editor.spec.ts >> Content Type editor >> Add Field dialog: 2-column layout, type-gated placeholder, default value at top of right column
- Location: e2e/content-type-editor.spec.ts:70:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByLabel('Title', { exact: true })

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - generic [ref=e5]:
        - link "drycms" [ref=e6] [cursor=pointer]:
          - /url: /dry/dashboard
        - button "Collapse navigation" [expanded] [ref=e12] [cursor=pointer]
      - navigation "Admin" [ref=e15]:
        - generic [ref=e16]: Manage
        - link "Dashboard" [ref=e17] [cursor=pointer]:
          - /url: /dry/dashboard
        - link "Showcase" [ref=e23] [cursor=pointer]:
          - /url: /dry/showcase
        - link "Content Types" [ref=e29] [cursor=pointer]:
          - /url: /dry/content-types
        - generic:
          - generic: Content
          - generic: Soon
        - link "Media" [ref=e34] [cursor=pointer]:
          - /url: /dry/media
        - generic:
          - generic: Users
          - generic: Soon
        - generic:
          - generic: Settings
          - generic: Soon
      - generic [ref=e41]:
        - text: Mounted at
        - code [ref=e42]: /dry
    - generic [ref=e43]:
      - banner [ref=e44]:
        - button "System theme" [ref=e45] [cursor=pointer]
      - main [ref=e49]:
        - generic [ref=e50]:
          - button [ref=e51] [cursor=pointer]
          - generic [ref=e54]:
            - heading "New collection" [level=1] [ref=e55]
            - paragraph [ref=e56]: Define the fields, data types, and structure used to store content for this content type.
          - generic [ref=e57]:
            - button "Cancel" [ref=e58] [cursor=pointer]
            - button "Save & apply schema" [ref=e59] [cursor=pointer]
        - generic [ref=e60]:
          - generic [ref=e62]:
            - generic [ref=e63]:
              - generic [ref=e64]:
                - heading "Fields" [level=3] [ref=e65]
                - text: Define the columns used for data entry and storage
              - button "Add Field" [ref=e66] [cursor=pointer]
            - list [ref=e69]:
              - listitem [ref=e70]:
                - button [disabled]
                - generic [ref=e71]:
                  - generic [ref=e72]:
                    - text: ID
                    - generic [ref=e73]: Number
                    - generic [ref=e74]: System
                  - generic [ref=e75]: id
            - generic [ref=e76]: "Total: 1 field - 0 feature - 0 required"
          - generic [ref=e77]:
            - generic [ref=e78]:
              - generic [ref=e79]:
                - generic [ref=e80]: Table Name*
                - textbox "Table Name*" [ref=e81]:
                  - /placeholder: e.g. Blog Posts
              - generic [ref=e82]:
                - generic [ref=e83]: Table
                - generic [ref=e84]:
                  - textbox "Table" [ref=e85]:
                    - /placeholder: e.g. blog_posts
                  - button "Regenerate slug from title" [ref=e86] [cursor=pointer]
            - generic [ref=e90]:
              - generic [ref=e91]: Description
              - textbox "Description" [ref=e92]:
                - /placeholder: e.g. Articles published on the company blog
              - generic [ref=e93]: Optional description for this content type, shown in the admin UI.
            - group "Features" [ref=e94]:
              - generic [ref=e96]:
                - generic [ref=e99]:
                  - checkbox "Slug Adds a URL-friendly Slug field, and a Title field to go with it." [ref=e100] [cursor=pointer]
                  - generic [ref=e101] [cursor=pointer]:
                    - text: Slug
                    - generic [ref=e102]: Adds a URL-friendly Slug field, and a Title field to go with it.
                - generic [ref=e105]:
                  - checkbox "Draft Lets you save an entry as a private draft before publishing it." [ref=e106] [cursor=pointer]
                  - generic [ref=e107] [cursor=pointer]:
                    - text: Draft
                    - generic [ref=e108]: Lets you save an entry as a private draft before publishing it.
                - generic [ref=e111]:
                  - checkbox "Schedule Lets you set a future date/time for an entry to go live automatically." [ref=e112] [cursor=pointer]
                  - generic [ref=e113] [cursor=pointer]:
                    - text: Schedule
                    - generic [ref=e114]: Lets you set a future date/time for an entry to go live automatically.
                - generic [ref=e117]:
                  - checkbox "Full-text search Makes every text field on this content type searchable." [ref=e118] [cursor=pointer]
                  - generic [ref=e119] [cursor=pointer]:
                    - text: Full-text search
                    - generic [ref=e120]: Makes every text field on this content type searchable.
                - generic [ref=e123]:
                  - checkbox "Timestamps Automatically records when each entry was created and last updated." [ref=e124] [cursor=pointer]
                  - generic [ref=e125] [cursor=pointer]:
                    - text: Timestamps
                    - generic [ref=e126]: Automatically records when each entry was created and last updated.
    - region "Notifications"
  - tooltip
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | /** Creates a fresh collection via the "new" flow so the rest of the suite
  4   |  * doesn't depend on any particular content type already existing in the
  5   |  * dev database, then leaves the page on its edit URL. Returns its id too,
  6   |  * so callers can delete it again via the API once done (see
  7   |  * `deleteContentType`) - this suite runs against the real dev database, not
  8   |  * a throwaway fixture, so it must not leave test rows behind. */
  9   | async function createTestCollection(page: Page, options?: { slug?: boolean }): Promise<{ id: string; title: string }> {
  10  |   await page.goto("/dry/content-types/new/collection");
  11  |   const uniqueTitle = `E2E Test ${Date.now()}`;
  12  |   await page.getByLabel("Title", { exact: true }).fill(uniqueTitle);
  13  |   if (options?.slug) {
  14  |     await page.getByLabel("Slug", { exact: true }).check();
  15  |   }
  16  |   await page.getByRole("button", { name: "Save & apply schema" }).click();
  17  |   await page.waitForURL("**/dry/content-types");
  18  |   // Filter down to the one row - repeated runs leave earlier collections
  19  |   // around, which would otherwise push this one onto a later table page.
  20  |   await page.getByPlaceholder("Filter…").fill(uniqueTitle);
  21  |   await page.getByRole("row", { name: new RegExp(uniqueTitle) }).click();
  22  |   await page.waitForURL(/\/dry\/content-types\/.+\/edit/);
  23  |   const id = page.url().match(/\/content-types\/([^/]+)\/edit/)?.[1];
  24  |   if (!id) throw new Error("Could not extract content type id from URL.");
  25  |   return { id, title: uniqueTitle };
  26  | }
  27  | 
  28  | /** Adds a custom text field via the dialog, using its default settings. */
  29  | async function addTextField(page: Page, label: string): Promise<void> {
  30  |   await page.getByRole("button", { name: "+ Add Field" }).click();
  31  |   const dialog = page.getByRole("dialog");
  32  |   await dialog.getByLabel("Label", { exact: true }).fill(label);
  33  |   await dialog.getByRole("button", { name: "Select…" }).click();
  34  |   await page.getByRole("option", { name: "Text" }).click();
  35  |   await dialog.getByRole("button", { name: "Save field" }).click();
  36  |   await expect(dialog).toBeHidden();
  37  | }
  38  | 
  39  | /** Deletes via `fetch()` run inside the page itself (not Playwright's
  40  |  * out-of-process `page.request`) - Astro's CSRF check rejects cross-origin
  41  |  * DELETEs, and `page.request` doesn't carry the real page origin the way an
  42  |  * in-page `fetch()` does. */
  43  | async function deleteContentType(page: Page, id: string): Promise<void> {
  44  |   await page.evaluate(
  45  |     (deleteId) => fetch(`/dry/api/content-types/${encodeURIComponent(deleteId)}`, { method: "DELETE" }),
  46  |     id,
  47  |   );
  48  | }
  49  | 
  50  | test.describe("Content Type editor", () => {
  51  |   test("SlugField auto-derives the slug from the title, editably", async ({ page }) => {
  52  |     await page.goto("/dry/content-types/new/collection");
  53  | 
  54  |     const titleInput = page.getByLabel("Title", { exact: true });
  55  |     const slugInput = page.getByLabel("Table Name", { exact: true });
  56  | 
  57  |     await titleInput.fill("My Blog Post");
  58  |     await expect(slugInput).toHaveValue("my-blog-post");
  59  | 
  60  |     // Editing the slug directly stops auto-derivation.
  61  |     await slugInput.fill("custom-slug");
  62  |     await titleInput.fill("My Blog Post Two");
  63  |     await expect(slugInput).toHaveValue("custom-slug");
  64  | 
  65  |     // The regenerate button re-syncs it from the current title.
  66  |     await page.getByRole("button", { name: "Regenerate slug from title" }).click();
  67  |     await expect(slugInput).toHaveValue("my-blog-post-two");
  68  |   });
  69  | 
  70  |   test("Add Field dialog: 2-column layout, type-gated placeholder, default value at top of right column", async ({
  71  |     page,
  72  |   }) => {
  73  |     await page.goto("/dry/content-types/new/collection");
> 74  |     await page.getByLabel("Title", { exact: true }).fill("Dialog Test");
      |                                                     ^ Error: locator.fill: Test timeout of 30000ms exceeded.
  75  | 
  76  |     await page.getByRole("button", { name: "+ Add Field" }).click();
  77  |     const dialog = page.getByRole("dialog");
  78  |     await expect(dialog).toBeVisible();
  79  | 
  80  |     // 2-column grid at desktop width.
  81  |     const columns = await dialog
  82  |       .locator(".field-dialog-grid")
  83  |       .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  84  |     expect(columns).toBe(2);
  85  | 
  86  |     // Right column shows a bordered placeholder until a type is chosen.
  87  |     await expect(dialog.getByText("Choose a field type to configure its settings.")).toBeVisible();
  88  |     await expect(dialog.getByText("Display")).toHaveCount(0);
  89  |     await expect(dialog.getByLabel("Default value", { exact: true })).toHaveCount(0);
  90  | 
  91  |     // Label -> Name via the dialog's own SlugField.
  92  |     await dialog.getByLabel("Label", { exact: true }).fill("My Field");
  93  |     await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("my-field");
  94  | 
  95  |     await dialog.getByRole("button", { name: "Select…" }).click();
  96  |     await page.getByRole("option", { name: "Text" }).click();
  97  |     await expect(dialog.getByText("Choose a field type")).toHaveCount(0);
  98  | 
  99  |     // Default value renders at the very top of the (now populated) right column.
  100 |     const rightColumnFirstControl = dialog.locator(".field-dialog-grid > div:last-child > *").first();
  101 |     await expect(rightColumnFirstControl.getByLabel("Default value")).toBeVisible();
  102 |   });
  103 | 
  104 |   test("text validation: regex/format mutually exclusive, minLength=0 does not force Required, minLength>0 does", async ({
  105 |     page,
  106 |   }) => {
  107 |     await page.goto("/dry/content-types/new/collection");
  108 |     await page.getByLabel("Title", { exact: true }).fill("Dialog Test 2");
  109 |     await page.getByRole("button", { name: "+ Add Field" }).click();
  110 |     const dialog = page.getByRole("dialog");
  111 |     await dialog.getByRole("button", { name: "Select…" }).click();
  112 |     await page.getByRole("option", { name: "Text" }).click();
  113 | 
  114 |     const regexInput = dialog.getByLabel("Regex", { exact: true });
  115 |     const formatSelect = dialog.locator(".field", { hasText: "Format" }).getByRole("button");
  116 |     const requiredCheckbox = dialog.getByLabel("Required", { exact: true });
  117 |     const minLengthInput = dialog.getByLabel("Min length", { exact: true });
  118 | 
  119 |     // Untouched minLength (displays 0 by default) must NOT force Required.
  120 |     await expect(requiredCheckbox).not.toBeChecked();
  121 |     await expect(requiredCheckbox).toBeEnabled();
  122 | 
  123 |     await regexInput.fill("^[a-z]+$");
  124 |     await expect(formatSelect).toBeDisabled();
  125 |     await expect(requiredCheckbox).toBeChecked();
  126 |     await expect(requiredCheckbox).toBeDisabled();
  127 |     await regexInput.fill("");
  128 |     await expect(formatSelect).toBeEnabled();
  129 |     await expect(requiredCheckbox).toBeEnabled();
  130 | 
  131 |     // A real (>0) minLength forces Required.
  132 |     await minLengthInput.fill("3");
  133 |     await expect(requiredCheckbox).toBeChecked();
  134 |     await expect(requiredCheckbox).toBeDisabled();
  135 | 
  136 |     // Required + Unique share a row; Min length + Max length share a row.
  137 |     const uniqueCheckbox = dialog.getByLabel("Unique", { exact: true });
  138 |     const maxLengthInput = dialog.getByLabel("Max length", { exact: true });
  139 |     const requiredBox = await requiredCheckbox.boundingBox();
  140 |     const uniqueBox = await uniqueCheckbox.boundingBox();
  141 |     const minBox = await minLengthInput.boundingBox();
  142 |     const maxBox = await maxLengthInput.boundingBox();
  143 |     expect(Math.abs(requiredBox!.y - uniqueBox!.y)).toBeLessThan(4);
  144 |     expect(Math.abs(minBox!.y - maxBox!.y)).toBeLessThan(4);
  145 | 
  146 |     // Switch to "number" - step defaults to 1.
  147 |     await dialog.getByRole("button", { name: "Text" }).click();
  148 |     await page.getByRole("option", { name: "Number" }).click();
  149 |     const stepInput = dialog.getByLabel("Step", { exact: true });
  150 |     await expect(stepInput).toHaveValue("1");
  151 |   });
  152 | 
  153 |   test("Add Field dialog scrolls its own body instead of the window when content overflows", async ({ page }) => {
  154 |     await page.setViewportSize({ width: 800, height: 500 });
  155 |     await page.goto("/dry/content-types/new/collection");
  156 |     await page.getByLabel("Title", { exact: true }).fill("Scroll Test");
  157 | 
  158 |     await page.getByRole("button", { name: "+ Add Field" }).click();
  159 |     const dialog = page.getByRole("dialog");
  160 |     await dialog.getByRole("button", { name: "Select…" }).click();
  161 |     await page.getByRole("option", { name: "Text" }).click();
  162 |     await expect(dialog.getByText("Validation")).toBeVisible();
  163 | 
  164 |     // Scrolling is handled by native overflow on `.field-dialog-scroll` (the
  165 |     // grid's wrapper), not by the grid itself or the window.
  166 |     const scrollRoot = dialog.locator(".field-dialog-scroll");
  167 |     const gridOverflows = await scrollRoot.evaluate((el) => el.scrollHeight > el.clientHeight);
  168 |     expect(gridOverflows).toBe(true);
  169 | 
  170 |     const windowScrollable = await page.evaluate(
  171 |       () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
  172 |     );
  173 |     expect(windowScrollable).toBe(false);
  174 |   });
```