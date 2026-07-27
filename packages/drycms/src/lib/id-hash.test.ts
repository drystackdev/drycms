import { describe, expect, it } from "vitest";
import { decodeEntryId, encodeEntryId } from "./id-hash.js";

describe("encodeEntryId / decodeEntryId", () => {
  it("round-trips small ids", () => {
    for (const id of [0, 1, 2, 3, 42, 100]) {
      expect(decodeEntryId(encodeEntryId(id))).toBe(id);
    }
  });

  it("round-trips large ids up to the 32-bit boundary", () => {
    for (const id of [0xffff, 0x10000, 0x7fffffff, 0xfffffffe, 0xffffffff]) {
      expect(decodeEntryId(encodeEntryId(id))).toBe(id);
    }
  });

  it("does not produce sequential-looking output for sequential ids", () => {
    const hashes = [1, 2, 3, 4, 5].map(encodeEntryId);
    expect(new Set(hashes).size).toBe(hashes.length);
    // A trivial encoding (e.g. plain base62 of the id itself) would share a
    // common prefix/suffix across consecutive ids - this shouldn't.
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it("always encodes to at least 6 characters, even for tiny ids", () => {
    expect(encodeEntryId(0).length).toBeGreaterThanOrEqual(6);
    expect(encodeEntryId(1).length).toBeGreaterThanOrEqual(6);
  });

  it("rejects ids outside the supported range", () => {
    expect(() => encodeEntryId(-1)).toThrow();
    expect(() => encodeEntryId(1.5)).toThrow();
    expect(() => encodeEntryId(0x100000000)).toThrow();
  });

  it("returns null (not a throw) for malformed hashes", () => {
    expect(decodeEntryId("")).toBeNull();
    expect(decodeEntryId("not-base62!")).toBeNull();
    expect(decodeEntryId("_")).toBeNull();
  });

  it("decodeEntryId is the exact inverse of encodeEntryId across a range", () => {
    for (let id = 0; id < 5000; id += 37) {
      expect(decodeEntryId(encodeEntryId(id))).toBe(id);
    }
  });
});
