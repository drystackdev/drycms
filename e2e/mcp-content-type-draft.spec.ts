import { expect, test, type Page } from "@playwright/test";

interface McpToolCallResult {
  result?: { content: { type: string; text: string }[]; isError?: boolean };
  error?: { code: number; message: string };
}

/** Calls an MCP tool via `fetch()` run inside the page itself (not
 * Playwright's out-of-process `page.request`) so the call carries the
 * browser's own authenticated session cookie and origin - same reasoning
 * `content-type-editor.spec.ts`'s `deleteContentType` documents for why an
 * in-page `fetch()` is used over `page.request`. No Personal Access Token
 * needs to be minted for this: `mcp` skips CSRF (`server/csrf.ts`) and
 * accepts a plain signed-in session, not only a bearer PAT
 * (`server/handler.ts`'s `if (!session && segment === "mcp")` only kicks in
 * when there's no session already - a cookie-authenticated browser tab
 * always has one). */
async function callMcpTool(page: Page, name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
  return page.evaluate(
    async ({ name, args }) => {
      const response = await fetch("/dry/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      });
      const body = (await response.json()) as { result?: McpToolCallResult["result"]; error?: McpToolCallResult["error"] };
      return { result: body.result, error: body.error };
    },
    { name, args },
  );
}

async function proposeContentType(page: Page, definition: Record<string, unknown>): Promise<McpToolCallResult> {
  return callMcpTool(page, "propose_content_type", { definitionJson: JSON.stringify(definition) });
}

/** Deletes via `fetch()` run inside the page itself, same reasoning as
 * `content-type-editor.spec.ts`'s helper of the same name. */
async function deleteContentType(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (deleteId) => fetch(`/dry/api/content-types/${encodeURIComponent(deleteId)}`, { method: "DELETE" }),
    id,
  );
}

async function findContentTypeIdByName(page: Page, name: string): Promise<string | undefined> {
  return page.evaluate(async (targetName) => {
    const response = await fetch("/dry/api/content-types");
    const body = (await response.json()) as { definitions: { id: string; name: string }[] };
    return body.definitions.find((d) => d.name === targetName)?.id;
  }, name);
}

async function pendingAiDraftNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const response = await fetch("/dry/api/ai-content-type-drafts");
    const body = (await response.json()) as { drafts: { definition: { name: string } }[] };
    return body.drafts.map((draft) => draft.definition.name);
  });
}

test.describe("MCP-proposed content-type drafts", () => {
  test("a proposal shows up for review, badged as AI, and applies through Apply and build", async ({ page }) => {
    await page.goto("/dry/content-types/");
    const name = `e2e-mcp-${Date.now()}`;
    const proposed = await proposeContentType(page, { name, label: "E2E MCP Type", kind: "collection", fields: [] });
    expect(proposed.result?.isError).not.toBe(true);
    expect(await pendingAiDraftNames(page)).toContain(name);

    // A fresh visit is what actually pulls the server-side proposal into
    // this browser's local draft store (`syncAiContentTypeDrafts()` runs on
    // `BuilderContentType` mount) - the tab that made the MCP call above
    // never reloads, so revisit explicitly rather than assume it's already there.
    await page.goto("/dry/content-types/");
    const applyButton = page.locator(".page-header").getByRole("button", { name: "Apply Builder" });
    await expect(applyButton).toBeVisible();
    await applyButton.click();

    const applyDialog = page.getByRole("dialog", { name: "Apply and build" });
    await expect(applyDialog).toContainText("E2E MCP Type");
    await expect(applyDialog.locator(".badge", { hasText: "AI" })).toBeVisible();

    await applyDialog.getByRole("button", { name: "Confirm" }).click();
    await expect(applyDialog).toContainText("No conflicts found");
    await applyDialog.getByRole("button", { name: "Save" }).click();
    await expect(applyDialog).toBeHidden();

    let id: string | undefined;
    try {
      id = await findContentTypeIdByName(page, name);
      expect(id).toBeTruthy();

      // Applying should have cleared the server-side staging draft too.
      expect(await pendingAiDraftNames(page)).not.toContain(name);

      // Confirm it's real from the AI's own side, not just the admin UI.
      const listed = await callMcpTool(page, "list_content_types", {});
      expect(listed.result?.content[0]?.text).toContain(name);
    } finally {
      if (id) await deleteContentType(page, id);
    }
  });

  test("resetting a proposal discards it locally and clears the server-side draft", async ({ page }) => {
    await page.goto("/dry/content-types/");
    const name = `e2e-mcp-reset-${Date.now()}`;
    await proposeContentType(page, { name, label: "E2E MCP Reset", kind: "collection", fields: [] });

    await page.goto("/dry/content-types/");
    const applyButton = page.locator(".page-header").getByRole("button", { name: "Apply Builder" });
    await expect(applyButton).toBeVisible();
    await applyButton.click();

    const applyDialog = page.getByRole("dialog", { name: "Apply and build" });
    await expect(applyDialog).toContainText("E2E MCP Reset");
    await applyDialog.getByRole("button", { name: /^Reset change to/ }).click();
    const confirmReset = page.getByRole("dialog", { name: "Reset this change?" });
    await confirmReset.getByRole("button", { name: "Reset" }).click();
    await expect(applyDialog).toContainText("No pending changes");

    expect(await findContentTypeIdByName(page, name)).toBeFalsy();
    expect(await pendingAiDraftNames(page)).not.toContain(name);
  });
});
