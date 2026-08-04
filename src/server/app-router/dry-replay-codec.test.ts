import { describe, expect, it } from "vitest";
import type { DryCallLogEntry } from "../../content-types/dry-context.js";
import { decodeCallLog, encodeCallLog } from "./dry-replay-codec.js";

describe("dry-replay-codec", () => {
  it("round-trips plain values", () => {
    const log: DryCallLogEntry[] = [
      { kind: "collection", name: "user", method: "list", result: { rows: [{ id: 1, name: "Khan" }], total: 1 } },
      { kind: "singleton", name: "settings", method: "get", result: null },
    ];
    expect(decodeCallLog(encodeCallLog(log))).toEqual(log);
  });

  it("round-trips a Date field as a real Date instance, not a plain string", () => {
    const publishedAt = new Date("2026-08-01T12:00:00.000Z");
    const log: DryCallLogEntry[] = [
      { kind: "collection", name: "post", method: "get", result: { id: 1, publishedAt } },
    ];
    const decoded = decodeCallLog(encodeCallLog(log));
    const result = decoded[0]!.result as { publishedAt: unknown };
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect((result.publishedAt as Date).toISOString()).toBe(publishedAt.toISOString());
  });

  it("escapes every '<' so the encoded string is safe to embed inside a <script> tag", () => {
    const log: DryCallLogEntry[] = [
      { kind: "collection", name: "post", method: "get", result: { body: "</script><img src=x onerror=alert(1)>" } },
    ];
    const encoded = encodeCallLog(log);
    expect(encoded).not.toContain("</script");
    expect(encoded).not.toContain("<img");
    expect(decodeCallLog(encoded)).toEqual(log);
  });
});
