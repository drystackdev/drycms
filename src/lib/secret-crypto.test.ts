import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = process.env.DRYCMS_SECRET_KEY;

describe("secret-crypto", () => {
  beforeEach(() => {
    process.env.DRYCMS_SECRET_KEY = "test-passphrase-do-not-use-in-prod";
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.DRYCMS_SECRET_KEY;
    else process.env.DRYCMS_SECRET_KEY = ORIGINAL_ENV;
  });

  it("round-trips a plaintext value through encrypt/decrypt", async () => {
    const { encryptSecret, decryptSecret } = await import("./secret-crypto.js");
    const encrypted = await encryptSecret("sk_live_abc123");
    expect(encrypted).not.toBe("sk_live_abc123");
    expect(await decryptSecret(encrypted)).toBe("sk_live_abc123");
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", async () => {
    const { encryptSecret } = await import("./secret-crypto.js");
    const a = await encryptSecret("same-value");
    const b = await encryptSecret("same-value");
    expect(a).not.toBe(b);
  });

  it("rejects a payload that isn't its own format", async () => {
    const { decryptSecret } = await import("./secret-crypto.js");
    await expect(decryptSecret("not-encrypted")).rejects.toThrow();
  });

  it("throws a clear error when DRYCMS_SECRET_KEY is missing", async () => {
    vi.resetModules();
    vi.doMock("../server/options.js", () => ({ readEnvVar: () => undefined }));
    const { encryptSecret } = await import("./secret-crypto.js");
    await expect(encryptSecret("x")).rejects.toThrow(/DRYCMS_SECRET_KEY/);
    vi.doUnmock("../server/options.js");
  });
});
