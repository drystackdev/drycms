/**
 * The admin base path (`dry.config.ts`'s `path`), readable from BOTH sides -
 * deliberately with NO imports of its own.
 *
 * `server/config.ts` can't be reached from browser code: it pulls in
 * `server/options.ts`, whose `node:fs` import Vite externalizes for the
 * browser, so merely evaluating that module throws "Module node:fs has been
 * externalized for browser compatibility" - taking down every module
 * downstream of it. `storage/http-source.ts` is imported by both the admin
 * UI (FileManager, image fields) and server render code, so it used to sit
 * on exactly that fault line, breaking `/dry/media` and every
 * `/dry/content/*` route at runtime.
 *
 * Browser: `window.__DRY_CONFIG__`, injected ahead of any module script by
 * `server/client-config.ts`. Server: `config.ts` pushes the resolved value
 * in as it evaluates, which every server entry point imports long before
 * anything can read it back out. The literal below is only the fallback for
 * a context with neither (a unit test importing this module alone), and
 * matches `options.ts`'s own default.
 */
let serverPath = "/dry";

export function setAdminPath(path: string): void {
  serverPath = path;
}

export function adminPath(): string {
  if (typeof window !== "undefined" && window.__DRY_CONFIG__) return window.__DRY_CONFIG__.path;
  return serverPath;
}
