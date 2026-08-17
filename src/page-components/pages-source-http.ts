// Deliberately NOT `storage/entry-types.ts`'s real exported `FileEntry` type -
// a relative storage path lives on `.id`, NOT `.path` (`storage/entry.ts`'s
// `toFileEntry`: `id: stat.path`). Caught live: an earlier version of this
// code guessed `.path` and crashed ("Cannot read properties of undefined
// (reading 'split')") the moment a real R2-backed pages-source tree was
// loaded under `wrangler dev` - `?tree` isn't supported there (R2 has no
// `listAll`), so the `list()`-fallback path below is what actually exercised
// this field.
interface TreeEntry {
  id: string;
  name: string;
  kind: "file" | "folder";
  modifiedAt?: number;
  size?: number;
}

/** `routes/asset-hrefs.ts`'s response shape. */
export interface AssetHrefs {
  globalsCssHref: string;
  hydrateEntryHref: string;
  editLauncherHref: string;
  preactRuntimeHref: string;
  hydrateBuiltHref: string;
}

export function toUrlPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

export async function fetchJson<T>(url: string, cache: RequestCache = "default"): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache });
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchText(url: string, cache: RequestCache = "default"): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin", cache });
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  return response.text();
}

/** `?tree` is only implemented for `kind: "local"` (`storage/types.ts`'s
 * `StorageAdapter.listAll` doc comment - deliberately absent for R2/S3,
 * which paginate by prefix/delimiter). Confirmed live under `wrangler dev`
 * (real R2 simulation, `kind: "cloudflare"`): `{"supported":false}`, not an
 * error - this recursive per-folder fallback is required for production,
 * not a defensive nicety. Shared by every caller that only needs the
 * minimal id/name/kind shape; `PageBuilder.tsx` keeps its own walk where it
 * needs the full `FileEntry` (`parentId` etc) for `ComponentTreePanel`. */
export async function listAllFilesRecursive(adminPath: string, folder = "", cache: RequestCache = "default"): Promise<TreeEntry[]> {
  const url = folder === "" ? `${adminPath}/api/pages-source` : `${adminPath}/api/pages-source/${toUrlPath(folder)}`;
  const { entries } = await fetchJson<{ path: string; entries: TreeEntry[] }>(url, cache);
  const files: TreeEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "folder") files.push(...(await listAllFilesRecursive(adminPath, entry.id, cache)));
    else files.push(entry);
  }
  return files;
}

/** Every `.tsx`/`.ts`/`.css`/`.md` file under pages-source, keyed by path - prefers
 * the `?tree` bulk endpoint and falls back to `listAllFilesRecursive` above
 * for a backend that doesn't support it. Shared by `PageBuild.tsx`'s load
 * effect and `rebuild-affected-pages.ts`'s in-process rebuild path - both
 * need the exact same "every source file's content" snapshot to resolve page
 * targets from. `.css` is included alongside the code files because
 * `buildPage`'s `tailwindStylesheetSource` (`tailwind-build.ts`) looks up
 * `styles/globals.css` and whatever it `@import`s directly in this same map -
 * without it every real build throws "Missing Tailwind stylesheet". `.md`
 * is included because Page Builder uses this same snapshot for its source
 * menu and Markdown editor, even though the build itself ignores those files. */
export async function loadAllPagesSource(adminPath: string, cache: RequestCache = "default"): Promise<Record<string, string>> {
  const tree = await fetchJson<{ supported: boolean; entries?: TreeEntry[] }>(`${adminPath}/api/pages-source?tree`, cache);
  const allEntries = tree.supported && tree.entries ? tree.entries : await listAllFilesRecursive(adminPath, "", cache);
  const files = allEntries.filter((e) => e.kind === "file" && /\.(tsx|ts|css|md)$/i.test(e.name));
  const sources: Record<string, string> = {};
  await Promise.all(
    files.map(async (file) => {
      sources[file.id] = await fetchText(`${adminPath}/api/pages-source/${toUrlPath(file.id)}`, cache);
    }),
  );
  return sources;
}
