import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { applySecurityHeaders, createApiMiddleware, sendFetchResponse, toFetchRequest } from "./adapters/node.js";
import { mimeType } from "./route-helpers.js";
import { guardPageRequest } from "./page-guard.js";

/**
 * Production entry - bundled by `vite build --ssr src/server/entry-node.ts`
 * (see `package.json`'s `build` script) into `dist/server/entry-node.js`,
 * run with plain `node` alongside the client build in `dist/client`. No Vite
 * involved at runtime, unlike `scripts/dev-server.mjs`.
 */
const clientDir = join(process.cwd(), "dist/client");
const indexHtml = readFileSync(join(clientDir, "index.html"), "utf8");
const apiMiddleware = createApiMiddleware();

function serveShellOrAsset(req: IncomingMessage, res: ServerResponse): void {
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
  const filePath = resolve(clientDir, `.${pathname}`);
  const fileRelative = relative(clientDir, filePath);
  if (pathname !== "/" && fileRelative && !fileRelative.startsWith("..") && !isAbsolute(fileRelative) && existsSync(filePath) && statSync(filePath).isFile()) {
    applySecurityHeaders(res);
    res.setHeader("Content-Type", mimeType(filePath));
    createReadStream(filePath).pipe(res);
    return;
  }
  applySecurityHeaders(res);
  res.setHeader("Content-Type", "text/html");
  res.end(indexHtml);
}

const server = createHttpServer((req, res) => {
  apiMiddleware(req, res, async () => {
    const redirect = await guardPageRequest(toFetchRequest(req), {});
    if (redirect) {
      await sendFetchResponse(redirect, res);
      return;
    }
    serveShellOrAsset(req, res);
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`[drycms] listening on http://localhost:${port}`);
});
