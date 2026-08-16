import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { join, relative, sep } from "node:path";
import { createServer as createViteServer } from "vite";

/**
 * Closes a previous `bun run dev` still running (matched by command line,
 * `pgrep`/`kill` - macOS/Linux only; an unsupported platform or missing
 * `pgrep` just no-ops) before this instance touches any port. Has to run
 * BEFORE `createViteServer()` below, not just around this file's own
 * `server.listen()`: Vite binds its HMR WebSocket port independently of the
 * main HTTP port as part of that call, so a leftover old process still
 * holding it would otherwise fail that bind with no retry.
 */
function closeExistingDevServer() {
  let output;
  try {
    output = execSync('pgrep -f "node .*scripts/dev-server\\.mjs"', { encoding: "utf8" });
  } catch {
    return; // No previous instance found, or `pgrep` isn't available.
  }
  const pids = output.trim().split("\n").filter((pid) => pid && Number(pid) !== process.pid);
  if (pids.length === 0) return;
  console.log(`[drycms] closing previous dev server (pid ${pids.join(", ")})...`);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  execSync("sleep 0.5");
}
closeExistingDevServer();

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

const { applySecurityHeaders, createApiMiddleware, toFetchRequest, sendFetchResponse } = await vite.ssrLoadModule("/src/server/adapters/node.js");
const { guardPageRequest } = await vite.ssrLoadModule("/src/server/page-guard.ts");
const { handleVeiRoute } = await vite.ssrLoadModule("/src/server/vei-routes.ts");
const { injectClientConfig } = await vite.ssrLoadModule("/src/server/client-config.ts");
const { ADMIN_CONTENT_SECURITY_POLICY } = await vite.ssrLoadModule("/src/server/security-headers.ts");
const { path: adminPath, content, pagesSourceStorage } = await vite.ssrLoadModule("/src/server/config.ts");
const apiMiddleware = createApiMiddleware();

/**
 * The dev-only live route source `page-handler.ts`'s `handlePageRequest`
 * accepts as its 4th param (`DevPagesSource`, `route-tree.ts`) - lets
 * `discoverRoutes()` build its tree directly from `pagesSourceStorage`
 * (`.dry/pages-source`), with real
 * files read/compiled live through THIS Vite instance's own
 * `ssrLoadModule` (full JSX/TS transform + `app-router-plugin.ts`'s
 * ambient-global injection, which also gates on this same root - see that
 * file's own doc comment). `null` under any storage kind other than
 * `"local"` (R2-backed `pagesSourceStorage` has no local files for
 * `ssrLoadModule` to read - `bun run dev` always resolves `kind: "local"`
 * (`vite.config.ts`'s `DRYCMS_WORKER_BUILD` is only set for the Workers
 * build/dev, see `src/server/config.ts`), so this is defensive, not a real
 * branch this repo hits).
 */
const { createStorageAdapter } = await vite.ssrLoadModule("/src/storage/index.ts");
const pagesSourceAdapter = pagesSourceStorage.kind === "local" ? createStorageAdapter(pagesSourceStorage) : null;
// Root-relative URL prefix the BROWSER can fetch these same files through -
// Vite's dev middleware transforms any real file under the project root on
// request, dotfolder included (confirmed live), so this needs no dedicated
// middleware, just the right root-relative path. `relative()` (not a
// hardcoded "/.dry/pages-source") so a customized `dry.config.ts` local data
// root still resolves correctly.
const pagesSourceUrlPrefix = pagesSourceStorage.kind === "local" ? `/${relative(process.cwd(), pagesSourceStorage.root).split(sep).join("/")}` : null;
const devPagesSource = pagesSourceAdapter && {
  async listPaths() {
    const entries = await pagesSourceAdapter.listAll();
    return entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);
  },
  async loadModule(relPath) {
    return vite.ssrLoadModule(join(pagesSourceStorage.root, relPath));
  },
  async readSource(relPath) {
    return readFile(join(pagesSourceStorage.root, relPath), "utf-8");
  },
  browserUrlFor(relPath) {
    return `${pagesSourceUrlPrefix}/${relPath}`;
  },
};

/**
 * Regenerates `.dry/dry.generated.d.ts` (see `plans/reader.md`) once on
 * startup, so a fresh checkout has correct `dry()` types after this first
 * run without any manual step - `bun run dry:generate`
 * (`scripts/dry-generate.ts`) covers the mid-session case (schema changed,
 * no restart) this can't. `content.engine
 * === "D1"` has no local binding to read here, same as that script - skipped
 * silently rather than logging a scary, expected error on every D1 dev
 * startup. Never fatal: a codegen bug must not block the dev server itself.
 */
try {
  if (content.engine !== "D1") {
    const { createContentEngineAdapter } = await vite.ssrLoadModule("/src/content-types/engine/index.ts");
    const { generateDryTypes } = await vite.ssrLoadModule("/src/content-types/codegen.ts");
    const { writeGeneratedDryTypes } = await vite.ssrLoadModule("/src/content-types/types-cache.ts");
    const adapter = createContentEngineAdapter(content);
    const allTypes = await adapter.listContentTypes();
    await writeGeneratedDryTypes(generateDryTypes(allTypes), { env: {} });
    console.log(`[drycms] generated dry.generated.d.ts (${allTypes.length} content types)`);
  }
} catch (error) {
  console.error("[drycms] failed to generate dry.generated.d.ts:", error);
}

/**
 * The site's own pages (see `plans/app-router.md`) - only for a pathname
 * OUTSIDE the admin's own `path`, symmetric to `routers/App.tsx`'s
 * `AuthGate` (which renders nothing for exactly that space today). Loads
 * `page-handler.ts` fresh via `vite.ssrLoadModule` on EVERY call (not
 * hoisted like the modules above) so a page/layout added or edited while
 * this dev server is running is picked up without a restart - this is the
 * one module whose whole job is "trên dev có thể vào xem trực tiếp live
 * preview qua vite", unlike the rest of `src/server/**` (see
 * `status/content-type-staged-apply.md`'s note on that restart caveat).
 * Passes `devPagesSource` (live `.dry/pages-source`, see this file's own
 * doc comment above) as the explicit 4th arg, with `isDev` itself left
 * `undefined` so `handlePageRequest`'s own default (`import.meta.env.DEV`)
 * still decides that. Returns `true` if it fully handled the response
 * (matched or a real 404), `false` to fall through to the admin SPA shell.
 */
async function tryServeAppRouterPage(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === adminPath || url.pathname.startsWith(`${adminPath}/`)) return false;

  const { handlePageRequest } = await vite.ssrLoadModule("/src/server/page-handler.ts");
  const response = await handlePageRequest(toFetchRequest(req), {}, undefined, devPagesSource);
  if (!response) {
    applySecurityHeaders(res);
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
    return true;
  }
  await sendFetchResponse(response, res);
  return true;
}

const server = createHttpServer((req, res) => {
  apiMiddleware(req, res, () => {
    guardPageRequest(toFetchRequest(req), {}).then(async (redirect) => {
      if (redirect) return sendFetchResponse(redirect, res);
      const veiResponse = await handleVeiRoute(toFetchRequest(req), {});
      if (veiResponse) return sendFetchResponse(veiResponse, res);
      vite.middlewares(req, res, async () => {
        try {
          if (await tryServeAppRouterPage(req, res)) return;

          const url = req.url ?? "/";
          let html = readFileSync("index.html", "utf8");
          html = await vite.transformIndexHtml(url, html);
          html = injectClientConfig(html);
          applySecurityHeaders(res);
          res.setHeader("Content-Security-Policy", ADMIN_CONTENT_SECURITY_POLICY);
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        } catch (error) {
          vite.ssrFixStacktrace(error);
          console.error(error);
          res.statusCode = 500;
          applySecurityHeaders(res);
          res.end("Internal server error");
        }
      });
    });
  });
});

const port = Number(process.env.PORT) || 5173;
server.listen(port, () => {
  console.log(`[drycms] dev server: http://localhost:${port}`);
});
