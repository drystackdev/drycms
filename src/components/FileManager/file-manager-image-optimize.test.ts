import { describe, expect, it } from "vitest";
import {
  canOptimizeUploadImage,
  optimizedUploadName,
} from "./file-manager-image-optimize.js";

function file(name: string, type: string) {
  return new File(["x"], name, { type });
}

describe("upload image optimization rules", () => {
  it("enables optimization only for jpg/png/webp images", () => {
    expect(canOptimizeUploadImage(file("photo.jpg", "image/jpeg"))).toBe(true);
    expect(canOptimizeUploadImage(file("photo.jpeg", ""))).toBe(true);
    expect(canOptimizeUploadImage(file("logo.png", "image/png"))).toBe(true);
    expect(canOptimizeUploadImage(file("hero.webp", "image/webp"))).toBe(true);
    expect(canOptimizeUploadImage(file("animation.gif", "image/gif"))).toBe(false);
    expect(canOptimizeUploadImage(file("vector.svg", "image/svg+xml"))).toBe(false);
    expect(canOptimizeUploadImage(file("notes.txt", "text/plain"))).toBe(false);
  });

  it("uses the final webp name for optimized uploads", () => {
    expect(optimizedUploadName("photo.jpg")).toBe("photo.webp");
    expect(optimizedUploadName("archive.preview.png")).toBe("archive.preview.webp");
    expect(optimizedUploadName("untitled")).toBe("untitled.webp");
  });
});
