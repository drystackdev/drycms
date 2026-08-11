import { expect, test } from "@playwright/test";

test.describe("RichText pasted content", () => {
  test("cleans pasted styles, uploads a pasted image into Entry, and replaces its blob URL", async ({ page }) => {
    await page.goto("/dry/content/blog/new");

    const editor = page.locator(".richtext-content-host .dry-tx-content");
    await expect(editor).toBeVisible();

    await editor.evaluate((element) => {
      const data = new DataTransfer();
      data.setData(
        "text/html",
        '<p style="font-family: serif; margin: 40px; text-align: center"><span style="font-size: 42px; background-color: yellow; color: red; font-weight: normal">Pasted text</span></p>',
      );
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    });

    const pastedParagraph = editor.locator("p", { hasText: "Pasted text" });
    await expect(pastedParagraph).toBeVisible();
    const pastedText = pastedParagraph.locator("span", { hasText: "Pasted text" });
    await expect(pastedText).toHaveAttribute("style", /color:\s*red/);
    const cleanedStyle = await pastedText.getAttribute("style");
    expect(cleanedStyle).not.toMatch(/font-size|font-family|background|margin|font-weight/);

    const filename = `pasted-${Date.now()}.png`;
    await editor.evaluate((element, name) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    }, filename);

    const dialog = page.getByRole("dialog", { name: "Upload pasted image" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(filename);
    await dialog.getByRole("button", { name: "Upload" }).click();
    await expect(dialog).toBeHidden();

    const image = editor.locator(`img[alt="${filename}"]`);
    await expect(image).toHaveAttribute("src", new RegExp(`/dry/api/storage/\\.tmp\\.blog\\.[^/]+/${filename}$`));

    const stored = await page.evaluate(async (name) => {
      const response = await fetch("/dry/api/storage/.tmp.blog.e2e-admin-example-test");
      if (!response.ok) return [];
      const body = (await response.json()) as { entries: { name: string }[] };
      return body.entries.map((entry) => entry.name);
    }, filename);
    expect(stored).toContain(filename);
  });
});
