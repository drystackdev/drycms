/**
 * The public site's only editing affordance: one floating "Edit" button that
 * navigates a signed-in admin into Page Builder at the route they're looking
 * at (`/dry/page-builder?path=<pathname+search>`). Page Builder's own dock
 * has the return leg (`page-builder/Dock.tsx`'s close button).
 *
 * Replaces `apps/vei/overlay.ts` (deleted): the public site no longer runs an
 * inline editing overlay of its own, so nothing here needs markers, an entry
 * dialog, drafts, or the `drycms_vei` cookie the old `/vei/enter` route
 * minted. What survives is exactly the gating mechanism that one used - the
 * `drycms_admin` hint cookie, read CLIENT-side. That matters: built HTML is
 * cached and shared by every visitor (`app-router/edge-cache.ts`,
 * `pages-cache.ts`), so whether the button renders can never be baked into
 * the document itself. The cookie is a hint only; it grants nothing, and
 * `/dry` does its own real authorization when the admin lands there.
 */
interface EditLauncherConfig {
  /** The admin's base path (`DryOption.path`) - the site bundle has no other
   * way to know it. */
  path: string;
}

const CONFIG_ELEMENT_ID = "dry-edit-config";
const HINT_COOKIE = "drycms_admin=1";
const HOST_ID = "dry-edit-launcher";

const EDIT_ICON = `<svg viewBox="0 0 24 24" width="1.25em" height="1.25em" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" d="M4 22h16"/><path d="m13.888 3.663l.742-.742a3.146 3.146 0 1 1 4.449 4.45l-.742.74m-4.449-4.448s.093 1.576 1.483 2.966s2.966 1.483 2.966 1.483m-4.449-4.45L7.071 10.48c-.462.462-.693.692-.891.947a5.2 5.2 0 0 0-.599.969c-.139.291-.242.601-.449 1.22l-.875 2.626m14.08-8.13l-6.817 6.817c-.462.462-.692.692-.947.891q-.451.352-.969.599c-.291.139-.601.242-1.22.448l-2.626.876m0 0l-.641.213a.848.848 0 0 1-1.073-1.073l.213-.641m1.501 1.5l-1.5-1.5"/></g></svg>`;

/** Hand-written rather than sharing the admin's `tokens.css` the way
 * `overlay-styles.ts` did (it inlined the whole palette because it styled a
 * dock, a backdrop, a resizable panel and a framed form). One button needs
 * two colors, and `light-dark()` covers both schemes without shipping the
 * palette to every public page view.
 *
 * The GEOMETRY, though, is not free-hand: this button is the same circle
 * Page Builder opens as (`pages/PageBuilder.tsx`'s loading circle, which
 * then expands into `page-builder/Dock.tsx`), so clicking it must not make
 * the control change size on the way in. That means the dock's own resting
 * footprint, in the px those `rem`/`em` values resolve to in the admin:
 * 54x54 outer (8px padding + a 36px round action), a 32px radius, and a
 * 1.25em icon at the dock's 14px font size = 17.5px. */
const STYLES = `
:host { all: initial; }
.launcher {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483000;
  color-scheme: light dark;
}
button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  padding: 0;
  font-size: 14px;
  border-radius: 32px;
  cursor: pointer;
  background: light-dark(#ffffff, #1b1b1f);
  color: light-dark(#18181b, #f4f4f5);
  border: 1px solid light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.16));
  box-shadow: 0 10px 24px -8px rgba(0, 0, 0, 0.45);
}
button:hover { background: light-dark(#f4f4f5, #26262b); }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
@media print { .launcher { display: none; } }
`;

function readConfig(): EditLauncherConfig | null {
  const element = document.getElementById(CONFIG_ELEMENT_ID);
  if (!element?.textContent) return null;
  try {
    return JSON.parse(element.textContent) as EditLauncherConfig;
  } catch {
    return null;
  }
}

function hasAdminHint(): boolean {
  return document.cookie.split(";").some((part) => part.trim() === HINT_COOKIE);
}

function builderUrl(adminPath: string): string {
  const target = `${window.location.pathname}${window.location.search}`;
  return `${adminPath}/page-builder?path=${encodeURIComponent(target)}`;
}

function main(): void {
  const config = readConfig();
  if (!config || !hasAdminHint()) return;
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;

  const wrapper = document.createElement("div");
  wrapper.className = "launcher";

  const button = document.createElement("button");
  button.type = "button";
  button.title = "Edit this page";
  button.setAttribute("aria-label", "Edit this page");
  button.innerHTML = EDIT_ICON;
  button.addEventListener("click", () => {
    window.location.href = builderUrl(config.path);
  });

  wrapper.append(button);
  root.append(style, wrapper);
  document.body.append(host);
}

main();
