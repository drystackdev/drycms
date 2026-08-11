import { describe, expect, it } from "vitest";
import { pastedImageName } from "./pasted-images.js";

describe("pastedImageName", () => {
  it("keeps a safe image filename from the URL", () => {
    expect(pastedImageName("https://cdn.example.com/photos/hero%20shot.webp?width=1200")).toBe("hero-shot.webp");
  });

  it("derives a filename from the response MIME type when the URL has no extension", () => {
    expect(pastedImageName("https://cdn.example.com/image/123", "image/jpeg")).toBe("pasted-image.jpg");
  });
});
