/**
 * The client-safe subset of the resolved dry config - aliased onto the bare
 * specifier `virtual:drycms/config` by `vite.config.ts` (see its
 * `resolve.alias`), so every client file that imports that specifier keeps
 * working unchanged. Deliberately narrower than `server/config.ts`'s
 * `resolved`: `storage`/`icons`/a `sqlite` `content.file` can carry an
 * absolute filesystem path or a token, neither of which has any business in
 * a browser bundle.
 */
export const path: string = __DRY_PATH__;
export const contentEngine: "sqlite" | "D1" | "file" = __DRY_CONTENT_ENGINE__;

export default { path, contentEngine };
