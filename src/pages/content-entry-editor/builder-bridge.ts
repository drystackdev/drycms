import {
  dispatchEntrySave,
  listenForEntrySaved,
  listenForFieldFocus,
  listenForFieldInput,
  type FieldFocusEventDetail,
  type FieldInputEventDetail,
} from "./field-events.js";

/**
 * Admin half of the visual-editing bridge. Runs only inside the entry-editor
 * iframe (`?_vei=1`), and its whole job is to relay the entry editor's
 * existing `window` CustomEvents to the page hosting it - today that host is
 * always Page Builder's `page-builder/VeiEntryFrame.tsx`. It used to also
 * serve the public site's VEI overlay (`apps/vei/overlay.ts`), which is why
 * the message names are still `vei:*`; that overlay is gone, and the public
 * site now only deep-links into Page Builder (`apps/edit-launcher.ts`).
 *
 * `field-events.ts` was written for exactly this - its own doc comment
 * offers "an AI assist feature, a browser extension, any other plugin" a way
 * to "observe and drive the entry/singleton edit form" without importing
 * anything. This module is that consumer, so nothing in `ContentEntryEditor`
 * needs to know a bridge exists.
 */
export const VEI_PARAM = "_vei";

export interface VeiInputMessage {
  type: "vei:input";
  detail: FieldInputEventDetail;
}

export interface VeiFocusMessage {
  type: "vei:focus";
  detail: FieldFocusEventDetail;
}

export interface VeiReadyMessage {
  type: "vei:ready";
}

export interface VeiSavedMessage {
  type: "vei:saved";
  ok: boolean;
}

export interface VeiCloseMessage {
  type: "vei:close";
}

export interface VeiBackMessage {
  type: "vei:back";
}

export type VeiMessage =
  | VeiInputMessage
  | VeiFocusMessage
  | VeiReadyMessage
  | VeiSavedMessage
  | VeiBackMessage
  | VeiCloseMessage;

/** True when this document is the VEI dialog - `?_vei=1` AND actually
 * framed. Both, not either: the flag alone would let a normal tab lose its
 * chrome if the URL were ever shared or bookmarked. */
export function isVeiFrame(): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  return new URLSearchParams(window.location.search).get(VEI_PARAM) === "1";
}

/**
 * `targetOrigin` is this document's own origin rather than `"*"`: the host is
 * always same-origin (an iframe under the admin path, embedded by an admin
 * page - see `X-Frame-Options: SAMEORIGIN` in `adapters/node.ts`), so
 * anything cross-origin has no business receiving entry contents as they're
 * typed.
 */
function post(message: VeiMessage): void {
  window.parent.postMessage(message, window.location.origin);
}

/** Tells the host to close the panel - used both by the Escape handler below
 * and by `ContentEntryEditor`'s own Cancel button, which is the one the
 * visible form offers. A no-op outside the framed case - nothing is listening
 * on the other end. */
export function closeVeiDialog(): void {
  post({ type: "vei:close" });
}

/** Returns the framed editor/list to Page Builder's content-type chooser. */
export function backVeiBrowser(): void {
  post({ type: "vei:back" });
}

export function startVeiBridge(navigate: (url: string) => void): () => void {
  const stopInput = listenForFieldInput((detail) => post({ type: "vei:input", detail }));
  const stopFocus = listenForFieldFocus((detail) => post({ type: "vei:focus", detail }));
  const stopSaved = listenForEntrySaved(({ ok }) => post({ type: "vei:saved", ok }));
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const data = event.data as { type?: string; url?: string } | null;
    // `dispatchEntrySave` rather than a raw event: this message routinely
    // arrives before `ContentEntryEditor` has mounted (the host answers
    // `vei:ready` immediately, and `vei:ready` comes from `App.tsx`'s own
    // mount effect), and only the latch inside it keeps the request alive
    // until an editor can act on it - see `field-events.ts`.
    if (data?.type === "vei:save") {
      dispatchEntrySave();
    } else if (data?.type === "vei:navigate" && typeof data.url === "string") {
      // The host re-points an already-open panel at a different admin route
      // by sending this instead of reassigning `iframe.src` -
      // this frame is already running the same Preact SPA a hard load would
      // boot, so it retargets its OWN client-side router (`preact-iso`)
      // rather than tearing the whole document down and re-parsing/
      // re-hydrating the bundle for every field click
      // (`VeiEntryFrame.tsx`'s own navigate effect).
      navigate(data.url);
    }
  };
  // Escape inside the frame can't reach the hosting page's own listener, so
  // the dialog would otherwise only be closable by clicking its backdrop.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeVeiDialog();
  };
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", onKeyDown);
  post({ type: "vei:ready" });
  return () => {
    stopInput();
    stopFocus();
    stopSaved();
    window.removeEventListener("message", onMessage);
    window.removeEventListener("keydown", onKeyDown);
  };
}
