import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = process.env.DRYCMS_SECRET_KEY;
const PAYLOAD = { id: 1, name: "Ada Lovelace", email: "ada@example.com" };

describe("signSession / verifySession", () => {
  beforeEach(() => {
    process.env.DRYCMS_SECRET_KEY = "test-passphrase-do-not-use-in-prod";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_ENV === undefined) delete process.env.DRYCMS_SECRET_KEY;
    else process.env.DRYCMS_SECRET_KEY = ORIGINAL_ENV;
  });

  it("verifies a freshly-signed token", async () => {
    const { signSession, verifySession } = await import("./session-token.js");
    const token = await signSession(PAYLOAD, { sessionId: "test-session" });
    expect(await verifySession(token)).toEqual(PAYLOAD);
  });

  it("emits a standard HS256 JWT with an issuer and unique id", async () => {
    const { signSession } = await import("./session-token.js");
    const token = await signSession(PAYLOAD, { sessionId: "test-session" });
    const [headerPart, bodyPart, signaturePart] = token.split(".");
    expect([headerPart, bodyPart, signaturePart]).toHaveLength(3);
    expect(JSON.parse(atob(headerPart!))).toEqual({ alg: "HS256", typ: "JWT", kid: "default" });
    const body = JSON.parse(atob(bodyPart!));
    expect(body).toMatchObject({ sub: "1", name: PAYLOAD.name, email: PAYLOAD.email, iss: "drycms" });
    expect(typeof body.jti).toBe("string");
  });

  it("never stores the payload in plaintext", async () => {
    const { signSession } = await import("./session-token.js");
    const token = await signSession(PAYLOAD, { sessionId: "test-session" });
    expect(token).not.toContain(PAYLOAD.email);
  });

  it("rejects a tampered token", async () => {
    const { signSession, verifySession } = await import("./session-token.js");
    const token = await signSession(PAYLOAD, { sessionId: "test-session" });
    const index = Math.floor(token.length / 2);
    const flipped = token[index] === "A" ? "B" : "A";
    const tampered = token.slice(0, index) + flipped + token.slice(index + 1);
    expect(await verifySession(tampered)).toBeNull();
  });

  it("rejects a value that isn't its own format, without throwing", async () => {
    const { verifySession } = await import("./session-token.js");
    expect(await verifySession("not-a-token")).toBeNull();
    expect(await verifySession("")).toBeNull();
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    const { signSession, verifySession } = await import("./session-token.js");
    const token = await signSession(PAYLOAD, { sessionId: "test-session" });
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000); // 31 days > 30 day max age
    expect(await verifySession(token)).toBeNull();
  });

  it("throws a clear error when DRYCMS_SECRET_KEY is missing", async () => {
    vi.resetModules();
    // Mocked rather than just `delete`d - this repo's own `.env` (loaded by
    // `server/options.ts`'s `readEnvVar` as a process.env fallback) sets a
    // real `DRYCMS_SECRET_KEY`, which would otherwise mask this case.
    vi.doMock("../server/options.js", () => ({ readEnvVar: () => undefined }));
    const { signSession } = await import("./session-token.js");
    await expect(signSession(PAYLOAD, { sessionId: "test-session" })).rejects.toThrow(/DRYCMS_SECRET_KEY/);
    vi.doUnmock("../server/options.js");
  });

  it("signs with the active key and verifies keys retained in the ring", async () => {
    vi.resetModules();
    process.env.DRYCMS_JWT_KEYS_JSON = JSON.stringify({ old: "old-secret-that-is-at-least-32-bytes-long", next: "next-secret-that-is-at-least-32-bytes-long" });
    process.env.DRYCMS_JWT_ACTIVE_KID = "old";
    const { signSession, verifySession } = await import("./session-token.js");
    const oldToken = await signSession(PAYLOAD, { sessionId: "old-session" });
    process.env.DRYCMS_JWT_ACTIVE_KID = "next";
    const nextToken = await signSession(PAYLOAD, { sessionId: "next-session" });
    expect(JSON.parse(atob(nextToken.split(".")[0]!))).toMatchObject({ kid: "next", alg: "HS256" });
    expect(await verifySession(oldToken)).toEqual(PAYLOAD);
    expect(await verifySession(nextToken)).toEqual(PAYLOAD);
    delete process.env.DRYCMS_JWT_KEYS_JSON;
    delete process.env.DRYCMS_JWT_ACTIVE_KID;
  });
});
