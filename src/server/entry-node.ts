import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { applySecurityHeaders, createApiMiddleware, sendFetchResponse, toFetchRequest } from "./adapters/node.js";
import { injectClientConfig } from "./client-config.js";
import { path as adminPath } from "./config.js";
import { mimeType } from "./route-helpers.js";
import { guardPageRequest } from "./page-guard.js";
import { handlePageRequest } from "./page-handler.js";
import { handleVeiRoute } from "./vei-routes.js";
import { ADMIN_CONTENT_SECURITY_POLICY } from "./security-headers.js";

/**
 * Production entry - bundled by `vite build --ssr src/server/entry-node.ts`
 * (see `package.json`'s `build` script) into `dist/server/entry-node.js`,
 * run with plain `node` alongside the client build in `dist/client`. No Vite
 * involved at runtime, unlike `scripts/dev-server.mjs`.
 */
const clientDir = join(process.cwd(), "dist/client");
const indexHtml = injectClientConfig(readFileSync(join(clientDir, "index.html"), "utf8"));
const apiMiddleware = createApiMiddleware();

/** Serves a real file under `dist/client` if `pathname` matches one -
 * `null` (not "fall back to the shell") when it doesn't, so callers can
 * distinguish "not a static asset" from "here's the SPA shell" - the two
 * used to be the same branch when this was the only kind of non-API
   * request, but public-page routing below needs the distinction:
 * an asset request like `/assets/main-abc123.js` must never be treated as a
 * possible App Router page path. */
function tryServeStaticAsset(pathname: string, res: ServerResponse): boolean {
  const filePath = resolve(clientDir, `.${pathname}`);
  const fileRelative = relative(clientDir, filePath);
  if (pathname === "/" || !fileRelative || fileRelative.startsWith("..") || isAbsolute(fileRelative)) return false;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  applySecurityHeaders(res);
  res.setHeader("Content-Type", mimeType(filePath));
  if (/\.(?:js|mjs)$/i.test(filePath)) res.setHeader("Access-Control-Allow-Origin", "null");
  createReadStream(filePath).pipe(res);
  return true;
}

function serveAdminShell(res: ServerResponse): void {
  applySecurityHeaders(res);
  res.setHeader("Content-Security-Policy", ADMIN_CONTENT_SECURITY_POLICY);
  res.setHeader("Content-Type", "text/html");
  res.end(indexHtml);
}

/**
 * Handles a pathname outside the admin's own `path`, mirroring
 * `scripts/dev-server.mjs`'s
 * `tryServeAppRouterPage`. Unlike dev, there's no Vite middleware here to
 * have already filtered out static-asset requests, so `tryServeStaticAsset`
 * above MUST run first - see its own comment.
 */
async function serveRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    applySecurityHeaders(res);
    res.end("Bad request");
    return;
  }

  if (tryServeStaticAsset(pathname, res)) return;

  if (pathname !== adminPath && !pathname.startsWith(`${adminPath}/`)) {
    const pageResponse = await handlePageRequest(toFetchRequest(req), {});
    if (pageResponse) {
      await sendFetchResponse(pageResponse, res);
      return;
    }
    applySecurityHeaders(res);
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
    return;
  }

  serveAdminShell(res);
}

const server = createHttpServer((req, res) => {
  apiMiddleware(req, res, async () => {
    const request = toFetchRequest(req);
    const redirect = await guardPageRequest(request, {});
    if (redirect) {
      await sendFetchResponse(redirect, res);
      return;
    }
    const veiResponse = await handleVeiRoute(request, {});
    if (veiResponse) {
      await sendFetchResponse(veiResponse, res);
      return;
    }
    await serveRequest(req, res);
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`[drycms] listening on http://localhost:${port}`);
});
