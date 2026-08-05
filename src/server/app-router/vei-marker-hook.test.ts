import { h } from "preact";
import renderToString from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { boxString, type DryRef } from "../../content-types/dry-vei-ref.js";
import { installVeiMarkerHook } from "./vei-marker-hook.js";

installVeiMarkerHook();

const ref: DryRef = { kind: "collection", type: "blog", id: 12, path: "title", fieldType: "text" };
const nested: DryRef = { kind: "collection", type: "blog", id: 12, path: "hero.name", fieldType: "text" };
const image: DryRef = { kind: "collection", type: "blog", id: 12, path: "cover", fieldType: "image" };

describe("installVeiMarkerHook", () => {
  it("marks the element whose text came from a boxed value", () => {
    const html = renderToString(h("div", null, boxString("Xin chào", ref)));
    expect(html).toBe('<div data-dry="c:blog:12:title:text">Xin chào</div>');
  });

  it("leaves an ordinary render byte-identical", () => {
    expect(renderToString(h("div", { class: "x" }, "plain"))).toBe('<div class="x">plain</div>');
  });

  it("marks an attribute-sourced value under its own attribute name", () => {
    const html = renderToString(h("img", { src: boxString("/media/a.jpg", image), alt: "" }));
    expect(html).toContain('data-dry-src="c:blog:12:cover:image"');
    expect(html).toContain('src="/media/a.jpg"');
  });

  it("marks richtext injected through dangerouslySetInnerHTML", () => {
    const body: DryRef = { ...ref, path: "content", fieldType: "richtext" };
    const html = renderToString(h("div", { dangerouslySetInnerHTML: { __html: boxString("<p>hi</p>", body) } }));
    expect(html).toBe('<div data-dry-html="c:blog:12:content:richtext"><p>hi</p></div>');
  });

  it("lists every field an element's text came from", () => {
    const html = renderToString(h("p", null, boxString("a", ref), " - ", boxString("b", nested)));
    expect(html).toContain('data-dry="c:blog:12:title:text c:blog:12:hero.name:text"');
  });

  it("marks the element that finally renders the value, not the component it passed through", () => {
    function Card({ title }: { title: string }) {
      return h("article", null, h("h2", null, title));
    }
    const html = renderToString(h(Card, { title: boxString("Tiêu đề", ref) }));
    expect(html).toBe('<article><h2 data-dry="c:blog:12:title:text">Tiêu đề</h2></article>');
  });

  it("does not reach into a nested element's own text", () => {
    const html = renderToString(h("section", null, h("span", null, boxString("a", ref))));
    expect(html).toBe('<section><span data-dry="c:blog:12:title:text">a</span></section>');
  });

  it("leaves an explicit dryBind marker in place rather than overwriting it", () => {
    const html = renderToString(h("h1", { "data-dry": "c:blog:12:hero.name:text" }, boxString("a", ref)));
    expect(html).toBe('<h1 data-dry="c:blog:12:hero.name:text">a</h1>');
  });
});
