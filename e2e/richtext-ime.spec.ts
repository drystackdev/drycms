import { expect, test, type Page } from "@playwright/test";

/**
 * IME (Vietnamese Telex, and every CJK input method) regression coverage for
 * `RichTextField` - see `useRichTextEditor.ts`'s `pendingCompositionChange`.
 *
 * A composition is NOT one keystroke: "tieengs" -> "tiếng" is one composition
 * updated seven times, and prosemirror-view's DOM observer turns each of those
 * updates into its own transaction while the composition is still open. The
 * field used to serialize the whole document to HTML and push it up through
 * `onChange` on every one of them (re-rendering the entire entry form
 * mid-composition), and the resulting `value` round trip could replace the
 * live document out from under the IME - which drops the composition and
 * leaves a half-typed syllable stuck on screen.
 *
 * These drive REAL compositions through CDP's `Input.imeSetComposition`
 * (Chromium only, which is what this suite runs), not synthetic events, so
 * ProseMirror sees exactly what a real IME produces.
 */

const TYPE_NAME = "imeArticle";
const RICH_FIELD_LABEL = "Body";

/** One Vietnamese syllable as its IME sees it: the composition text after
 * each keystroke, ending in the committed form. */
const SYLLABLES: Record<string, string[]> = {
  "tiếng": ["t", "ti", "tie", "tiê", "tiên", "tiêng", "tiếng"],
  "Trường": ["T", "Tr", "Tru", "Trươ", "Trươn", "Trường"],
  "Nguyễn": ["N", "Ng", "Ngu", "Nguy", "Nguyê", "Nguyên", "Nguyễn"],
};

/** Idempotent: `beforeAll` runs once per worker, and this suite is big enough
 * that Playwright gives it more than one - the second attempt to create the
 * same type is a 400, which is fine as long as the type ends up there. */
async function createRichTextType(page: Page): Promise<void> {
  const status = await page.evaluate(
    async ([name, fieldLabel]) => {
      const response = await fetch("/dry/api/content-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          definition: {
            kind: "collection",
            name,
            label: "IME Article",
            features: { slug: true },
            fields: [
              {
                id: "ime-body",
                name: "body",
                label: fieldLabel,
                type: "richtext",
                config: {},
                validation: {},
                order: 0,
              },
            ],
          },
        }),
      });
      return response.status;
    },
    [TYPE_NAME, RICH_FIELD_LABEL] as const,
  );

  if (status === 200) return;

  // Someone else got there first (or thinks they did) - confirm rather than
  // fail. Polled: the schema list is cached per version, so a read taken the
  // instant after another worker's write can still miss it.
  await expect
    .poll(
      () =>
        page.evaluate(async (name) => {
          const body = (await (await fetch("/dry/api/content-types")).json()) as {
            definitions?: { name: string }[];
          };
          return !!body.definitions?.some((definition) => definition.name === name);
        }, TYPE_NAME),
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** Focused, mounted `.dry-tx-content` (it lives in a shadow root, which
 * Playwright's CSS selectors pierce). */
async function focusEditor(page: Page) {
  const content = page.locator(".dry-tx-content");
  await expect(content).toBeVisible();
  await content.click();
  return content;
}

/** Watches the editor for the one thing a composition cannot survive: its
 * paragraph being torn out and rebuilt (what a whole-document `replaceWith`
 * does). Normal typing only mutates the composing text node's `characterData`. */
async function watchForDocumentReplacement(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as unknown as { __imeReplacements: number };
    win.__imeReplacements = 0;
    const host = document.querySelector(".richtext-content-host");
    const content = host?.shadowRoot?.querySelector(".dry-tx-content");
    if (!content) throw new Error("Editor content element not found");
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList" && record.removedNodes.length > 0) win.__imeReplacements++;
      }
    }).observe(content, { childList: true, subtree: false });
  });
}

async function composeSyllables(page: Page, words: string[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (let i = 0; i < words.length; i++) {
      const steps = SYLLABLES[words[i]!]!;
      for (const text of steps) {
        await cdp.send("Input.imeSetComposition", {
          text,
          selectionStart: text.length,
          selectionEnd: text.length,
        });
      }
      // Committing the composition - what Space/Enter does on a real IME.
      await cdp.send("Input.insertText", { text: i === words.length - 1 ? steps.at(-1)! : `${steps.at(-1)!} ` });
    }
  } finally {
    await cdp.detach();
  }
}

/**
 * The OTHER kind of Vietnamese IME, and the one most people actually use:
 * EVKey / OpenKey / Unikey / GoTiengViet don't compose at all. They backspace
 * over what they already committed and re-insert the accented form - several
 * separate DOM edits within a millisecond or two of the triggering keystroke.
 * Anything expensive running synchronously in between loses the edits still
 * queued, and the accent lands twice or in the wrong place ("nội dung" ->
 * "noọội dung"). See `VALUE_FLUSH_DELAY_MS` in `useRichTextEditor.ts`.
 *
 * `[backspaces, insert]` per keystroke, spelling "tiếng Việt".
 */
const REWRITE_STREAM: [number, string][] = [
  [0, "t"], [0, "i"], [0, "e"], [1, "ê"], [0, "n"], [0, "g"], [3, "ếng"],
  [0, " "],
  [0, "V"], [0, "i"], [0, "e"], [1, "ê"], [1, "ệ"], [0, "t"],
];

async function rewriteType(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const backspace = {
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
    key: "Backspace",
    code: "Backspace",
  };
  try {
    for (const [backspaces, insert] of REWRITE_STREAM) {
      for (let i = 0; i < backspaces; i++) {
        await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...backspace });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...backspace });
      }
      await cdp.send("Input.insertText", { text: insert });
      // Human pacing between keystrokes; the rewrite burst above is not paced,
      // because a real IME doesn't pace it either.
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  } finally {
    await cdp.detach();
  }
}

test.describe("RichTextField - IME composition (Vietnamese Telex)", () => {
  // These reproduce a timing race on purpose, and the rest of the suite runs
  // beside them on the same server - under that much CPU contention a real
  // pass can still miss its window. Retried rather than loosened: the exact
  // text is the whole assertion.
  test.describe.configure({ mode: "serial", retries: 2 });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/dry/content-types");
    await createRichTextType(page);
    await page.close();
  });

  test("composes Vietnamese syllables without garbling them or rebuilding the document mid-composition", async ({
    page,
  }) => {
    await page.goto(`/dry/content/${TYPE_NAME}/new`);
    await focusEditor(page);
    await watchForDocumentReplacement(page);

    await composeSyllables(page, ["tiếng", "Trường", "Nguyễn"]);

    // The composed text survives verbatim - a composition broken partway
    // through leaves the raw Telex keystrokes ("tieengs") or a truncated
    // syllable behind instead.
    await expect(page.locator(".dry-tx-content")).toHaveText("tiếng Trường Nguyễn");

    const replacements = await page.evaluate(
      () => (window as unknown as { __imeReplacements: number }).__imeReplacements,
    );
    expect(replacements).toBe(0);
  });

  test("reports the composed value to the form - it saves and reloads intact", async ({ page }) => {
    await page.goto(`/dry/content/${TYPE_NAME}/new`);
    // `SlugField` renders a "Regenerate slug from title" button alongside the
    // Title input, so match the textbox specifically (its accessible name
    // carries the required marker).
    await page.getByRole("textbox", { name: /^Title/ }).fill(`IME entry ${Date.now()}`);
    await focusEditor(page);

    await composeSyllables(page, ["Nguyễn", "Trường"]);
    // `onChange` is deliberately withheld until the composition ends, so this
    // asserts the flush actually happens (and lands in the saved row) rather
    // than the pre-composition text being what the form held.
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(`**/content/${TYPE_NAME}`);

    const saved = await page.evaluate(async (typeName) => {
      const list = (await (await fetch(`/dry/api/content/${typeName}`)).json()) as {
        rows?: { id: string }[];
      };
      // The list projection leaves richtext columns out (they'd bloat every
      // row), so read the entry itself back for the actual body.
      const id = list.rows?.at(-1)?.id ?? null;
      if (!id) return { id, body: "" };
      const detail = (await (await fetch(`/dry/api/content/${typeName}/${id}`)).json()) as {
        entry?: { value: Record<string, unknown> };
      };
      return { id, body: String(detail.entry?.value?.body ?? "") };
    }, TYPE_NAME);
    expect(saved.id).not.toBeNull();
    expect(saved.body).toContain("Nguyễn Trường");

    // ...and comes back out of the editor the same way.
    await page.goto(`/dry/content/${TYPE_NAME}/${saved.id}`);
    await expect(page.locator(".dry-tx-content")).toHaveText("Nguyễn Trường");
  });

  test("survives a rewriting IME (EVKey/OpenKey/Unikey) - accents land once, in the right place", async ({
    page,
  }) => {
    // Repeated: the failure this guards is a race, so a single clean run
    // proves nothing. Synchronous `onChange` measured 5/8 here; the debounce
    // in `useRichTextEditor.ts` takes it to 8/8.
    const results: string[] = [];
    for (let run = 0; run < 6; run++) {
      // The entry-draft autosave would otherwise restore the previous run's
      // text into this one. Skipped on the first pass: there's no draft yet,
      // and the page has no origin to reach IndexedDB from either.
      if (run > 0) {
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              const request = indexedDB.deleteDatabase("drycms-entry-drafts");
              request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
            }),
        );
      }
      await page.goto(`/dry/content/${TYPE_NAME}/new`);
      await focusEditor(page);
      await rewriteType(page);
      await page.waitForTimeout(300);
      results.push(
        await page.evaluate(
          () =>
            document
              .querySelector(".richtext-content-host")!
              .shadowRoot!.querySelector(".dry-tx-content")!.textContent!,
        ),
      );
    }
    expect(results).toEqual(Array.from({ length: 6 }, () => "tiếng Việt"));
  });
});
