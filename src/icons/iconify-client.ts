/**
 * Server-only helper: fetches one or more icons from a single Iconify icon
 * set (`https://api.iconify.design/{prefix}.json?icons=...`) and composes
 * each into a standalone `<svg>` string. Deliberately hand-rolled instead of
 * pulling in `@iconify/utils` at runtime (that package stays a build-time-only
 * `devDependency` for `scripts/build-icons.mjs`) - the API response already
 * carries everything (`body`/`width`/`height`) a static icon needs, so no
 * extra dependency earns its keep here.
 *
 * Known simplification: an alias entry's `hFlip`/`vFlip`/`rotate` transform
 * (rare - most aliases are plain renames, e.g. Iconify's own
 * `thumbs-up` -> `thumb-up`) is not applied. Reproducing that transform
 * correctly is exactly the kind of icon-set-format logic `@iconify/utils`
 * exists for; skipping it means an aliased icon with a flip/rotate override
 * renders using its parent's unmodified orientation - a cosmetic gap, not a
 * correctness or security one.
 */

const ICONIFY_API_BASE = "https://api.iconify.design";

export interface IconifyIconResult {
  name: string;
  svg: string;
}

export interface FetchIconifyResult {
  found: IconifyIconResult[];
  notFound: string[];
}

interface IconifyBody {
  body: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
}

interface IconifyAlias extends IconifyBody {
  parent: string;
}

interface IconifyIconSetResponse {
  prefix: string;
  width?: number;
  height?: number;
  icons: Record<string, IconifyBody>;
  aliases?: Record<string, IconifyAlias>;
  not_found?: string[];
}

function composeSvg(icon: IconifyBody, rootWidth: number, rootHeight: number): string {
  const width = icon.width ?? rootWidth;
  const height = icon.height ?? rootHeight;
  const left = icon.left ?? 0;
  const top = icon.top ?? 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}">${icon.body}</svg>`;
}

/** Fetches every requested `names` from a single Iconify `prefix` icon set in
 * one request, composing each into a full `<svg>...</svg>` string. Names that
 * don't exist in the set (typo, or genuinely absent) come back in `notFound`
 * rather than throwing - a bulk "Add" action should report per-icon misses,
 * not abort the whole batch over one bad name. */
export async function fetchIconifySvg(prefix: string, names: string[]): Promise<FetchIconifyResult> {
  if (names.length === 0) return { found: [], notFound: [] };

  const url = `${ICONIFY_API_BASE}/${encodeURIComponent(prefix)}.json?icons=${names.map(encodeURIComponent).join(",")}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (error) {
    throw new Error(
      `Could not reach Iconify for icon set "${prefix}": ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Iconify request for icon set "${prefix}" failed with HTTP ${res.status}.`);
  }
  const data = (await res.json()) as IconifyIconSetResponse;

  const rootWidth = data.width ?? 24;
  const rootHeight = data.height ?? 24;
  const found: IconifyIconResult[] = [];
  for (const name of names) {
    const direct = data.icons[name];
    if (direct) {
      found.push({ name, svg: composeSvg(direct, rootWidth, rootHeight) });
      continue;
    }
    const alias = data.aliases?.[name];
    const parent = alias && data.icons[alias.parent];
    if (alias && parent) {
      found.push({
        name,
        svg: composeSvg(
          { body: parent.body, width: alias.width ?? parent.width, height: alias.height ?? parent.height, left: alias.left ?? parent.left, top: alias.top ?? parent.top },
          rootWidth,
          rootHeight,
        ),
      });
    }
  }

  const notFound = data.not_found ?? names.filter((name) => !found.some((f) => f.name === name));
  return { found, notFound };
}
