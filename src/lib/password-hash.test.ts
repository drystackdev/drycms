import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password-hash.js";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("never stores the plaintext password", async () => {
    const stored = await hashPassword("hunter2");
    expect(stored).not.toContain("hunter2");
  });

  it("produces different output for the same password each time (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("rejects a value that isn't its own format, without throwing", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "v2:not-a-number:c2FsdA==:aGFzaA==")).toBe(false);
  });

  it("writes v2 with the iteration count embedded, at or below the Workers cap", async () => {
    const stored = await hashPassword("hunter2");
    const [, iterations] = stored.split(":");
    expect(stored.startsWith("v2:")).toBe(true);
    expect(Number(iterations)).toBeLessThanOrEqual(100_000);
  });

  // Real `v1:` output, produced by the pre-v2 scheme (210,000 iterations,
  // count not stored) - accounts created before that format change must keep
  // working on Node, where the count is still within reach.
  it("still verifies a legacy v1 hash", async () => {
    const legacy = "v1:3Np9/wgPKvnEwDIb82Ms0g==:iLYAyDih26v8BRNsD5td4ZN7eLX/POsk1eahqjb+MYc=";
    expect(await verifyPassword("correct horse battery staple", legacy)).toBe(true);
    expect(await verifyPassword("wrong password", legacy)).toBe(false);
  });
});
