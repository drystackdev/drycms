/**
 * Bundles the git-committed `src/apps/{pages,component,styles,md}/**` starter
 * template as plain strings at BUILD time (same eager raw-text glob
 * `ai-page-source-docs.ts` uses for `docs/*.md`) - reading `src/apps/**` from
 * disk at request time would work under `bun run dev`/the Node build and
 * silently break under `kind: "cloudflare"` (no filesystem there at all).
 * `seed-pages-source.ts` writes this manifest into a fresh tenant's
 * `pagesSourceStorage` the first time it's found completely empty.
 */
const rawSamples = import.meta.glob(
  ["/src/apps/pages/**", "/src/apps/component/**", "/src/apps/styles/**", "/src/apps/md/**"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

export interface SamplePagesSourceFile {
  /** Root-relative path inside `pagesSourceStorage`, e.g. `"pages/page.tsx"`
   * - matches `source-roots.ts`'s `PAGES_ROOT`/`COMPONENT_ROOT`/`STYLES_ROOT`/
   * `MD_ROOT` id prefixes directly, since those are exactly the `src/apps/`
   * subfolder names this glob strips down to. */
  path: string;
  content: string;
}

export const SAMPLE_PAGES_SOURCE_FILES: SamplePagesSourceFile[] = Object.entries(rawSamples).map(([globPath, content]) => ({
  path: globPath.replace(/^\/src\/apps\//, ""),
  content,
}));
