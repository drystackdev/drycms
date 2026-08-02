import type { DryRouteHandler } from "../context.js";
import { fetchIconifySvg } from "../../icons/iconify-client.js";
import { sanitizeSvg } from "../../icons/sanitize-svg.js";
import { errorResponse, jsonResponse } from "../route-helpers.js";

const ICONIFY_API_BASE = "https://api.iconify.design";

/** Passes a search straight through to Iconify's own `/search` - used both
 * scoped to one icon set (`prefixes` set) and, when "Search all icon sets"
 * is on, unscoped (`prefixes` simply omitted). */
async function proxySearch(url: URL): Promise<Response> {
  const query = (url.searchParams.get("query") ?? "").trim().slice(0, 200);
  if (!query) return jsonResponse({ icons: [], total: 0 });

  const params = new URLSearchParams({ query });
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 64) : 32;
  params.set("limit", String(limit));
  const prefixes = url.searchParams.get("prefixes")?.slice(0, 500);
  if (prefixes) params.set("prefixes", prefixes);

  const res = await fetch(`${ICONIFY_API_BASE}/search?${params.toString()}`);
  if (!res.ok) throw new Error(`Iconify search failed with HTTP ${res.status}.`);
  return jsonResponse(await res.json());
}

interface IconifyCollectionInfo {
  name: string;
  category?: string;
}

/** Iconify's real `/collections` response is ~230 entries carrying license,
 * author, sample icons, etc. per set - none of which the category `Select`
 * needs, so this trims each entry down to just what it renders. */
async function proxyCollections(): Promise<Response> {
  const res = await fetch(`${ICONIFY_API_BASE}/collections`);
  if (!res.ok) throw new Error(`Iconify collections failed with HTTP ${res.status}.`);
  const data = (await res.json()) as Record<string, IconifyCollectionInfo>;
  const trimmed = Object.fromEntries(
    Object.entries(data).map(([prefix, info]) => [
      prefix,
      { prefix, name: info.name, category: info.category },
    ]),
  );
  return jsonResponse(trimmed);
}

interface IconifyCollectionListing {
  categories?: Record<string, string[]>;
  uncategorized?: string[];
}

/** Full icon-name listing for one set, used to browse-by-category when the
 * search box is empty (rather than showing nothing until the admin types
 * something) - Iconify's `/collection` groups names by category, with some
 * names repeated across categories, so this flattens + de-dupes + sorts
 * into one flat list. Deliberately excludes `hidden` (deprecated icons
 * Iconify's own tools don't surface either) and `aliases` (alternate names
 * for icons already included under their canonical name - listing both
 * would just show visual duplicates). */
async function proxyList(url: URL): Promise<Response> {
  const prefix = (url.searchParams.get("prefix") ?? "").trim();
  if (!prefix) throw new Error("`prefix` is required.");

  const res = await fetch(`${ICONIFY_API_BASE}/collection?prefix=${encodeURIComponent(prefix)}`);
  if (!res.ok) throw new Error(`Iconify collection listing for "${prefix}" failed with HTTP ${res.status}.`);
  const data = (await res.json()) as IconifyCollectionListing;

  const names = [
    ...new Set([...(data.uncategorized ?? []), ...Object.values(data.categories ?? {}).flat()]),
  ].sort();
  return jsonResponse({ prefix, names, total: names.length });
}

/** Renders not-yet-saved search-result tiles: `ids` is a comma-separated
 * list of `"prefix:name"` pairs, grouped by prefix so each distinct icon set
 * costs one Iconify request regardless of how many of its icons are
 * requested. Every result is sanitized before going back to the browser -
 * defense in depth even though Iconify is a public, mostly-trustworthy
 * source, since a "search all icon sets" query can surface icons from any
 * community-contributed set. */
async function proxyIconsPreview(url: URL): Promise<Response> {
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length > 100) throw new Error("At most 100 icons can be previewed at once.");

  const namesByPrefix = new Map<string, string[]>();
  for (const id of ids) {
    const colon = id.indexOf(":");
    if (colon <= 0) continue;
    const prefix = id.slice(0, colon);
    const name = id.slice(colon + 1).slice(0, 200);
    const names = namesByPrefix.get(prefix);
    if (names) names.push(name);
    else namesByPrefix.set(prefix, [name]);
  }

  const icons: Record<string, string> = {};
  await Promise.all(
    [...namesByPrefix.entries()].map(async ([prefix, names]) => {
      const { found } = await fetchIconifySvg(prefix, names);
      for (const icon of found) {
        try {
          icons[`${prefix}:${icon.name}`] = sanitizeSvg(icon.svg);
        } catch {
          // Doesn't sanitize cleanly - that one tile just won't render,
          // not fatal for the rest of the batch.
        }
      }
    }),
  );
  return jsonResponse({ icons });
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const endpoint = context.params.slug;
    if (endpoint === "search") return await proxySearch(context.url);
    if (endpoint === "collections") return await proxyCollections();
    if (endpoint === "list") return await proxyList(context.url);
    if (endpoint === "icons") return await proxyIconsPreview(context.url);
    return jsonResponse({ error: "not_found", message: `Unknown Iconify endpoint "${String(endpoint)}".` }, 404);
  } catch (error) {
    return errorResponse(error);
  }
};
