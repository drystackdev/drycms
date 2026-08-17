/**
 * Signals that `hydrate-client.ts`/`hydrate-built.ts` has finished
 * reconciling the page's DOM against its (server-replayed) vnode tree - a
 * public-page hook for anything that wants to touch that DOM without having
 * its change stomped the moment hydration catches up. Its one listener used
 * to be the public-site VEI overlay (deleted; editing now happens in Page
 * Builder, whose preview builds the DOM itself); the event stays because it
 * is the only signal a site's own script has for "hydration is done".
 *
 * Its own file (not exported from either hydrate entry) so a listener's
 * bundle doesn't pull in `hydrate-client.ts`'s much heavier
 * route-tree/match/resolve-match dependencies just for one string constant.
 */
export const HYDRATED_EVENT = "dry:hydrated";
