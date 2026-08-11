import { expect, test } from "@playwright/test";

/** Same helper as `entries-cache.spec.ts` - reads `useFetch()`'s IndexedDB
 * cache for any key starting with `prefix`. */
async function readCacheEntry(page: import("@playwright/test").Page, prefix: string): Promise<{ version: number } | null> {
  return page.evaluate((keyPrefix) => {
    return new Promise((resolve) => {
      const request = indexedDB.open("drycms-cache");
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("cache", "readonly");
        const getAll = tx.objectStore("cache").getAll();
        getAll.onsuccess = () => {
          const match = (getAll.result as { key: string; version: number }[]).find((entry) => entry.key.startsWith(keyPrefix));
          resolve(match ? { version: match.version } : null);
        };
        getAll.onerror = () => resolve(null);
      };
    });
  }, prefix);
}

test.describe("Content Types list - IndexedDB cache + background sync (status/build-cache.md)", () => {
  test("writes an IndexedDB cache entry after loading Content Types, and renders from it instantly on a slow-network revisit", async ({
    page,
  }) => {
    await page.goto("/dry/content-types/");
    // The list is a card grid now (`.builder-collection-card`), not a table.
    await expect(page.locator(".builder-collection-card").filter({ hasText: "Menu" })).toBeVisible();
    await page.waitForTimeout(500);

    const cached = await readCacheEntry(page, "content-types:list");
    expect(cached).not.toBeNull();
    expect(typeof cached!.version).toBe("number");

    await page.route("**/api/content-types**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });

    await page.reload();
    await expect(page.locator(".builder-collection-card").filter({ hasText: "Menu" })).toBeVisible({ timeout: 1000 });
  });
});
