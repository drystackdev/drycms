import { expect, test, type Page } from "@playwright/test";

/**
 * Git-mirrored content history (`plans/history-content.md`). `global-setup.ts`
 * now saves a `githubSync` repo/branch/token as part of the standard e2e
 * account bootstrap (a deliberately INVALID token, never a real credential) -
 * satisfies the mandatory `/dry/github-setup` redirect every fresh Super
 * Admin hits (`routers/App.tsx`), and means every sync attempt below is a
 * REAL (fast: outbound `api.github.com` rejects a bad token in well under a
 * second, no slow network hang) GitHub API call that then fails on the
 * token - exercising the actual retry-then-offer-a-reset path
 * (`entry-git-sync.ts`), not just the `notConfigured` short-circuit a
 * truly-unconfigured tenant would hit.
 *
 * ONE test, not several independent ones (unlike this repo's other e2e
 * specs) - a pre-existing, unrelated infra quirk in the current WIP tree:
 * the e2e admin's session does not reliably survive a FRESH page load from
 * `storageState.json` past the first one in a run (a later `test()` block
 * can land back on `/dry/login` even though the saved storage state is
 * valid and an earlier test consumed it fine). Every step below
 * deliberately reuses the SAME `page` so the session is only ever loaded
 * once. Worth revisiting/re-splitting once that's fixed upstream.
 */

/** Creates a fresh collection with one text field ("Headline" - "Title" is
 * a reserved field name, see `naming.ts`), applies it so it's live/
 * queryable, same "Add" dialog flow `content-type-editor.spec.ts`'s own
 * `createTestCollection` uses - trimmed to just what these tests need (a
 * git-mirror-eligible type to save entries against). Returns the API `name`
 * (the `/dry/content/<name>` URL segment - the label's derived slug, NOT
 * the display label) and `id` (for cleanup). */
async function createTestCollection(page: Page): Promise<{ id: string; name: string; label: string }> {
  await page.goto("/dry/content-types/");
  const label = `E2E History ${Date.now()}`;

  await page.getByRole("button", { name: "Add" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add collection" });
  await addDialog.getByLabel("Table Name*", { exact: true }).fill(label);

  await addDialog.getByRole("button", { name: "Add Field" }).click();
  const fieldDialog = page.getByRole("dialog", { name: "Add field" });
  await fieldDialog.getByRole("button", { name: "Select…" }).click();
  await page.getByRole("option", { name: "Text", exact: true }).click();
  await fieldDialog.getByLabel("Label*", { exact: true }).fill("Headline");
  await fieldDialog.getByRole("button", { name: "Save field" }).click();
  await expect(fieldDialog).toBeHidden();

  await addDialog.getByRole("button", { name: "Save draft" }).click();
  await expect(addDialog).toBeHidden();

  await page.locator(".page-header").getByRole("button", { name: "Apply Builder" }).click();
  const applyDialog = page.getByRole("dialog", { name: "Apply and build" });
  await applyDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(applyDialog).toContainText("No conflicts found");
  await applyDialog.getByRole("button", { name: "Save" }).click();
  await expect(applyDialog).toBeHidden();

  const definition = await page.evaluate(async (title) => {
    const response = await fetch("/dry/api/content-types");
    const body = (await response.json()) as { definitions: { id: string; name: string; label: string }[] };
    return body.definitions.find((d) => d.label === title);
  }, label);
  if (!definition) throw new Error("Could not find the newly-applied content type via the API.");
  return { id: definition.id, name: definition.name, label };
}

async function deleteContentType(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (deleteId) => fetch(`/dry/api/content-types/${encodeURIComponent(deleteId)}`, { method: "DELETE" }),
    id,
  );
}

test("Content history (git mirror): save/edit/delete regression, History dialog, and the retry-then-reset flow", async ({ page }) => {
  test.slow(); // several real (fast, but non-zero) GitHub API round trips plus 2 retry backoffs
  const { id, name, label } = await createTestCollection(page);

  try {
    // Step 1 - saving a new entry returns/navigates immediately, without
    // waiting on the (slow, failing) background git sync (decision #1,
    // `plans/history-content.md`). The full retry cycle for a failing sync
    // takes ~5s+ (3 backoff delays); this must resolve in a small fraction
    // of that, or the D1 response/navigation regressed to waiting on the
    // git commit instead of firing it in the background.
    await page.goto(`/dry/content/${name}`);
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(`**/content/${name}/new`);
    const firstTitle = `Entry ${Date.now()}`;
    await page.getByLabel("Headline").fill(firstTitle);
    const startedAt = Date.now();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(`**/content/${name}`);
    expect(Date.now() - startedAt).toBeLessThan(3000);
    await expect(page.getByText(firstTitle)).toBeVisible();

    // Step 2 - the entry editor's History button opens a dialog that
    // surfaces the (real, failing) git error inline rather than hanging or
    // crashing. A bad token means the commits LIST call fails too (same
    // `loadGithubSyncConfig` config as the write side).
    await page.getByText(firstTitle).click();
    await page.waitForURL(new RegExp(`/content/${name}/[^/]+$`));
    await page.getByRole("button", { name: "History" }).click();
    const historyDialog = page.getByRole("dialog", { name: /History/ });
    await expect(historyDialog).toBeVisible();
    await expect(historyDialog.locator(".error")).toBeVisible({ timeout: 10_000 });
    await historyDialog.getByRole("button", { name: "Close" }).click();
    await expect(historyDialog).toBeHidden();

    // Step 3 - editing and deleting an existing entry both still work
    // end-to-end (D1 write is independent of the background git sync).
    const updatedTitle = `Updated ${Date.now()}`;
    await page.getByLabel("Headline").fill(updatedTitle);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(`**/content/${name}`);
    await expect(page.getByText(updatedTitle)).toBeVisible();

    await page.getByText(updatedTitle).click();
    await page.waitForURL(new RegExp(`/content/${name}/[^/]+$`));
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await page.waitForURL(`**/content/${name}`);
    await expect(page.getByText(updatedTitle)).toHaveCount(0);

    // Step 4 - a brand-new, unsaved entry shows no History button (nothing
    // to show history for yet).
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(`**/content/${name}/new`);
    await expect(page.getByRole("button", { name: "History" })).toHaveCount(0);

    // Step 5 - when the git sync keeps failing after every retry,
    // `DryLayout` offers a reset that undoes the save (the create from this
    // step, so its rollback removes the row again). `pendingContentSyncs`
    // is a FIFO queue, and steps 1 and 3's own saves have almost certainly
    // already failed and queued their own entries by now (their ~5s retry
    // window elapsed several real steps ago) - drain those first so the
    // dialog this step waits for is unambiguously its OWN entry, not an
    // earlier one. "Keep as-is" only dismisses the notification, it never
    // touches D1 - harmless to steps 1/3's own already-asserted outcomes.
    let drained = 0;
    while (await page.getByRole("dialog", { name: "Content sync failed" }).isVisible().catch(() => false)) {
      await page.getByRole("dialog", { name: "Content sync failed" }).getByRole("button", { name: "Keep as-is" }).click();
      drained += 1;
      if (drained > 5) break;
    }

    const resetTitle = `Reset Me ${Date.now()}`;
    await page.getByLabel("Headline").fill(resetTitle);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(`**/content/${name}`);
    await expect(page.getByText(resetTitle)).toBeVisible();

    const resetDialog = page.getByRole("dialog", { name: "Content sync failed" });
    await expect(resetDialog).toBeVisible({ timeout: 15_000 });
    await expect(resetDialog).toContainText(label);
    await resetDialog.getByRole("button", { name: "Reset" }).click();
    await expect(resetDialog).toBeHidden();

    await page.reload();
    await expect(page.getByText(resetTitle)).toHaveCount(0);
  } finally {
    await deleteContentType(page, id);
  }
});
