import { h } from "preact";
import renderToString from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { boxString, type DryRef } from "../../content-types/dry-vei-ref.js";
import { installMediaSrcHook } from "./media-src-hook.js";
import { installVeiMarkerHook } from "./vei-marker-hook.js";

installMediaSrcHook();
// Installed too, and in the same order `render.ts` uses, so the marker
// assertion below covers the real interaction between the two hooks rather
// than this one in isolation.
installVeiMarkerHook();

const image: DryRef = { kind: "collection", type: "blog", id: 12, path: "image", fieldType: "image" };

describe("installMediaSrcHook", () => {
  it("resolves a bare storage id into the storage API URL", () => {
    expect(renderToString(h("img", { src: "hero.jpg", alt: "" }))).toContain('src="/dry/api/storage/hero.jpg"');
  });

  it("encodes each path segment but keeps the separators", () => {
    const html = renderToString(h("img", { src: "my folder/a b.jpg", alt: "" }));
    expect(html).toContain('src="/dry/api/storage/my%20folder/a%20b.jpg"');
  });

  it("leaves an absolute or root-relative URL alone", () => {
    expect(renderToString(h("img", { src: "https://cdn.example/a.jpg", alt: "" }))).toContain(
      'src="https://cdn.example/a.jpg"',
    );
    expect(renderToString(h("video", { src: "/video.mp4" }))).toContain('src="/video.mp4"');
  });

  it("leaves an empty src empty rather than pointing it at the storage root", () => {
    // `preact-render-to-string` serializes an empty attribute bare (`src`,
    // not `src=""`) - the point of the assertion is that no `/api/storage/`
    // URL was invented for it.
    expect(renderToString(h("img", { src: "", alt: "" }))).toBe("<img src alt/>");
  });

  it("resolves a video's poster the same way as its src", () => {
    const html = renderToString(h("video", { src: "clip.mp4", poster: "cover.jpg" }));
    expect(html).toContain('src="/dry/api/storage/clip.mp4"');
    expect(html).toContain('poster="/dry/api/storage/cover.jpg"');
  });

  it("does not touch a non-media element's src", () => {
    expect(renderToString(h("iframe", { src: "embed.html" }))).toContain('src="embed.html"');
  });

  it("keeps a boxed value's VEI marker across the rewrite", () => {
    const html = renderToString(h("img", { src: boxString("hero.jpg", image), alt: "" }));
    expect(html).toContain('src="/dry/api/storage/hero.jpg"');
    expect(html).toContain('data-dry-src="c:blog:12:image:image"');
  });
});
