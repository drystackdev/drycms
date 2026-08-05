import {
  ENTRY_SAVE_EVENT,
  listenForEntrySaved,
  listenForFieldInput,
  type FieldInputEventDetail,
} from "../content-entry-editor/field-events.js";

/**
 * Admin half of the Visual Editing Interface bridge (`plans/vei.md`). Runs
 * only inside the dialog iframe (`?_vei=1`), and its whole job is to relay
 * the entry editor's existing `window` CustomEvents to the public page
 * hosting it.
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

export type VeiMessage = VeiInputMessage | VeiReadyMessage | VeiSavedMessage | VeiCloseMessage;

/** True when this document is the VEI dialog - `?_vei=1` AND actually
 * framed. Both, not either: the flag alone would let a normal tab lose its
 * chrome if the URL were ever shared or bookmarked. */
export function isVeiFrame(): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  return new URLSearchParams(window.location.search).get(VEI_PARAM) === "1";
}

/**
 * `targetOrigin` is this document's own origin rather than `"*"`: the
 * overlay is always same-origin (an iframe under the admin path, embedded
 * by a page of the same site - see `X-Frame-Options: SAMEORIGIN` in
 * `adapters/node.ts`), so anything cross-origin has no business receiving
 * entry contents as they're typed.
 */
function post(message: VeiMessage): void {
  window.parent.postMessage(message, window.location.origin);
}

export function startVeiBridge(): () => void {
  const stopInput = listenForFieldInput((detail) => post({ type: "vei:input", detail }));
  const stopSaved = listenForEntrySaved(({ ok }) => post({ type: "vei:saved", ok }));
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if ((event.data as { type?: string } | null)?.type === "vei:save") {
      window.dispatchEvent(new CustomEvent(ENTRY_SAVE_EVENT));
    }
  };
  // Escape inside the frame can't reach the hosting page's own listener, so
  // the dialog would otherwise only be closable by clicking its backdrop.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") post({ type: "vei:close" });
  };
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", onKeyDown);
  post({ type: "vei:ready" });
  return () => {
    stopInput();
    stopSaved();
    window.removeEventListener("message", onMessage);
    window.removeEventListener("keydown", onKeyDown);
  };
}
