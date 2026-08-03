import { expect, test } from "@playwright/test";

/** Reads `useFetch()`'s IndexedDB cache (see `status/build-cache.md`) for
 * any key starting with `prefix` - used to confirm a page actually wrote a
 * cache entry, without depending on the exact key format. */
async function readCacheEntry(page: import("@playwright/test").Page, prefix: string): Promise<{ version: number; cachedAt: number } | null> {
  return page.evaluate((keyPrefix) => {
    return new Promise((resolve) => {
      const request = indexedDB.open("drycms-cache");
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("cache", "readonly");
        const getAll = tx.objectStore("cache").getAll();
        getAll.onsuccess = () => {
          const match = (getAll.result as { key: string; version: number; cachedAt: number }[]).find((entry) =>
            entry.key.startsWith(keyPrefix),
          );
          resolve(match ? { version: match.version, cachedAt: match.cachedAt } : null);
        };
        getAll.onerror = () => resolve(null);
      };
    });
  }, prefix);
}

test.describe("Content entries list - IndexedDB cache + background sync (status/build-cache.md)", () => {
  test("writes an IndexedDB cache entry after loading the Roles list, and renders from it instantly on a slow-network revisit", async ({
    page,
  }) => {
    await page.goto("/dry/content/role");
    await expect(page.locator("table")).toBeVisible();
    // `setCacheEntry`'s IndexedDB transaction commits asynchronously right
    // after the state update that makes the row visible - give it a moment
    // to actually land before reading it back below.
    await page.waitForTimeout(500);

    // Prefix only, not the full key: `ContentEntryList.tsx` uses a paginated
    // `entries:role:list:...` key normally, but switches to one fixed
    // `entries:role:all` key when `content.engine === "file"` (see
    // `useClientSearch` there) - this test should pass under either.
    const cached = await readCacheEntry(page, "entries:role:");
    expect(cached).not.toBeNull();
    expect(typeof cached!.version).toBe("number");

    // Delay every GET to /api/content/role so the ONLY way the table could
    // show rows before the delay elapses is the IndexedDB cache-first render
    // - a real background-sync round trip is still allowed to land later.
    await page.route("**/api/content/role**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });

    await page.reload();
    // Rendered from cache well before the 3s network delay would allow a
    // real response - `loading` never shows because IndexedDB already had
    // this key, so this line failing would mean cache-first rendering broke.
    await expect(page.locator("table")).toBeVisible({ timeout: 1000 });
  });

  test("creating a new role entry is reflected after navigating back to the list (functional regression check for the useFetch migration)", async ({
    page,
  }) => {
    await page.goto("/dry/content/role");
    await expect(page.locator("table")).toBeVisible();

    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL("**/content/role/new");

    const uniqueName = `E2E Role ${Date.now()}`;
    await page.getByLabel("Name").fill(uniqueName);
    await page.getByRole("button", { name: "Save" }).click();

    // Saving a new entry navigates straight back to the list.
    await page.waitForURL("**/content/role");
    await expect(page.getByText(uniqueName)).toBeVisible();
  });

  test("background sync finds a newly-created role without showing a toast", async ({
    page,
  }) => {
    // First visit: no prior cache, so this is a cold load - must NOT flash
    // (see `useFetch.ts`'s `notifyOnChange = hadCache`).
    await page.goto("/dry/content/role");
    await expect(page.locator("table")).toBeVisible();
    // Bump the resource's data version behind the scenes (same technique as
    // `deleteContentType` elsewhere - an in-page fetch, same-origin).
    const uniqueName = `Sync Flash Role ${Date.now()}`;
    const status = await page.evaluate(
      async (name) => {
        const response = await fetch("/dry/api/content/role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, isSuperAdmin: false, permissions: [] }),
        });
        return response.status;
      },
      uniqueName,
    );
    expect(status).toBe(201);

    // Revisiting renders the (now stale) cache instantly, then the
    // background sync detects the version bump and the new row is rendered.
    await page.reload();
    await expect(page.getByText(uniqueName)).toBeVisible();
    await expect(page.locator(".toast")).toHaveCount(0);
  });
});
