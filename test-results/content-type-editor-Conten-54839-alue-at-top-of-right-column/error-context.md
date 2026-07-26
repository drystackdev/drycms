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
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '+ Add Field' })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - region "scrollable content" [ref=e8]:
        - generic [ref=e9]:
          - generic [ref=e10]:
            - link "drycms" [ref=e11] [cursor=pointer]:
              - /url: /dry/dashboard
            - button "Collapse navigation" [expanded] [ref=e17] [cursor=pointer]
          - navigation "Admin" [ref=e20]:
            - generic [ref=e21]: Manage
            - link "Dashboard" [ref=e22] [cursor=pointer]:
              - /url: /dry/dashboard
            - link "Showcase" [ref=e28] [cursor=pointer]:
              - /url: /dry/showcase
            - link "Content Types" [ref=e34] [cursor=pointer]:
              - /url: /dry/content-types
            - generic:
              - generic: Content
              - generic: Soon
            - link "Media" [ref=e39] [cursor=pointer]:
              - /url: /dry/media
            - generic:
              - generic: Users
              - generic: Soon
            - generic:
              - generic: Settings
              - generic: Soon
          - generic [ref=e45]:
            - text: Mounted at
            - code [ref=e46]: /dry
    - region "scrollable content" [ref=e51]:
      - generic [ref=e52]:
        - button "System theme" [ref=e54] [cursor=pointer]
        - main [ref=e58]:
          - generic [ref=e59]:
            - button [ref=e60] [cursor=pointer]
            - generic [ref=e63]:
              - heading "New collection" [level=1] [ref=e64]
              - paragraph [ref=e65]: Content type schema.
            - generic [ref=e66]:
              - button "Cancel" [ref=e67] [cursor=pointer]
              - button "Save & apply schema" [ref=e68] [cursor=pointer]
          - generic [ref=e69]:
            - generic [ref=e71]:
              - generic [ref=e72]:
                - generic [ref=e73]:
                  - heading "Fields" [level=3] [ref=e74]
                  - text: Define the columns used for data entry and storage
                - button "Add Field" [ref=e75] [cursor=pointer]
              - list [ref=e78]:
                - listitem [ref=e79]:
                  - button [disabled]
                  - generic [ref=e80]:
                    - generic [ref=e81]:
                      - text: ID
                      - generic [ref=e82]: Number
                    - generic [ref=e83]: id
            - generic [ref=e84]:
              - generic [ref=e85]:
                - generic [ref=e86]:
                  - generic [ref=e87]: Title
                  - textbox "Title" [active] [ref=e88]: Dialog Test
                - generic [ref=e89]:
                  - generic [ref=e90]: Table Name
                  - generic [ref=e91]:
                    - textbox "Table Name" [ref=e92]: dialog-test
                    - button "Regenerate slug from title" [ref=e93] [cursor=pointer]
              - generic [ref=e97]:
                - generic [ref=e98]: Description
                - textbox "Description" [ref=e99]
              - group "Features" [ref=e100]:
                - generic [ref=e102]:
                  - generic [ref=e104]:
                    - generic [ref=e105]:
                      - checkbox "Slug" [ref=e106] [cursor=pointer]
                      - generic [ref=e107] [cursor=pointer]: Slug
                    - generic [ref=e108]: Adds a URL-friendly Slug field, and a Title field to go with it.
                  - generic [ref=e110]:
                    - generic [ref=e111]:
                      - checkbox "Draft" [ref=e112] [cursor=pointer]
                      - generic [ref=e113] [cursor=pointer]: Draft
                    - generic [ref=e114]: Lets you save an entry as a private draft before publishing it.
                  - generic [ref=e116]:
                    - generic [ref=e117]:
                      - checkbox "Schedule" [ref=e118] [cursor=pointer]
                      - generic [ref=e119] [cursor=pointer]: Schedule
                    - generic [ref=e120]: Lets you set a future date/time for an entry to go live automatically.
                  - generic [ref=e122]:
                    - generic [ref=e123]:
                      - checkbox "Full-text search" [ref=e124] [cursor=pointer]
                      - generic [ref=e125] [cursor=pointer]: Full-text search
                    - generic [ref=e126]: Makes every text field on this content type searchable.
                  - generic [ref=e128]:
                    - generic [ref=e129]:
                      - checkbox "Timestamps" [ref=e130] [cursor=pointer]
                      - generic [ref=e131] [cursor=pointer]: Timestamps
                    - generic [ref=e132]: Automatically records when each entry was created and last updated.
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
  74  |     await page.getByLabel("Title", { exact: true }).fill("Dialog Test");
  75  | 
> 76  |     await page.getByRole("button", { name: "+ Add Field" }).click();
      |                                                             ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  164 |     // Scrolling is handled by SimpleBar on `.field-dialog-scroll` (the grid's
  165 |     // wrapper), not by native overflow on `.field-dialog-grid` itself.
  166 |     const scrollRoot = dialog.locator(".field-dialog-scroll");
  167 |     await expect(scrollRoot).toHaveAttribute("data-simplebar", "init");
  168 |     const contentWrapper = scrollRoot.locator(".simplebar-content-wrapper");
  169 |     const gridOverflows = await contentWrapper.evaluate((el) => el.scrollHeight > el.clientHeight);
  170 |     expect(gridOverflows).toBe(true);
  171 | 
  172 |     const windowScrollable = await page.evaluate(
  173 |       () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
  174 |     );
  175 |     expect(windowScrollable).toBe(false);
  176 |   });
```