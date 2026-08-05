import { describe, expect, it } from "vitest";
import { runWithDryContext, type DryRequestContext } from "./dry-context.js";
import { params } from "./params-reader.js";
import { setTitle } from "./dry-title.js";
import type { DrySeoLayers } from "./dry-seo.js";

/** `params()`/`setTitle()` only ever read `params`/`seo` off the context -
 * `entries`/`allTypes` are irrelevant here, so they're stubbed rather than
 * standing up a real sqlite adapter like `dry-reader.test.ts` needs to. */
function context(overrides: Partial<DryRequestContext> = {}): DryRequestContext {
  return { entries: {} as never, allTypes: [], ...overrides };
}

describe("params()", () => {
  it("returns the context's route params", async () => {
    await runWithDryContext(context({ params: { slug: "hello-world" } }), () => {
      expect(params()).toEqual({ slug: "hello-world" });
    });
  });

  it("returns a catch-all segment as the string array it was matched as", async () => {
    await runWithDryContext(context({ params: { path: ["a", "b", "c"] } }), () => {
      expect(params().path).toEqual(["a", "b", "c"]);
    });
  });

  it("returns {} when the context never seeded params (existing callers unaffected)", async () => {
    await runWithDryContext(context(), () => {
      expect(params()).toEqual({});
    });
  });

  it("throws outside a render, same as dry()", () => {
    expect(() => params()).toThrow(/outside a request/);
  });

  it("stays isolated between concurrently in-flight renders", async () => {
    // The exact bug `plans/app-router.md`'s original plain-object `Dry.params`
    // sketch would have had - `AsyncLocalStorage` is what makes this pass.
    const seen: string[] = [];
    async function render(slug: string, delayMs: number): Promise<void> {
      await runWithDryContext(context({ params: { slug } }), async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        seen.push(params().slug as string);
      });
    }
    await Promise.all([render("first", 20), render("second", 0)]);
    expect(seen).toEqual(["second", "first"]);
  });
});

describe("setTitle()", () => {
  it("writes into the SEO cascade's highest-priority page layer", async () => {
    const seo: DrySeoLayers = {};
    await runWithDryContext(context({ seo }), () => {
      setTitle("My page title");
    });
    expect(seo.page).toEqual({ metaTitle: "My page title" });
  });

  it("last call wins", async () => {
    const seo: DrySeoLayers = {};
    await runWithDryContext(context({ seo }), () => {
      setTitle("First");
      setTitle("Second");
    });
    expect(seo.page?.metaTitle).toBe("Second");
  });

  it("is a no-op when the context omits seo (existing callers unaffected)", async () => {
    await runWithDryContext(context(), () => {
      expect(() => setTitle("No cascade here")).not.toThrow();
    });
  });

  it("leaves the other cascade layers untouched", async () => {
    const seo: DrySeoLayers = { default: { metaTitle: "Site default" }, entry: { description: "Entry description" } };
    await runWithDryContext(context({ seo }), () => {
      setTitle("Page title");
    });
    expect(seo.default).toEqual({ metaTitle: "Site default" });
    expect(seo.entry).toEqual({ description: "Entry description" });
  });
});
