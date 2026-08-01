import { describe, expect, it } from "vitest";
import { createCsrfToken, hasValidCsrf, requiresCsrf } from "./csrf.js";

describe("CSRF protection", () => {
  it("requires a token for mutations but exempts initial login/setup", () => {
    expect(requiresCsrf(new Request("http://localhost/dry/api/content", { method: "POST" }), "content")).toBe(true);
    expect(requiresCsrf(new Request("http://localhost/dry/api/auth/login", { method: "POST" }), "auth", "login")).toBe(false);
    expect(requiresCsrf(new Request("http://localhost/dry/api/auth/register-first-admin", { method: "POST" }), "auth", "register-first-admin")).toBe(false);
  });

  it("requires matching cookie and header values", () => {
    const token = createCsrfToken();
    const valid = new Request("http://localhost/dry/api/content", {
      method: "POST",
      headers: {
        Cookie: `drycms_csrf=${encodeURIComponent(token)}`,
        "X-CSRF-Token": token,
      },
    });
    expect(hasValidCsrf(valid)).toBe(true);
    const invalid = new Request("http://localhost/dry/api/content", {
      method: "POST",
      headers: { Cookie: `drycms_csrf=${encodeURIComponent(token)}`, "X-CSRF-Token": "wrong" },
    });
    expect(hasValidCsrf(invalid)).toBe(false);
  });
});
