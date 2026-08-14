import { describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({ path: "/dry" }));

const { markAiPageSourceWrite, clearAiPageSourceWrite, listAiPageSourceFlags, getAiPageSourceFlagsVersion } = await import("./ai-page-source-flags.js");

describe("ai-page-source-flags", () => {
  it("flags a page.tsx path, then clears it", async () => {
    await markAiPageSourceWrite("pages/a/page.tsx", {});
    expect((await listAiPageSourceFlags({})).some((f) => f.path === "pages/a/page.tsx")).toBe(true);

    await clearAiPageSourceWrite("pages/a/page.tsx", {});
    expect((await listAiPageSourceFlags({})).some((f) => f.path === "pages/a/page.tsx")).toBe(false);
  });

  it("flags any page-source path, not just page.tsx (layouts, components, styles, md)", async () => {
    for (const path of ["pages/a/layout.tsx", "component/Card.tsx", "styles/globals.css", "md/README.md"]) {
      await markAiPageSourceWrite(path, {});
    }
    const flags = await listAiPageSourceFlags({});
    expect(flags.some((f) => f.path === "pages/a/layout.tsx")).toBe(true);
    expect(flags.some((f) => f.path === "component/Card.tsx")).toBe(true);
    expect(flags.some((f) => f.path === "styles/globals.css")).toBe(true);
    expect(flags.some((f) => f.path === "md/README.md")).toBe(true);
  });

  it("re-flagging the same path replaces it (no duplicate) and refreshes writtenAt", async () => {
    await markAiPageSourceWrite("pages/b/page.tsx", {});
    const first = (await listAiPageSourceFlags({})).find((f) => f.path === "pages/b/page.tsx")!;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await markAiPageSourceWrite("pages/b/page.tsx", {});
    const matches = (await listAiPageSourceFlags({})).filter((f) => f.path === "pages/b/page.tsx");
    expect(matches).toHaveLength(1);
    expect(new Date(matches[0]!.writtenAt).getTime()).toBeGreaterThanOrEqual(new Date(first.writtenAt).getTime());
  });

  describe("version counter (routes/ai-page-source-flags.ts's data-version poll)", () => {
    it("bumps on a real flag/clear, not on a no-op", async () => {
      const before = await getAiPageSourceFlagsVersion({});

      await markAiPageSourceWrite("pages/c/page.tsx", {});
      const afterMark = await getAiPageSourceFlagsVersion({});
      expect(afterMark).toBe(before + 1);

      // A non-page.tsx write bumps too now (scope is every page-source path).
      await markAiPageSourceWrite("component/Unrelated.tsx", {});
      const afterComponentMark = await getAiPageSourceFlagsVersion({});
      expect(afterComponentMark).toBe(afterMark + 1);

      // Clearing something that was never flagged is a no-op.
      await clearAiPageSourceWrite("pages/never-flagged/page.tsx", {});
      expect(await getAiPageSourceFlagsVersion({})).toBe(afterComponentMark);

      await clearAiPageSourceWrite("pages/c/page.tsx", {});
      expect(await getAiPageSourceFlagsVersion({})).toBe(afterComponentMark + 1);
    });
  });
});
