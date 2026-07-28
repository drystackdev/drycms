# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: content-type-editor.spec.ts >> Content Type editor >> Add Field dialog scrolls its own body instead of the window when content overflows
- Location: e2e/content-type-editor.spec.ts:153:3

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
> 156 |     await page.getByLabel("Title", { exact: true }).fill("Scroll Test");
      |                                                     ^ Error: locator.fill: Test timeout of 30000ms exceeded.
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
  175 | 
  176 |   test("Remove field shows a confirm dialog before removing", async ({ page }) => {
  177 |     const { id } = await createTestCollection(page);
  178 |     try {
  179 |       await addTextField(page, "Removable");
  180 |       await page.getByRole("button", { name: "Remove" }).click();
  181 |       const confirm = page.getByRole("dialog", { name: /Remove "Removable"/ });
  182 |       await expect(confirm).toBeVisible();
  183 |       await confirm.getByRole("button", { name: "Remove" }).click();
  184 |       await expect(page.getByText("Removable")).toHaveCount(0);
  185 |     } finally {
  186 |       await deleteContentType(page, id);
  187 |     }
  188 |   });
  189 | 
  190 |   test("Editing an existing content type shows the apply-schema confirm before saving", async ({ page }) => {
  191 |     const { id } = await createTestCollection(page);
  192 |     try {
  193 |       await page.getByRole("button", { name: "Save & apply schema" }).click();
  194 |       const confirm = page.getByRole("dialog", { name: "Apply schema changes?" });
  195 |       await expect(confirm).toBeVisible();
  196 |       await confirm.getByRole("button", { name: "Save & apply" }).click();
  197 |       await page.waitForURL("**/dry/content-types");
  198 |     } finally {
  199 |       await deleteContentType(page, id);
  200 |     }
  201 |   });
  202 | 
  203 |   test("Fields list: system rows have no click-to-edit/Remove, ID has no drag handle, Title does", async ({
  204 |     page,
  205 |   }) => {
  206 |     const { id } = await createTestCollection(page, { slug: true });
  207 |     try {
  208 |       const list = page.locator(".content-type-editor-grid ul.content-type-list");
  209 |       const idRow = list.locator("li", { hasText: "ID" }).first();
  210 |       const titleRow = list.locator("li", { hasText: "Title" }).first();
  211 | 
  212 |       await expect(idRow.getByRole("button", { name: "Reorder" })).toHaveCount(0);
  213 |       await expect(idRow.getByRole("button", { name: "Remove" })).toHaveCount(0);
  214 |       await expect(titleRow.getByRole("button", { name: "Reorder" })).toBeVisible();
  215 |       await expect(titleRow.getByRole("button", { name: "Remove" })).toHaveCount(0);
  216 | 
  217 |       // Clicking a system row does nothing (no dialog opens).
  218 |       await idRow.click();
  219 |       await expect(page.getByRole("dialog")).toBeHidden();
  220 |     } finally {
  221 |       await deleteContentType(page, id);
  222 |     }
  223 |   });
  224 | 
  225 |   test("Dragging a field's handle reorders the unified fields list", async ({ page }) => {
  226 |     const { id } = await createTestCollection(page);
  227 |     try {
  228 |       await addTextField(page, "First");
  229 |       await addTextField(page, "Second");
  230 | 
  231 |       const list = page.locator(".content-type-editor-grid ul.content-type-list");
  232 |       const firstHandle = list.locator("li", { hasText: "First" }).getByRole("button", { name: "Reorder" });
  233 |       const secondRow = list.locator("li", { hasText: "Second" });
  234 | 
  235 |       const firstBox = await firstHandle.boundingBox();
  236 |       const secondBox = await secondRow.boundingBox();
  237 |       if (!firstBox || !secondBox) throw new Error("rows not found");
  238 | 
  239 |       await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  240 |       await page.mouse.down();
  241 |       for (let i = 1; i <= 8; i++) {
  242 |         await page.mouse.move(
  243 |           firstBox.x + firstBox.width / 2,
  244 |           firstBox.y + firstBox.height / 2 + (i * (secondBox.y - firstBox.y + secondBox.height)) / 8,
  245 |         );
  246 |         await page.waitForTimeout(15);
  247 |       }
  248 |       await page.mouse.up();
  249 | 
  250 |       const rows = await list.locator("li").allTextContents();
  251 |       const firstIndex = rows.findIndex((t) => t.includes("First"));
  252 |       const secondIndex = rows.findIndex((t) => t.includes("Second"));
  253 |       expect(secondIndex).toBeLessThan(firstIndex);
  254 |     } finally {
  255 |       await deleteContentType(page, id);
  256 |     }
```