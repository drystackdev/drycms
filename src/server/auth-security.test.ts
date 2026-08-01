import { describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({ path: "/dry" }));

const {
  createAuthSession,
  isAuthSessionValid,
  revokeAllAuthSessions,
  rotateAuthSession,
} = await import("./auth-security.js");

describe("auth security sessions", () => {
  it("rotates refresh tokens and rejects reuse by revoking the session chain", async () => {
    const userId = 7001;
    const first = await createAuthSession(userId, {});
    expect(await isAuthSessionValid(first.sessionId, userId, Math.floor(Date.now() / 1000), {})).toBe(true);

    const rotated = await rotateAuthSession(first.refreshToken, {});
    expect(rotated).not.toBeNull();
    expect(rotated!.refreshToken).not.toBe(first.refreshToken);
    expect(await isAuthSessionValid(rotated!.session.sessionId, userId, Math.floor(Date.now() / 1000), {})).toBe(true);

    expect(await rotateAuthSession(first.refreshToken, {})).toBeNull();
    expect(await isAuthSessionValid(rotated!.session.sessionId, userId, Math.floor(Date.now() / 1000), {})).toBe(false);
  });

  it("revokes every session for a user without affecting a different user", async () => {
    const userId = 7002;
    const otherUserId = 7003;
    const session = await createAuthSession(userId, {});
    const other = await createAuthSession(otherUserId, {});
    await revokeAllAuthSessions(userId, "password-change", {});

    expect(await isAuthSessionValid(session.sessionId, userId, Math.floor(Date.now() / 1000), {})).toBe(false);
    expect(await isAuthSessionValid(other.sessionId, otherUserId, Math.floor(Date.now() / 1000), {})).toBe(true);
  });
});
