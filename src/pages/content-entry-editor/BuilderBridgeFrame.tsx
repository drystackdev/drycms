import { Fragment, type ComponentChildren } from "preact";
import Toaster from "../../components/Toast.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";

/**
 * Bare-mode chrome for the entry-editor iframe Page Builder's visual editing
 * panel embeds (`?_vei=1` - see `routers/App.tsx`'s `Chrome`, and
 * `page-builder/VeiEntryFrame.tsx`, its only host now that the public-site
 * overlay is gone). Skipping
 * `DryLayout` entirely (the point of bare mode - no sidebar/topbar around a
 * modal) also skips everything else `DryLayout` happens to own: `.main`'s
 * `useOverlayScrollbars` viewport, `.content`'s padding, and the
 * `<Toaster />` mount. Without a replacement, the entry form rendered flush
 * against the iframe's edges with the browser's own unstyled scrollbar (or
 * didn't scroll at all if the iframe was shorter than the form), AND a
 * failed save's error toast (`ContentEntryEditor.tsx`'s `handleSave`) had
 * nowhere to render - it would call `toast.add(...)` into a stack that was
 * simply never mounted. This restores exactly those three things, at the
 * scale a compact dialog (not a full page) calls for.
 */
export default function BuilderBridgeFrame({ children }: { children: ComponentChildren }) {
  const { ref } = useOverlayScrollbars<HTMLDivElement>();

  return (
    <Fragment>
      <div class="vei-frame" ref={ref}>
        <div class="vei-frame-content">{children}</div>
      </div>
      {/* Kept OUTSIDE the OverlayScrollbars host - that hook moves its ref'd
       * element's real content into an internal `.os-viewport` child it
       * generates, and the toast stack's own `position: fixed` popover has
       * no reason to be subject to that rewrite. */}
      <Toaster position="bottom-start" />
    </Fragment>
  );
}
