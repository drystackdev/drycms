import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalStorageAdapter } from "../storage/local.js";
import { SAMPLE_PAGES_SOURCE_FILES } from "../server/app-router/sample-pages-source.js";
import { seedPagesSourceIfEmpty } from "./seed-pages-source.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-seed-pages-source-"));
  dirs.push(dir);
  return createLocalStorageAdapter(dir);
}

describe("seedPagesSourceIfEmpty", () => {
  it("has a non-empty starter manifest to seed with", () => {
    expect(SAMPLE_PAGES_SOURCE_FILES.length).toBeGreaterThan(0);
    expect(SAMPLE_PAGES_SOURCE_FILES.some((f) => f.path === "pages/page.tsx")).toBe(true);
    expect(SAMPLE_PAGES_SOURCE_FILES.some((f) => f.path === "pages/layout.tsx")).toBe(true);
    expect(SAMPLE_PAGES_SOURCE_FILES.some((f) => f.path === "pages/about/page.tsx")).toBe(true);
    expect(SAMPLE_PAGES_SOURCE_FILES.some((f) => f.path === "component/ThemeToggle.tsx")).toBe(true);
  });

  it("seeds every sample file into a completely empty store and reports true", async () => {
    const adapter = tempAdapter();
    await expect(seedPagesSourceIfEmpty(adapter)).resolves.toBe(true);

    for (const file of SAMPLE_PAGES_SOURCE_FILES) {
      const read = await adapter.read(file.path);
      const chunks: Buffer[] = [];
      for await (const chunk of read.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString("utf-8")).toBe(file.content);
    }
  });

  it("no-ops and reports false when the store already has ANY content", async () => {
    const adapter = tempAdapter();
    await adapter.write("pages/page.tsx", new TextEncoder().encode("existing real content"));

    await expect(seedPagesSourceIfEmpty(adapter)).resolves.toBe(false);

    const read = await adapter.read("pages/page.tsx");
    const chunks: Buffer[] = [];
    for await (const chunk of read.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf-8")).toBe("existing real content");

    // Never even attempted the OTHER sample files either.
    await expect(adapter.stat("component")).resolves.toBeNull();
  });
});
