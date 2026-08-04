import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveGlobalsCssHref } from "./assets.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function writeManifest(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "drycms-assets-manifest-"));
  dirs.push(dir);
  const path = join(dir, "manifest.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe("resolveGlobalsCssHref", () => {
  it("returns the dev source path without touching the filesystem", () => {
    expect(resolveGlobalsCssHref(true, "/does/not/exist.json")).toBe("/src/apps/globals.css");
  });

  it("reads the built, hashed asset path from the manifest in production", () => {
    const path = writeManifest({
      "src/apps/globals.css": { file: "assets/appsGlobals-abc123.css" },
    });
    expect(resolveGlobalsCssHref(false, path)).toBe("/assets/appsGlobals-abc123.css");
  });

  it("throws a clear error when the manifest has no globals.css entry", () => {
    const path = writeManifest({ "index.html": { file: "assets/main-def456.js" } });
    expect(() => resolveGlobalsCssHref(false, path)).toThrow(/src\/apps\/globals\.css/);
  });
});
