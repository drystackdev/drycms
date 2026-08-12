/**
 * Pushes `src/content-types/demo-seed.ts`'s demo project (content types,
 * entries, public page source) into a RUNNING drycms server, over the
 * ordinary admin HTTP API.
 *
 * Run with:
 *   bun run seed:demo                          # http://localhost:5173/dry
 *   bun run seed:demo -- --base http://localhost:8787/dry
 *   bun run seed:demo -- --wait 60             # poll that long for the server
 *
 * HTTP rather than importing the engines directly, on purpose: under
 * `dev:worker` the data lives in miniflare's own D1/R2, reachable only
 * through `getPlatformProxy`, which does not work under `bun` at all
 * (`scripts/sync-pages-r2.ts`'s doc comment has the details). Talking to the
 * server that already owns those bindings sidesteps that entirely, and gets
 * the same permission/validation/migration path a human clicking through the
 * admin would - a seed that passes here can't produce state the UI couldn't.
 *
 * Idempotent: content types are matched by their fixed `demo-*` ids and
 * updated in place, entries by `slug` within their type, page sources
 * overwritten (`PUT` is create-or-replace). Re-running never duplicates.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { demoContentTypes, demoEntries, demoPageSources } from "../src/content-types/demo-seed.js";
import type { ContentTypeDefinition } from "../src/content-types/types.js";

const args = process.argv.slice(2);

function flag(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

const base = flag("base", process.env.DRYCMS_SEED_BASE ?? "http://localhost:5173/dry").replace(/\/$/, "");
const waitSeconds = Number(flag("wait", "0"));
/** Write only the page sources, straight to disk, with no running server -
 * see `writePageSourcesToDisk` for why `dev:worker` needs that step first. */
const pagesOnly = args.includes("--pages-only");
/** Overwrite page sources that already exist (content types/entries are
 * always rewritten - this only relaxes the "don't clobber page source" rule). */
const force = args.includes("--force");
const email = flag("email", process.env.DRYCMS_SEED_EMAIL ?? "admin@example.com");
const password = flag("password", process.env.DRYCMS_SEED_PASSWORD ?? "Khan@13149255");
const name = flag("name", "Admin");

/** Every cookie the server has set so far, as one `Cookie` header value -
 * hand-rolled rather than pulling in a cookie jar dependency, matching how
 * the rest of `scripts/` avoids runtime deps for glue this small. */
const cookies = new Map<string, string>();

function rememberCookies(response: Response): void {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const separator = pair!.indexOf("=");
    if (separator === -1) continue;
    cookies.set(pair!.slice(0, separator), pair!.slice(separator + 1));
  }
}

function cookieHeader(): string {
  return [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function api(path: string, init: RequestInit & { raw?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookies.size > 0) headers.set("Cookie", cookieHeader());
  // Same double-submit CSRF contract the browser client uses
  // (`lib/native/csrf-fetch.ts`) - the readable cookie echoed back as a header.
  const csrf = cookies.get("drycms_csrf");
  if (csrf && init.method && init.method !== "GET") headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  rememberCookies(response);
  return response;
}

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`[drycms] ${what} failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
  }
  return (await response.json()) as T;
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    try {
      const response = await api("/api/auth/session");
      if (response.ok) return;
    } catch {
      // Not listening yet - keep polling until the deadline.
    }
    if (Date.now() >= deadline) throw new Error(`[drycms] no server answered at ${base} within ${waitSeconds}s.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function authenticate(): Promise<void> {
  const session = await json<{ hasAnyUser: boolean; user: unknown }>(await api("/api/auth/session"), "session check");
  if (session.user) return;

  if (!session.hasAnyUser) {
    const bootstrapToken = process.env.DRYCMS_BOOTSTRAP_TOKEN;
    if (!bootstrapToken) throw new Error("[drycms] this server has no users yet - set DRYCMS_BOOTSTRAP_TOKEN so the first Super Admin can be registered.");
    await json(
      await api("/api/auth/register-first-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DryCMS-Bootstrap-Token": bootstrapToken },
        body: JSON.stringify({ name, email, password }),
      }),
      "first-admin registration",
    );
    console.log(`[drycms] registered the first Super Admin (${email}).`);
    return;
  }

  await json(
    await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
    `login as ${email}`,
  );
}

/** The server's current copy of `id`, or `undefined` if it has never been
 * saved. Re-read immediately before every save rather than taken from one
 * upfront listing: saving ONE type can bump another's version (a relation
 * makes its target grow a `relationmirror` field, a component field
 * re-resolves its component), so a snapshot taken at the start is already
 * stale by the second write and the save 409s on `version_conflict`. */
async function currentDefinition(id: string): Promise<ContentTypeDefinition | undefined> {
  const response = await api(`/api/content-types/${encodeURIComponent(id)}`);
  if (response.status === 404) return undefined;
  return (await json<{ definition: ContentTypeDefinition }>(response, `loading content type "${id}"`)).definition;
}

async function seedContentTypes(): Promise<ContentTypeDefinition[]> {
  for (const definition of demoContentTypes()) {
    const current = await currentDefinition(definition.id);
    // `version` is the schema's optimistic-concurrency counter - an update
    // has to echo the server's current one back, a create starts at 0.
    const body = JSON.stringify({ definition: { ...definition, version: current?.version ?? 0 }, confirm: true });
    const response = current
      ? await api(`/api/content-types/${encodeURIComponent(definition.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body })
      : await api("/api/content-types", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    await json(response, `saving content type "${definition.name}"`);
    console.log(`[drycms] ${current ? "updated" : "created"} content type ${definition.name}`);
  }

  return (await json<{ definitions: ContentTypeDefinition[] }>(await api("/api/content-types"), "content-type listing")).definitions;
}

async function seedEntries(definitions: ContentTypeDefinition[]): Promise<void> {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  /** `"<typeId>:<slug>"` -> the row's real (hashed) id, filled in as rows are
   * created so a later row's relation fields can be resolved. */
  const idsBySlug = new Map<string, string>();

  for (const seed of demoEntries()) {
    const type = byId.get(seed.typeId);
    if (!type) throw new Error(`[drycms] demo entry references unknown content type "${seed.typeId}".`);

    const value: Record<string, unknown> = { ...seed.value };
    for (const [fieldName, targetSlugs] of Object.entries(seed.relations ?? {})) {
      const field = type.fields.find((candidate) => candidate.name === fieldName)!;
      const ids = targetSlugs.map((slug) => {
        const id = idsBySlug.get(`${String(field.config.target)}:${slug}`);
        if (!id) throw new Error(`[drycms] demo entry "${seed.slug}" points at "${slug}", which hasn't been created yet.`);
        return id;
      });
      value[fieldName] = field.config.cardinality === "manyToOne" ? (ids[0] ?? null) : ids;
    }

    if (type.kind === "singleton") {
      const saved = await json<{ entry: { id: string } }>(
        await api(`/api/content/${encodeURIComponent(type.name)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
        `saving ${type.name}`,
      );
      console.log(`[drycms] saved singleton ${type.name} (${saved.entry.id})`);
      continue;
    }

    const listed = await json<{ rows: { id: string; value: Record<string, unknown> }[] }>(
      await api(`/api/content/${encodeURIComponent(type.name)}?page=0&pageSize=200`),
      `listing ${type.name}`,
    );
    const existing = listed.rows.find((row) => row.value.slug === seed.slug);
    const saved = await json<{ entry: { id: string } }>(
      existing
        ? await api(`/api/content/${encodeURIComponent(type.name)}/${encodeURIComponent(existing.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(value),
          })
        : await api(`/api/content/${encodeURIComponent(type.name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(value),
          }),
      `saving ${type.name}/${seed.slug}`,
    );
    idsBySlug.set(`${seed.typeId}:${seed.slug}`, saved.entry.id);
    console.log(`[drycms] ${existing ? "updated" : "created"} ${type.name}/${seed.slug}`);
  }
}

async function seedPageSources(): Promise<void> {
  for (const { path, source } of demoPageSources()) {
    const url = `/api/pages-source/${path.split("/").map(encodeURIComponent).join("/")}`;
    // Never overwrite: unlike a content type (whose shape this script owns),
    // a page's source is something the admin edits in the Page Editor, and
    // re-running the seed must not throw that away.
    if (!force && (await api(url)).ok) {
      console.log(`[drycms] page source ${path} already exists - left alone`);
      continue;
    }
    await json(
      await api(url, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: source }),
      `writing page source "${path}"`,
    );
    console.log(`[drycms] wrote page source ${path}`);
  }
}

/**
 * Writes the demo page sources straight to disk under `src/apps/<root>/...`,
 * with no server involved.
 *
 * `dev:worker`'s ordering problem: a Worker's route table is compiled in by
 * `vite build` (`route-tree.ts`'s `discoverRoutes()` globs `src/apps/pages`),
 * so a page that only reaches the store AFTER the build is invisible - the
 * seeded `/demo` 404s until the next build. Running this BEFORE the
 * sync+build step puts the pages where the bundle can see them; the HTTP
 * `seedPageSources()` above then keeps the live store in step for the dev
 * server and the Page Editor.
 *
 * Skips a file that already exists, same reasoning as above.
 */
async function writePageSourcesToDisk(): Promise<void> {
  // Both halves of the two-root split (see AGENTS.md): `src/apps/**` is what
  // `vite build` globs into the bundle, the local `pagesSource` root is the
  // LIVE store the dev server renders from and `tsconfig.json` resolves
  // `@component/*` against. Writing only one leaves either the built Worker
  // or the IDE/dev server missing the file.
  const { resolveOptions } = await import("../src/server/options.js");
  const localStore = resolveOptions({ kind: "local" }).pagesSource.storage;
  const roots = ["src/apps", ...(localStore.kind === "local" ? [localStore.root] : [])];

  for (const { path, source } of demoPageSources()) {
    for (const root of roots) {
      const target = resolve(process.cwd(), root, path);
      if (!force) {
        const existing = await readFile(target, "utf8").catch(() => null);
        if (existing !== null) {
          console.log(`[drycms] ${root}/${path} already exists - left alone`);
          continue;
        }
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
      console.log(`[drycms] wrote ${root}/${path}`);
    }
  }
}

/**
 * Applies the demo content types to the LOCAL content store directly (no
 * server), then regenerates `.dry/dry.generated.d.ts`.
 *
 * Needed because the seeded pages call `dry().collection("demoArticle")`,
 * and those ambient types come from whichever store `dry:generate` reads -
 * the local one - not from the Worker's D1. Without this, `bun run
 * typecheck` fails on the freshly written `src/apps/pages/demo/**` with
 * `"demoArticle" is not assignable to ...`, even though every real build
 * erases those types and runs fine. Skipped for a D1-configured checkout,
 * same as `scripts/dry-generate.ts` (no local binding to read).
 */
async function applyDemoTypesLocally(): Promise<void> {
  const { content } = await import("../src/server/config.js");
  if (content.engine === "D1") {
    console.log('[drycms] content.engine is "D1" - skipping the local schema/type generation half.');
    return;
  }
  const { createContentEngineAdapter } = await import("../src/content-types/engine/index.js");
  const { generateDryTypes } = await import("../src/content-types/codegen.js");
  const { writeGeneratedDryTypes } = await import("../src/content-types/types-cache.js");

  const adapter = createContentEngineAdapter(content);
  for (const definition of demoContentTypes()) {
    const current = (await adapter.listContentTypes()).find((candidate) => candidate.id === definition.id);
    const next = { ...definition, version: current?.version ?? 0 };
    await adapter.applySave(next, await adapter.planSave(next));
    console.log(`[drycms] ${current ? "updated" : "created"} local content type ${definition.name}`);
  }

  const allTypes = await adapter.listContentTypes();
  await writeGeneratedDryTypes(generateDryTypes(allTypes));
  console.log(`[drycms] regenerated dry.generated.d.ts (${allTypes.length} content types)`);
}

if (pagesOnly) {
  await writePageSourcesToDisk();
  await applyDemoTypesLocally();
} else {
  if (waitSeconds > 0) await waitForServer();
  await authenticate();
  const definitions = await seedContentTypes();
  await seedEntries(definitions);
  await seedPageSources();
  const origin = base.replace(/\/[^/]*$/, "");
  console.log(`[drycms] demo project ready - admin: ${base}/content/demoArticle`);
  // Under `dev:worker` the Worker serves an ordinary visitor from
  // `built/live/*` only (`page-handler.ts`'s own doc comment: "a page that
  // was never built through the admin simply 404s; that's by design"), and
  // the build itself runs in the BROWSER (`page-build.ts` compiles + renders
  // client-side; the server endpoint only writes the bytes). So this script
  // can't publish `/demo` on its own - say so instead of printing a URL that
  // 404s. `bun run dev` has no such step: its dev branch renders straight
  // from the page-source store.
  console.log(`[drycms] public /demo: live immediately under \`bun run dev\` (${origin}/demo).`);
  console.log(`[drycms] under \`dev:worker\`/production, build it once from ${base}/page-editor (Build) - a Worker only serves pages published to built/live.`);
}
