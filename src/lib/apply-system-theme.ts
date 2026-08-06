/**
 * Links the Super Admin's shared theme (`routes/system-settings.ts`'s
 * rendered `.dry { --dry-*: ...; }` override) into every admin page load -
 * imported once, for its side effect, at the top of `main.tsx` so it's
 * present before the login/register screens too (they share the same
 * `.dry` root as the authenticated app, see `AuthGate` in `routers/App.tsx`).
 * Plain DOM, no framework involved, same idiom `lib/native/theme.ts` already
 * uses for the light/dark toggle.
 */

const { path } = window.__DRY_CONFIG__;

const link = document.createElement("link");
link.rel = "stylesheet";
link.href = `${path}/api/system-settings/theme.css`;
document.head.appendChild(link);
