import { afterAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-schedule-flip-test-"));
  return {
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    pagesCacheStorage: { kind: "local", root: join(tempDirBox.path, "pages-cache") },
  };
});

const { runScheduledFlip } = await import("./schedule-flip.js");
const { writeBuiltPage, readBuiltPage } = await import("./built-pages-storage.js");
const { createPagesRegistryAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

const ctx = { env: {} };

describe("runScheduledFlip", () => {
  it("flips a due page's live key to the staged build's bytes, and marks it published in the registry", async () => {
    const registry = createPagesRegistryAdapter(content);
    const now = Date.now();

    // Staged: written to its immutable key only (publishNow: false), not
    // yet reachable via readBuiltPage.
    const { immutableKey } = await writeBuiltPage(ctx, "/promo", "build-1", "<html>promo v2</html>", { publishNow: false });
    await registry.recordBuild(
      { path: "/promo", objectKey: immutableKey, buildId: "build-1", builtAt: now, inSitemap: true, publishAt: now - 1000 },
      [],
    );
    expect(await readBuiltPage(ctx, "/promo")).toBeNull();

    // Not due yet - must be left alone.
    const { immutableKey: futureKey } = await writeBuiltPage(ctx, "/later", "build-2", "<html>later</html>", { publishNow: false });
    await registry.recordBuild(
      { path: "/later", objectKey: futureKey, buildId: "build-2", builtAt: now, inSitemap: true, publishAt: now + 1_000_000 },
      [],
    );

    const flipped = await runScheduledFlip(ctx, registry, now);

    expect(flipped).toEqual(["/promo"]);
    expect(await readBuiltPage(ctx, "/promo")).toBe("<html>promo v2</html>");
    expect(await readBuiltPage(ctx, "/later")).toBeNull();

    const due = await registry.listDueForPublish(now);
    expect(due).toEqual([]); // /promo no longer due - publishAt cleared
    // /later still isn't due at `now` (publishAt is 1000s in the future),
    // so it correctly stays OUT of the sitemap at this moment - only the
    // just-flipped /promo is live.
    const sitemapEntries = await registry.listSitemapEntries(now);
    expect(sitemapEntries.map((e) => e.path)).toEqual(["/promo"]);
  });

  it("is a no-op when nothing is due", async () => {
    const registry = createPagesRegistryAdapter(content);
    const flipped = await runScheduledFlip(ctx, registry, Date.now() - 10_000_000);
    expect(flipped).toEqual([]);
  });
});
