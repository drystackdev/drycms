/**
 * Temporary product visibility switches for unfinished features.
 *
 * Keep the implementations, routes and persisted data intact while these
 * switches are off; turn a switch back on when the corresponding feature is
 * ready to continue development.
 */
export const temporaryFeatureVisibility = {
  richtextComponents: false,
  contentTypeComponents: true,
  richtextComponentInsert: false,
  // The route stays live and reachable directly - VEI's `overlay.ts` points
  // a hidden iframe at this page's `?autoBuild=` mode for its own headless
  // rebuild-after-save (`page-build.ts`'s doc comment), so the page itself
  // must keep working. Only the sidebar link is hidden.
  pageBuild: false,
} as const;
