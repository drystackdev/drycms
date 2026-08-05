/**
 * Temporary product visibility switches for unfinished features.
 *
 * Keep the implementations, routes and persisted data intact while these
 * switches are off; turn a switch back on when the corresponding feature is
 * ready to continue development.
 */
export const temporaryFeatureVisibility = {
  pageComponents: false,
  richtextComponents: false,
  codeEditerDemo: false,
  contentTypeComponents: false,
  richtextComponentInsert: false,
} as const;
