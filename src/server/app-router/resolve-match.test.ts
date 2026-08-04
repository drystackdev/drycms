import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { RouteMatch } from "./match.js";
import { resolveMatchToVNode } from "./resolve-match.js";

describe("resolveMatchToVNode", () => {
  it("wraps the page with layouts root-to-leaf and threads params as a prop (not a global)", async () => {
    const match: RouteMatch = {
      page: () =>
        Promise.resolve({
          default: (async ({ params }: { params: Record<string, string> }) =>
            h("article", null, `slug:${params.slug}`)) as never,
        }),
      layouts: [
        () =>
          Promise.resolve({
            default: (async ({ children }: { children: unknown }) =>
              h("section", { class: "root" }, children as never)) as never,
          }),
        () =>
          Promise.resolve({
            default: (async ({ children }: { children: unknown }) =>
              h("section", { class: "blog" }, children as never)) as never,
          }),
      ],
      params: { slug: "hello" },
    };

    const vnode = await resolveMatchToVNode(match);
    expect(renderToString(vnode as never)).toBe(
      '<section class="root"><section class="blog"><article>slug:hello</article></section></section>',
    );
  });

  it("leaves a nested, ordinary (non-async) component uninvoked - Preact dispatches it, not resolveMatchToVNode", async () => {
    let invoked = false;
    function Child() {
      invoked = true;
      return h("span", null, "child");
    }

    const match: RouteMatch = {
      page: () => Promise.resolve({ default: (async () => h("main", null, h(Child, null))) as never }),
      layouts: [],
      params: {},
    };

    const vnode = await resolveMatchToVNode(match);
    expect(invoked).toBe(false); // not called yet - only renderToString/hydrate invokes it
    expect(renderToString(vnode as never)).toBe("<main><span>child</span></main>");
    expect(invoked).toBe(true);
  });
});
