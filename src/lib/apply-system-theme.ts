/**
 * Links the Super Admin's shared theme (`routes/system-settings.ts`'s
 * rendered `.dry { --dry-*: ...; }` override) into every admin page load -
 * imported once, for its side effect, at the top of `main.tsx` so it's
 * present before the login/register screens too (they share the same
 * `.dry` root as the authenticated app, see `AuthGate` in `routers/App.tsx`).
 * Plain DOM, no framework involved, same idiom `lib/native/theme.ts` already
 * uses for the light/dark toggle.
 *
 * The stylesheet itself always beats `tokens.css`'s shipped defaults (it's
 * deliberately unlayered - see that route's own doc comment) - that part
 * was never the bug. The actual bug: a `<link>` fetched once at boot never
 * refetches on its own, so an already-open tab kept showing whatever colors
 * were live when it first loaded, even after `Settings.tsx` saved new ones
 * server-side (confirmed - a hard reload always showed the new color; nothing
 * short of one did). `reapplySystemTheme` is `Settings.tsx`'s fix: force a
 * refetch of the SAME `<link>` (found via `THEME_LINK_MARKER`, not
 * recreated) right after a successful save, with a cache-busting query
 * param so an intermediate proxy/browser cache can't serve the stale body
 * back.
 */

function themeHref(): string {
  const { path } = window.__DRY_CONFIG__;
  return `${path}/api/system-settings/theme.css`;
}

function findOrCreateThemeLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>("link[data-dry-system-theme]");
  if (existing) return existing;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.dataset.drySystemTheme = "true";
  document.head.appendChild(link);
  return link;
}

findOrCreateThemeLink().href = themeHref();

/** Refetches the shared theme stylesheet in place - call right after a
 * `systemSettings` save (`Settings.tsx`) so the CURRENTLY OPEN tab reflects
 * the new colors immediately, without asking the admin to reload. Reusing
 * the same `<link>` (reassigning `href`) rather than swapping in a new
 * element keeps the old styles applied while the new body loads - no flash
 * of unstyled `.dry` content. */
export function reapplySystemTheme(): void {
  findOrCreateThemeLink().href = `${themeHref()}?t=${Date.now()}`;
}
