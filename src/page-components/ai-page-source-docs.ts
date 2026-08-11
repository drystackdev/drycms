/**
 * Bundles this repo's own `docs/*.md` reference docs as plain strings at
 * BUILD time (Vite's eager raw-text glob, the same mechanism `Editer/
 * virtual-fs-files.ts` already uses for TypeScript's own `lib.*.d.ts` files)
 * rather than reading them from disk at request time - `docs/` isn't shipped
 * alongside a Cloudflare Workers build (no filesystem there at all), so a
 * runtime `fs.readFile` would work under `bun run dev`/the Node build and
 * silently break under `kind: "cloudflare"`. Keyed by the same
 * `"docs/NAME.md"` root-relative path `docs/README.md`'s own links use, so a
 * `kind: read, root: docs` turn (`ai-page-source-protocol.ts`) can address a
 * doc by exactly the path the model was told about.
 */
const rawDocs = import.meta.glob("/docs/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export const PAGE_SOURCE_DOCS: Record<string, string> = Object.fromEntries(
  Object.entries(rawDocs).map(([globPath, content]) => [globPath.replace(/^\//, ""), content]),
);

export const PAGE_SOURCE_README = PAGE_SOURCE_DOCS["docs/README.md"] ?? "";
