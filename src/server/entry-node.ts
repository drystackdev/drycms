import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createApiMiddleware } from "./adapters/node.js";
import { mimeType } from "./route-helpers.js";

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
  const filePath = join(clientDir, url.pathname);
  if (url.pathname !== "/" && filePath.startsWith(clientDir) && existsSync(filePath) && statSync(filePath).isFile()) {
    res.setHeader("Content-Type", mimeType(filePath));
    createReadStream(filePath).pipe(res);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(indexHtml);
}

const server = createHttpServer((req, res) => {
  apiMiddleware(req, res, () => serveShellOrAsset(req, res));
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`[drycms] listening on http://localhost:${port}`);
});
