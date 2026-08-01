import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";

/**
 * Dev entry - deliberately plain JS (not TypeScript): this is the one file
 * that has to run in Node *before* any Vite transform is available, since
 * it's the thing creating the Vite dev server in the first place. Every
 * other server file (`src/server/**`) is real TypeScript, loaded here via
 * `vite.ssrLoadModule` - the standard Vite "custom SSR server" pattern - so
 * none of it needs precompiling in dev. See `status/remove-astro.md`.
 */
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});

const { createApiMiddleware, toFetchRequest, sendFetchResponse } = await vite.ssrLoadModule("/src/server/adapters/node.js");
const { guardPageRequest } = await vite.ssrLoadModule("/src/server/page-guard.ts");
const apiMiddleware = createApiMiddleware();

const server = createHttpServer((req, res) => {
  apiMiddleware(req, res, () => {
    guardPageRequest(toFetchRequest(req), {}).then((redirect) => {
      if (redirect) return sendFetchResponse(redirect, res);
      vite.middlewares(req, res, async () => {
        try {
          const url = req.url ?? "/";
          let html = readFileSync("index.html", "utf8");
          html = await vite.transformIndexHtml(url, html);
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        } catch (error) {
          vite.ssrFixStacktrace(error);
          res.statusCode = 500;
          res.end(error instanceof Error ? error.stack : String(error));
        }
      });
    });
  });
});

const port = Number(process.env.PORT) || 5173;
server.listen(port, () => {
  console.log(`[drycms] dev server: http://localhost:${port}`);
});
