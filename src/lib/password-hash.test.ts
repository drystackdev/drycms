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
    expect(await verifyPassword("anything", "scrypt:not-a-number:8:1:c2FsdA==:aGFzaA==")).toBe(false);
  });

  it("writes the scrypt cost parameters embedded in the stored string", async () => {
    const stored = await hashPassword("hunter2");
    expect(stored.startsWith("scrypt:")).toBe(true);
    const [, n, r, p] = stored.split(":");
    expect(Number(n)).toBeGreaterThan(0);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });
});
