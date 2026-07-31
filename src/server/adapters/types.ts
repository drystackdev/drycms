/**
 * `server/handler.ts` is already Fetch-API-shaped (`Request` in, `Response`
 * out), so a platform whose native handler already speaks Fetch - Cloudflare
 * Workers' `fetch(request, env, ctx)`, Bun's `Bun.serve({ fetch })` - needs
 * no real adapter code at all, just a thin entry file that calls
 * `handleApiRequest` directly with the request/env it was given.
 *
 * Node is the one exception: `http.IncomingMessage`/`http.ServerResponse`
 * aren't Fetch API objects, so `adapters/node.ts` does real bridging work.
 * This type documents that bridge's shape so a future adapter (Worker, Bun)
 * can be checked against the same contract even though most of them won't
 * need to implement it.
 */
export interface DryAdapter {
  /** Human-readable name, logged at startup. */
  name: string;
  /** Starts serving `handleApiRequest` (+ the admin UI's static shell/assets)
   * on `port`. Resolves once listening. */
  listen(port: number): Promise<void>;
}
