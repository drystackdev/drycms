import { options as defaultOptions, type Options, type VNode } from "preact";
import { encodeRef, MARKER_ATTR, refOf, unbox } from "../../content-types/dry-vei-ref.js";

/**
 * Turns a boxed value (`dry-vei.ts`) into a real HTML attribute at the
 * moment the element that renders it is created - the automatic half of the
 * Visual Editing Interface (`plans/vei.md`'s Lớp 1), so
 * `<div>{blog.hero.name}</div>` marks itself with no page-code change.
 *
 * Installed once, process-wide, and stateless by design: everything it needs
 * travels on the value itself, so two renders in flight at the same time
 * can't interfere - which is exactly why a marker is a self-contained string
 * rather than an index into a per-request table (decision #1 in the plan).
 * Outside an edit-mode render no value is ever boxed, so this costs one
 * `typeof` per prop and changes nothing.
 *
 * `options` is per-Preact-module-instance state, so patching the default
 * import only affects vnodes created through THAT instance. Page Builder's client-side build (`page-components/page-build.ts`)
 * builds its vnode tree through a separately-bundled, dynamically-imported
 * Preact runtime (`preact-runtime.ts`, required so `hydrate()` shares one
 * module instance with the compiled page/layout - `hydrate-built.ts`'s doc
 * comment) - a different instance than the one this file's own static
 * `preact` import resolves to. Callers with a non-default instance to patch
 * (i.e. Page Builder's client-side build (`page-components/page-build.ts`)) pass its `options` in explicitly instead of
 * relying on the default.
 */
type Props = Record<string, unknown>;

function markerFor(value: unknown): string | null {
  const ref = refOf(value);
  return ref ? encodeRef(ref) : null;
}

/**
 * Records every DIRECT child's marker and hands back the children with
 * their boxes removed. A boxed value nested inside a child element belongs
 * to that element, which gets its own marker when its own vnode is created.
 *
 * Unboxing here is not an optimization - it's required.
 * `preact-render-to-string` renders a `String` OBJECT as empty text (it
 * tests `typeof child === "string"`), so leaving the box in place would
 * blank out every marked value in the SSR HTML. Hydration would then quietly
 * refill it from the replay log, which is why this only shows up in the
 * served bytes, never in a browser. The vnode hook is the right place: it's
 * the boundary where provenance turns into an attribute, and past it the
 * value has no reason to stay wrapped.
 */
function extractMarkers(children: unknown): { markers: string[]; children: unknown } {
  const markers: string[] = [];
  const take = (child: unknown): unknown => {
    const marker = markerFor(child);
    if (!marker) return child;
    markers.push(marker);
    return unbox(child);
  };
  // One level only: an array child is a `.map()` result, whose entries are
  // siblings here, not a deeper tree.
  const next = Array.isArray(children) ? children.map(take) : take(children);
  return { markers, children: next };
}

export function installVeiMarkerHook(options: Options = defaultOptions): void {
  const previous = options.vnode;
  options.vnode = (vnode: VNode) => {
    // Host elements only - a boxed value passed to a COMPONENT keeps its box
    // and gets marked wherever that component finally renders it.
    if (typeof vnode.type === "string") {
      const props = vnode.props as Props;
      for (const key of Object.keys(props)) {
        if (key === "children" || key === "key" || key === "ref") continue;
        if (key === "dangerouslySetInnerHTML") {
          const html = (props[key] as { __html?: unknown } | null)?.__html;
          const marker = markerFor(html);
          if (marker) {
            props[`${MARKER_ATTR}-html`] = marker;
            props[key] = { __html: unbox(html) };
          }
          continue;
        }
        const marker = markerFor(props[key]);
        // `src`/`alt`/`href`/... - lower-cased because that's how the
        // attribute lands in the HTML, and how the overlay reads it back.
        if (marker) {
          props[`${MARKER_ATTR}-${key.toLowerCase()}`] = marker;
          props[key] = unbox(props[key]);
        }
      }
      const { markers, children } = extractMarkers(props.children);
      if (markers.length > 0) {
        props.children = children;
        // An explicit `dryBind()` on the same element wins: the page author
        // named a field on purpose, possibly a different one than the text
        // happens to come from.
        if (props[MARKER_ATTR] === undefined) props[MARKER_ATTR] = markers.join(" ");
      }
    }
    previous?.(vnode);
  };
}
