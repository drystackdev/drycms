/** Shared between `render.ts` (server) and `resolve-match.ts` (server +
 * client, via `hydrate-client.ts`) - split into its own file so
 * `resolve-match.ts` doesn't have to import `render.ts` (which pulls in
 * `preact-render-to-string`, server-only weight the client bundle doesn't
 * need). */
export interface PageProps {
  params: Record<string, string | string[]>;
}

export interface LayoutProps extends PageProps {
  children?: unknown;
}
