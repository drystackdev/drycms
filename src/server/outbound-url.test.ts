import { describe, expect, it } from "vitest";
import { validateOutboundUrl } from "./outbound-url.js";

describe("validateOutboundUrl", () => {
  it("accepts public HTTP(S) provider URLs and strips fragments", () => {
    expect(validateOutboundUrl("https://api.example.com/v1/#models")).toBe("https://api.example.com/v1");
  });

  it("rejects local, private and metadata destinations", () => {
    for (const url of [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://10.0.0.4",
      "http://169.254.169.254/latest/meta-data",
      "http://metadata.google.internal",
    ]) expect(() => validateOutboundUrl(url)).toThrow(/private|local/i);
  });

  it("rejects embedded credentials and non-HTTP protocols", () => {
    expect(() => validateOutboundUrl("https://user:pass@example.com")).toThrow(/credentials/i);
    expect(() => validateOutboundUrl("file:///etc/passwd")).toThrow(/HTTP|HTTPS/i);
  });
});
