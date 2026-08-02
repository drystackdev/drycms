import { describe, expect, it } from "vitest";
import { bodyLimitResponse, MAX_JSON_BODY_BYTES, MAX_UPLOAD_BODY_BYTES } from "./request-limits.js";

describe("request body limits", () => {
  it("rejects oversized JSON and upload declarations", async () => {
    const json = bodyLimitResponse(new Request("http://localhost/dry/api/content/post", {
      method: "POST",
      headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) },
    }), "content", "POST");
    expect(json?.status).toBe(413);
    const upload = bodyLimitResponse(new Request("http://localhost/dry/api/storage/post", {
      method: "POST",
      headers: { "content-length": String(MAX_UPLOAD_BODY_BYTES + 1) },
    }), "storage", "POST");
    expect(upload?.status).toBe(413);
  });

  it("leaves ordinary and bodyless requests alone", () => {
    expect(bodyLimitResponse(new Request("http://localhost/dry/api/content/post", { method: "POST" }), "content", "POST")).toBeNull();
    expect(bodyLimitResponse(new Request("http://localhost/dry/api/content", { method: "GET" }), "content", "GET")).toBeNull();
  });
});
