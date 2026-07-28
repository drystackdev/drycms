export interface IconifySearchResult {
  /** `"prefix:name"` pairs. */
  icons: string[];
  total: number;
}

export interface IconifyCollection {
  prefix: string;
  name: string;
  category?: string;
}

export class IconifyApiError extends Error {}

async function assertOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  throw new IconifyApiError(fallback);
}

/** Thin client-side fetch wrapper around `routes/iconify.ts`'s Iconify
 * proxy - the browser only ever talks to our own `/api/iconify/*`, never
 * `api.iconify.design` directly. */
export function createIconifyApi(baseUrl: string) {
  async function search(options: { query: string; prefixes?: string[]; limit?: number }): Promise<IconifySearchResult> {
    const params = new URLSearchParams({ query: options.query });
    if (options.prefixes?.length) params.set("prefixes", options.prefixes.join(","));
    if (options.limit) params.set("limit", String(options.limit));
    const res = await fetch(`${baseUrl}/search?${params.toString()}`);
    await assertOk(res, "Failed to search Iconify.");
    return res.json();
  }

  async function collections(): Promise<IconifyCollection[]> {
    const res = await fetch(`${baseUrl}/collections`);
    await assertOk(res, "Failed to load Iconify icon sets.");
    const data = (await res.json()) as Record<string, IconifyCollection>;
    return Object.values(data);
  }

  /** `ids` are `"prefix:name"` pairs; returns a map of the same ids to
   * sanitized SVG source, for rendering not-yet-saved result tiles. */
  async function previewIcons(ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    const res = await fetch(`${baseUrl}/icons?ids=${ids.map(encodeURIComponent).join(",")}`);
    await assertOk(res, "Failed to load icon previews.");
    return (await res.json()).icons;
  }

  return { search, collections, previewIcons };
}

export type IconifyApi = ReturnType<typeof createIconifyApi>;
