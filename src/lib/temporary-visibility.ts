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
  // The route stays live and reachable directly (Build all still runs from
  // it); only the sidebar link is hidden. Its `?autoBuild=` mode has had no
  // caller since the public-site VEI overlay was deleted - that overlay
  // pointed a hidden iframe at it for a headless rebuild-after-save.
  pageBuild: false,
} as const;
