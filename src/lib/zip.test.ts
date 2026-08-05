import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createZip, parseZip, unzipToDirectories, zipDirectories, type ZipEntry } from "./zip.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `drycms-${prefix}-`));
  dirs.push(dir);
  return dir;
}

describe("createZip/parseZip", () => {
  it("round-trips a handful of entries, including an empty file", () => {
    const entries: ZipEntry[] = [
      { path: "storage/logo.png", data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
      { path: "storage/nested/readme.txt", data: new TextEncoder().encode("hello drycms") },
      { path: "storage/empty.bin", data: new Uint8Array(0) },
    ];
    const zip = createZip(entries);
    const parsed = parseZip(zip);

    expect(parsed.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    for (let i = 0; i < entries.length; i += 1) {
      expect(Array.from(parsed[i]!.data)).toEqual(Array.from(entries[i]!.data));
    }
  });

  it("round-trips non-ASCII (Vietnamese) file names", () => {
    const entries: ZipEntry[] = [{ path: "storage/tài liệu.txt", data: new TextEncoder().encode("nội dung") }];
    const parsed = parseZip(createZip(entries));
    expect(parsed[0]!.path).toBe("storage/tài liệu.txt");
    expect(new TextDecoder().decode(parsed[0]!.data)).toBe("nội dung");
  });

  it("produces an empty-but-valid zip for zero entries", () => {
    expect(parseZip(createZip([]))).toEqual([]);
  });

  it("rejects a buffer with no end-of-central-directory record", () => {
    expect(() => parseZip(new Uint8Array(10))).toThrow(/end-of-central-directory/);
  });
});

describe("zipDirectories/unzipToDirectories", () => {
  it("zips only existing/non-empty roots, skipping missing ones without erroring", async () => {
    const storageDir = tempDir("storage-src");
    writeFileSync(join(storageDir, "a.txt"), "A");
    mkdirSync(join(storageDir, "nested"));
    writeFileSync(join(storageDir, "nested", "b.txt"), "B");

    const missingDir = join(tempDir("missing-parent"), "does-not-exist");

    const zip = await zipDirectories([
      { prefix: "storage", dir: storageDir },
      { prefix: "icons", dir: missingDir },
    ]);
    expect(zip).not.toBeNull();

    const entries = parseZip(zip!);
    expect(entries.map((e) => e.path).sort()).toEqual(["storage/a.txt", "storage/nested/b.txt"]);
  });

  it("returns null when every root is missing or empty", async () => {
    const emptyDir = tempDir("empty-src");
    const zip = await zipDirectories([{ prefix: "storage", dir: emptyDir }]);
    expect(zip).toBeNull();
  });

  it("extracts entries under the matching prefix's target directory, mapping to a DIFFERENT root than it was zipped from", async () => {
    const sourceDir = tempDir("extract-src");
    writeFileSync(join(sourceDir, "logo.png"), "binary-ish content");
    mkdirSync(join(sourceDir, "sub"));
    writeFileSync(join(sourceDir, "sub", "icon.svg"), "<svg/>");

    const zip = await zipDirectories([{ prefix: "storage", dir: sourceDir }]);

    const destDir = tempDir("extract-dest");
    await unzipToDirectories(zip!, { storage: destDir });

    expect((await readFile(join(destDir, "logo.png"))).toString()).toBe("binary-ish content");
    expect((await readFile(join(destDir, "sub", "icon.svg"))).toString()).toBe("<svg/>");
  });

  it("skips entries whose prefix isn't in prefixToDir instead of failing the whole extraction", async () => {
    const sourceDir = tempDir("multi-src");
    writeFileSync(join(sourceDir, "keep.txt"), "keep me");
    const otherDir = tempDir("other-src");
    writeFileSync(join(otherDir, "drop.txt"), "drop me");

    const zip = await zipDirectories([
      { prefix: "storage", dir: sourceDir },
      { prefix: "future-root", dir: otherDir },
    ]);

    const destDir = tempDir("multi-dest");
    await unzipToDirectories(zip!, { storage: destDir });

    expect((await readFile(join(destDir, "keep.txt"))).toString()).toBe("keep me");
    await expect(readFile(join(destDir, "..", "future-root", "drop.txt"))).rejects.toThrow();
  });

  it("rejects an entry with an unsafe path segment (zip-slip)", async () => {
    const zip = createZip([{ path: "storage/../../evil.txt", data: new Uint8Array([1]) }]);
    const destDir = tempDir("slip-dest");
    await expect(unzipToDirectories(zip, { storage: destDir })).rejects.toThrow(/unsafe path segment/);
  });
});
