/**
 * `drycms_admin` - a non-`HttpOnly`, valueless hint cookie so the public
 * site's `apps/edit-launcher.ts` can decide whether to render its "Edit this
 * page" button without spending a request per anonymous visitor. It carries
 * no identity and grants nothing; `/dry` does its own real authorization
 * when the admin actually lands there.
 *
 * `Path=/` - unlike every other cookie here, which is scoped to the admin's
 * own `path` (`routes/auth.ts`'s `sessionCookieHeader`, `csrf.ts`) and so
 * never reaches a public page request at all. This is the only survivor of
 * the deleted `vei-session.ts`: the `drycms_vei` read capability existed so
 * a PUBLIC page could render an editing session server-side, and nothing
 * renders that way anymore (editing happens in Page Builder, under the admin
 * path, with the ordinary session + CSRF pair).
 */
export const ADMIN_HINT_COOKIE_NAME = "drycms_admin";

export function adminHintCookieHeader(url: URL, maxAgeSeconds: number): string {
  return `${ADMIN_HINT_COOKIE_NAME}=1; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${url.protocol === "https:" ? "; Secure" : ""}`;
}

export function clearAdminHintCookieHeader(url: URL): string {
  return `${ADMIN_HINT_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}`;
}
