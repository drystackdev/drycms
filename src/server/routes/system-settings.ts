import type { DryRouteHandler } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { deriveColorShades, isValidHexColor } from "../../lib/color-shades.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";

/** `field` -> `tokens.css` token prefix. `secondary`'s BASE token is
 * `--dry-secondary-main` (not `--dry-secondary`), but its shade tokens
 * (`-lighter`/`-light`/`-dark`/`-darker`) still use the plain `secondary`
 * prefix - `tokens.css` itself is inconsistent here, this just mirrors it.
 * No `-foreground` override for `secondary`: `--dry-secondary-foreground`
 * is a DIFFERENT, unrelated token (the neutral "secondary" button variant,
 * bound to `--dry-foreground`) - overriding it here would silently change
 * that instead of anything color-ramp-related. */
const COLOR_INTENTS: { field: string; prefix: string; baseToken: string; hasForeground: boolean }[] = [
  { field: "primaryColor", prefix: "primary", baseToken: "--dry-primary", hasForeground: true },
  { field: "secondaryColor", prefix: "secondary", baseToken: "--dry-secondary-main", hasForeground: false },
  { field: "infoColor", prefix: "info", baseToken: "--dry-info", hasForeground: true },
  { field: "successColor", prefix: "success", baseToken: "--dry-success", hasForeground: true },
  { field: "warningColor", prefix: "warning", baseToken: "--dry-warning", hasForeground: true },
  { field: "errorColor", prefix: "error", baseToken: "--dry-error", hasForeground: true },
];

/** Guards against a `systemSettings` row edited directly through the
 * generic entries API bypassing the `select` field's `options` list (the
 * DB column itself has no CHECK constraint - see `field-registry.ts`) from
 * breaking out of the `--dry-font-sans:` declaration this gets interpolated
 * into. Colors are already constrained by `isValidHexColor` instead - a
 * hex string can't contain any of these characters to begin with. */
function isSafeCssValue(value: string): boolean {
  return !/[{}<>;]/.test(value);
}

async function renderThemeCss(entries: ContentEntryEngineAdapter, type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<string> {
  const entry = await entries.getSingletonEntry(type, allTypes);
  const value = entry?.value ?? {};

  const declarations: string[] = [];
  for (const { field, prefix, baseToken, hasForeground } of COLOR_INTENTS) {
    const raw = value[field];
    if (typeof raw !== "string" || !isValidHexColor(raw)) continue;
    const shades = deriveColorShades(raw);
    if (!shades) continue;
    declarations.push(`  ${baseToken}: ${shades.base};`);
    declarations.push(`  --dry-${prefix}-lighter: ${shades.lighter};`);
    declarations.push(`  --dry-${prefix}-light: ${shades.light};`);
    declarations.push(`  --dry-${prefix}-dark: ${shades.dark};`);
    declarations.push(`  --dry-${prefix}-darker: ${shades.darker};`);
    if (hasForeground) declarations.push(`  --dry-${prefix}-foreground: ${shades.foreground};`);
  }

  const fontFamily = value.fontFamily;
  if (typeof fontFamily === "string" && fontFamily.trim() && isSafeCssValue(fontFamily)) {
    declarations.push(`  --dry-font-sans: ${fontFamily};`);
  }

  const baseFontSize = Number(value.baseFontSize);
  if (Number.isFinite(baseFontSize) && baseFontSize > 0) {
    declarations.push(`  --dry-text-base: ${baseFontSize}px;`);
    declarations.push(`  --dry-text-sm: ${(baseFontSize * 0.875).toFixed(2)}px;`);
    declarations.push(`  --dry-text-xs: ${(baseFontSize * 0.75).toFixed(2)}px;`);
  }

  const radius = Number(value.radius);
  if (Number.isFinite(radius) && radius >= 0) {
    declarations.push(`  --dry-radius: ${radius}px;`);
    declarations.push(`  --dry-radius-sm: ${(radius * 0.75).toFixed(2)}px;`);
    declarations.push(`  --dry-radius-md: ${radius}px;`);
    declarations.push(`  --dry-radius-lg: ${(radius * 1.5).toFixed(2)}px;`);
    declarations.push(`  --dry-radius-xl: ${(radius * 2).toFixed(2)}px;`);
  }

  if (declarations.length === 0) return "";
  // Deliberately NOT wrapped in `@layer` (unlike `tokens.css`'s own
  // `@layer dry.tokens`) - an unlayered rule always wins over ANY layered
  // rule in the CSS cascade regardless of specificity or `<link>` order, so
  // this overrides the shipped defaults without needing to chase link
  // ordering or `!important`.
  return `.dry {\n${declarations.join("\n")}\n}\n`;
}

/**
 * Renders the Super Admin's `systemSettings` singleton (see
 * `content-types/seed.ts`) as a `.dry { --dry-*: ...; }` override -
 * `lib/apply-system-theme.ts` links this into every admin page load
 * (dashboard AND the pre-login screens, which share the same `.dry` root),
 * so the chosen theme is shared with every user rather than a per-device
 * preference (unlike `memory`/`useStore`'s `drycms:store`). Public GET, no
 * session required (see `handler.ts`'s `isPublicThemeCss`) - nothing here
 * is more sensitive than colors/fonts a Super Admin already chose to share.
 * An unset/never-saved settings row (or one with no valid fields) renders
 * an empty stylesheet - `tokens.css`'s shipped defaults simply keep
 * applying, nothing to fall back to here.
 */
export const GET: DryRouteHandler = async (context) => {
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const type = allTypes.find((t) => t.name === "systemSettings");
  const css = type ? await renderThemeCss(entries, type, allTypes) : "";
  return new Response(css, {
    status: 200,
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache" },
  });
};
