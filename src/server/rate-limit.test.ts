import { describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({ path: "/dry" }));

const { clearLoginFailures, isLoginRateLimited, recordLoginFailure } = await import("./rate-limit.js");

describe("login rate limit", () => {
  it("blocks an email after the configured failed-attempt threshold", async () => {
    const email = `limited-${crypto.randomUUID()}@example.com`;
    const request = new Request("http://localhost/dry/api/auth/login", {
      method: "POST",
      headers: { "CF-Connecting-IP": `192.0.2.${Math.floor(Math.random() * 200) + 1}` },
    });
    expect(await isLoginRateLimited(request, email, {})).toBe(false);
    for (let attempt = 0; attempt < 5; attempt += 1) await recordLoginFailure(request, email, {});
    expect(await isLoginRateLimited(request, email, {})).toBe(true);
    await clearLoginFailures(request, email, {});
    expect(await isLoginRateLimited(request, email, {})).toBe(false);
  });
});
