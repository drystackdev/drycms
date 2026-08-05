/**
 * Signals that `hydrate-client.ts` has finished reconciling the page's DOM
 * against its (server-replayed) vnode tree. `apps/vei/overlay.ts` needs this:
 * hydration overwrites any DOM text/attribute that doesn't match its vnode,
 * so a VEI draft reapplied before hydration finishes gets silently stomped
 * the moment hydration catches up - reapplying has to wait its turn instead.
 * Its own file (not exported from either side) so overlay.ts's public-page
 * bundle doesn't pull in `hydrate-client.ts`'s much heavier
 * route-tree/match/resolve-match dependencies just for one string constant.
 */
export const HYDRATED_EVENT = "dry:hydrated";
