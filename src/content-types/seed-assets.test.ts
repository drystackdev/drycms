import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createZip } from "../lib/zip.js";
import { resolveOptions } from "../server/options.js";
import { applyPackagedSeedAssets } from "./seed-assets.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `drycms-${prefix}-`));
  dirs.push(dir);
  return dir;
}

describe("applyPackagedSeedAssets", () => {
  it("no-ops when there is no packaged zip", async () => {
    const resolved = resolveOptions({}, { localDataRoot: tempDir("data-root") });
    await expect(applyPackagedSeedAssets(null, resolved)).resolves.toBeUndefined();
  });

  it("extracts storage/icons/components/pageComponents into the CURRENT resolved roots", async () => {
    const zip = createZip([
      { path: "storage/logo.png", data: new TextEncoder().encode("logo-bytes") },
      { path: "icons/lucide/home.svg", data: new TextEncoder().encode("<svg/>") },
      { path: "components-storage/confirmed.json", data: new TextEncoder().encode('{"ok":true}') },
      { path: "page-components-storage/tree.json", data: new TextEncoder().encode("[]") },
    ]);

    const resolved = resolveOptions({}, { localDataRoot: tempDir("data-root") });

    await applyPackagedSeedAssets(zip, resolved);

    expect((await readFile(join(resolved.storage.root, "logo.png"))).toString()).toBe("logo-bytes");
    expect((await readFile(join(resolved.icons.root, "lucide", "home.svg"))).toString()).toBe("<svg/>");
    expect((await readFile(join(resolved.components.storage.root, "confirmed.json"))).toString()).toBe('{"ok":true}');
    expect((await readFile(join(resolved.pageComponents.storage.root, "tree.json"))).toString()).toBe("[]");
  });

  it("never touches pagesCache/typesCache/kv roots even if a zip somehow contained them", async () => {
    const zip = createZip([{ path: "pagesCache/should-not-land.json", data: new Uint8Array([1]) }]);

    const resolved = resolveOptions({}, { localDataRoot: tempDir("data-root") });

    await applyPackagedSeedAssets(zip, resolved);

    await expect(readFile(join(resolved.pagesCache.storage.root, "should-not-land.json"))).rejects.toThrow();
  });
});
