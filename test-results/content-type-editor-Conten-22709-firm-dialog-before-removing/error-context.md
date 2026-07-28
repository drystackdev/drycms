# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: content-type-editor.spec.ts >> Content Type editor >> Remove field shows a confirm dialog before removing
- Location: e2e/content-type-editor.spec.ts:176:3

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
        - generic [ref=e6]:
          - link "DRYCMS" [ref=e7] [cursor=pointer]:
            - /url: /dry/dashboard
          - button "Collapse navigation" [expanded] [ref=e13] [cursor=pointer]
        - navigation "Admin" [ref=e16]:
          - generic [ref=e17]: Manage
          - link "Dashboard" [ref=e18] [cursor=pointer]:
            - /url: /dry/dashboard
          - link "Showcase" [ref=e23] [cursor=pointer]:
            - /url: /dry/showcase
          - link "Content Types" [ref=e30] [cursor=pointer]:
            - /url: /dry/content-types
          - generic [ref=e35]:
            - generic [ref=e36]:
              - link "Content" [ref=e37] [cursor=pointer]:
                - /url: /dry/content
              - button "Collapse Content menu" [expanded] [ref=e42] [cursor=pointer]
            - link "Blog" [ref=e46] [cursor=pointer]:
              - /url: /dry/content/blog
          - link "Media" [ref=e48] [cursor=pointer]:
            - /url: /dry/media
          - link "Users" [ref=e54] [cursor=pointer]:
            - /url: /dry/content/user
          - generic:
            - generic: Settings
            - generic: Soon
        - generic [ref=e61]:
          - text: Mounted at
          - code [ref=e62]: /dry
    - generic [ref=e64]:
      - banner [ref=e65]:
        - button "System theme" [ref=e66] [cursor=pointer]
      - main [ref=e70]:
        - generic [ref=e71]:
          - button [ref=e72] [cursor=pointer]
          - generic [ref=e75]:
            - heading "New Collection" [level=1] [ref=e76]
            - paragraph [ref=e77]: Define the fields, data types, and structure used to store content for this content type.
          - generic [ref=e78]:
            - button "Cancel" [ref=e79] [cursor=pointer]
            - button "Save & apply schema" [ref=e80] [cursor=pointer]
        - generic [ref=e81]:
          - generic [ref=e83]:
            - generic [ref=e84]:
              - generic [ref=e85]:
                - heading "Fields Collection" [level=3] [ref=e86]:
                  - text: Fields
                  - generic [ref=e87]: Collection
                - text: Define the columns used for data entry and storage
              - button "Add Field" [ref=e88] [cursor=pointer]
            - list [ref=e91]:
              - listitem [ref=e92]:
                - button [disabled]
                - generic [ref=e93]:
                  - generic [ref=e94]:
                    - text: ID
                    - generic [ref=e95]: Number
                    - generic [ref=e96]: System
                  - generic [ref=e97]: id
            - generic [ref=e98]: "Total: 1 field - 0 feature - 0 required"
          - generic [ref=e99]:
            - generic [ref=e100]:
              - generic [ref=e101]:
                - generic [ref=e102]: Table Name*
                - textbox "Table Name*" [ref=e103]:
                  - /placeholder: e.g. Blog Posts
              - generic [ref=e104]:
                - generic [ref=e105]: Table
                - generic [ref=e106]:
                  - textbox "Table" [ref=e107]:
                    - /placeholder: e.g. blog_posts
                  - button "Regenerate slug from title" [ref=e108] [cursor=pointer]
            - generic [ref=e112]:
              - generic [ref=e113]: Description
              - textbox "Description" [ref=e114]:
                - /placeholder: e.g. Articles published on the company blog
              - generic [ref=e115]: Optional description for this content type, shown in the admin UI.
            - generic [ref=e116]:
              - generic [ref=e117]: Live Preview
              - textbox "Live Preview" [ref=e118]:
                - /placeholder: "e.g. https://example.com/posts/{slug}"
              - generic [ref=e119]: URL the entry editor will open for a live preview.
            - group "Features" [ref=e120]:
              - generic [ref=e122]:
                - generic [ref=e125]:
                  - switch "Slug Adds a URL-friendly Slug field, and a Title field to go with it." [ref=e126] [cursor=pointer]
                  - generic [ref=e127] [cursor=pointer]:
                    - text: Slug
                    - generic [ref=e128]: Adds a URL-friendly Slug field, and a Title field to go with it.
                - generic [ref=e131]:
                  - switch "Draft Lets you save an entry as a private draft before publishing it." [ref=e132] [cursor=pointer]
                  - generic [ref=e133] [cursor=pointer]:
                    - text: Draft
                    - generic [ref=e134]: Lets you save an entry as a private draft before publishing it.
                - generic [ref=e137]:
                  - switch "Schedule Lets you set a future date/time for an entry to go live automatically." [ref=e138] [cursor=pointer]
                  - generic [ref=e139] [cursor=pointer]:
                    - text: Schedule
                    - generic [ref=e140]: Lets you set a future date/time for an entry to go live automatically.
                - generic [ref=e143]:
                  - switch "Full-text search Makes every text field on this content type searchable." [ref=e144] [cursor=pointer]
                  - generic [ref=e145] [cursor=pointer]:
                    - text: Full-text search
                    - generic [ref=e146]: Makes every text field on this content type searchable.
                - generic [ref=e149]:
                  - switch "Timestamps Automatically records when each entry was created and last updated." [ref=e150] [cursor=pointer]
                  - generic [ref=e151] [cursor=pointer]:
                    - text: Timestamps
                    - generic [ref=e152]: Automatically records when each entry was created and last updated.
                - generic [ref=e155]:
                  - switch "SEO Adds Title, Description, and Image fields for search engines and social previews." [ref=e156] [cursor=pointer]
                  - generic [ref=e157] [cursor=pointer]:
                    - text: SEO
                    - generic [ref=e158]: Adds Title, Description, and Image fields for search engines and social previews.
                - generic [ref=e161]:
                  - switch "Sortable Lets you manually drag-reorder this collection's entries." [ref=e162] [cursor=pointer]
                  - generic [ref=e163] [cursor=pointer]:
                    - text: Sortable
                    - generic [ref=e164]: Lets you manually drag-reorder this collection's entries.
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
> 12  |   await page.getByLabel("Title", { exact: true }).fill(uniqueTitle);
      |                                                   ^ Error: locator.fill: Test timeout of 30000ms exceeded.
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
```