import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveGlobalsCssHref, resolveHydrateEntryHref, resolveEditLauncherHref } from "./assets.js";
import { resolveOptions } from "../options.js";

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
  it("in dev, points straight at the live pagesSourceStorage file via /@fs/, without touching the filesystem", () => {
    // Dev SSR loads the live pagesSourceStorage stylesheet through Vite.
    const storage = resolveOptions({ kind: "local" }).pagesSource.storage;
    if (storage.kind !== "local") throw new Error("expected a local pagesSource root in tests");
    expect(resolveGlobalsCssHref(true, "/does/not/exist.json")).toBe(
      `/@fs/${join(storage.root, "styles/globals.css").replace(/\\/g, "/")}`,
    );
  });

  it("returns an empty href in production because page builds inline CSS", () => {
    const path = writeManifest({ "index.html": { file: "assets/main-def456.js" } });
    expect(resolveGlobalsCssHref(false, path)).toBe("");
  });

  it("returns an empty href (not a throw) when the manifest file itself doesn't exist", () => {
    expect(resolveGlobalsCssHref(false, "/does/not/exist/manifest.json")).toBe("");
  });
});

describe("resolveHydrateEntryHref", () => {
  it("returns the dev source path without touching the filesystem", () => {
    expect(resolveHydrateEntryHref(true, "/does/not/exist.json")).toBe("/src/apps/hydrate-client.ts");
  });

  it("reads the built, hashed asset path from the manifest in production", () => {
    const path = writeManifest({
      "src/apps/hydrate-client.ts": { file: "assets/appsHydrate-abc123.js" },
    });
    expect(resolveHydrateEntryHref(false, path)).toBe("/assets/appsHydrate-abc123.js");
  });

  it("throws a clear error when the manifest has no hydrate-client entry", () => {
    const path = writeManifest({ "index.html": { file: "assets/main-def456.js" } });
    expect(() => resolveHydrateEntryHref(false, path)).toThrow(/hydrate-client\.ts/);
  });
});

describe("resolveEditLauncherHref", () => {
  it("returns the dev source path without touching the filesystem", () => {
    expect(resolveEditLauncherHref(true, "/does/not/exist.json")).toBe("/src/apps/edit-launcher.ts");
  });

  it("reads the built, hashed asset path from the manifest in production", () => {
    const path = writeManifest({
      "src/apps/edit-launcher.ts": { file: "assets/appsEditLauncher-abc123.js" },
    });
    expect(resolveEditLauncherHref(false, path)).toBe("/assets/appsEditLauncher-abc123.js");
  });
});
