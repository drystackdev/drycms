import { describe, expect, it } from "vitest";
import { ZipWriter, buildZip, crc32, parseZip } from "./zip.js";

describe("crc32", () => {
  it("matches the standard PKZIP/zlib test vector", () => {
    // Well-known CRC-32 test vector: crc32("123456789") === 0xCBF43926.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("returns 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("buildZip / parseZip", () => {
  it("round-trips text, binary, empty, and non-ASCII-named entries", () => {
    const binary = new Uint8Array([0, 1, 2, 253, 254, 255, 0, 0, 128]);
    const zip = buildZip([
      { path: "hello.txt", data: new TextEncoder().encode("Xin chào thế giới") },
      { path: "photos/ảnh.png", data: binary },
      { path: "empty.txt", data: new Uint8Array(0) },
    ]);

    const entries = parseZip(zip);
    expect(entries.map((e) => e.path)).toEqual(["hello.txt", "photos/ảnh.png", "empty.txt"]);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe("Xin chào thế giới");
    expect(Array.from(entries[1]!.data)).toEqual(Array.from(binary));
    expect(entries[2]!.data.length).toBe(0);
  });

  it("produces a byte-identical archive whether built all-at-once or incrementally via ZipWriter", () => {
    const inputs = [
      { path: "a.txt", data: new TextEncoder().encode("one") },
      { path: "b.txt", data: new TextEncoder().encode("two") },
    ];
    const whole = buildZip(inputs);

    const writer = new ZipWriter();
    let incremental = new Uint8Array(0);
    for (const entry of inputs) {
      const chunk = writer.addEntry(entry);
      const next = new Uint8Array(incremental.length + chunk.length);
      next.set(incremental, 0);
      next.set(chunk, incremental.length);
      incremental = next;
    }
    const finalChunk = writer.finish();
    const combined = new Uint8Array(incremental.length + finalChunk.length);
    combined.set(incremental, 0);
    combined.set(finalChunk, incremental.length);

    expect(combined).toEqual(whole);
  });

  it("rejects a file too small to contain an end-of-central-directory record", () => {
    expect(() => parseZip(new Uint8Array(4))).toThrow(/Not a valid zip file/);
  });

  it("rejects a compressed (non-stored) entry rather than misreading it as raw bytes", () => {
    const zip = buildZip([{ path: "a.txt", data: new TextEncoder().encode("hi") }]);
    // Flip the local + central "compression method" fields (both currently
    // 0 = stored) to 8 = deflate, simulating a zip this module doesn't
    // support, without needing a real deflate-compressed fixture.
    const withDeflateMethod = new Uint8Array(zip);
    const view = new DataView(withDeflateMethod.buffer);
    view.setUint16(8, 8, true); // local header method field
    // Central directory record follows immediately after this tiny entry's
    // local header + data ("a.txt" = 5 bytes name, "hi" = 2 bytes data).
    const centralOffset = 30 + 5 + 2;
    view.setUint16(centralOffset + 10, 8, true); // central header method field
    expect(() => parseZip(withDeflateMethod)).toThrow(/Unsupported zip compression method/);
  });
});
