import { options, type VNode } from "preact";
import { resolveImageSrc } from "../../storage/http-source.js";

/**
 * Resolves a media element's `src`/`poster` through `resolveImageSrc` at the
 * moment its vnode is created, so page source can write
 * `<img src={post.image} />` directly - an `image` field stores a bare
 * storage id ("hero.jpg"), not a URL, and a page that put it straight into
 * `src` used to get a silent 404 (the browser resolves it relative to the
 * current page, `/blogs/<slug>/hero.jpg`).
 *
 * The same `options.vnode` seam `vei-marker-hook.ts` uses, and deliberately
 * a SEPARATE hook rather than a branch inside that one: this runs for every
 * visitor, while markers only exist in an edit-mode render. Order between
 * the two doesn't matter - `resolveImageSrc` carries a boxed value's ref
 * across the rewrite, so the marker hook still finds it whichever runs
 * first, and it's a plain string by the time the marker hook has unboxed it.
 *
 * Chosen over a Vite source transform (`app-router-plugin.ts`'s shape)
 * because a `src` is routinely computed - inside a `.map()`, through a
 * variable, via spread props - and none of that is reachable by rewriting
 * JSX text.
 */

/** Media elements only. `<iframe>`/`<script>`/`<embed>` also take a `src`,
 * but theirs is never a CMS storage id, and silently rewriting one would be
 * a much harder bug to see than the one this fixes. */
const MEDIA_TAGS = new Set(["img", "video", "audio", "source", "track"]);

/** `srcset` is deliberately absent: it's a comma-separated list with width/
 * density descriptors, so it would need real parsing rather than one
 * resolve, and no field type produces one today. */
const MEDIA_PROPS = ["src", "poster"];

export function installMediaSrcHook(): void {
  const previous = options.vnode;
  options.vnode = (vnode: VNode) => {
    if (typeof vnode.type === "string" && MEDIA_TAGS.has(vnode.type)) {
      const props = vnode.props as Record<string, unknown>;
      for (const key of MEDIA_PROPS) {
        const value = props[key];
        // An empty value stays empty - `resolveImageSrc("")` would build a
        // `/api/storage/` URL pointing at no file at all, and `src=""` is
        // what an unset optional image field already renders as.
        if (typeof value !== "string" && !(value instanceof String)) continue;
        if (String(value) === "") continue;
        props[key] = resolveImageSrc(value as string);
      }
    }
    previous?.(vnode);
  };
}
