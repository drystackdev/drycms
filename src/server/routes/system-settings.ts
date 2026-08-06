import type { DryRouteHandler } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { systemSettingsThemeVars } from "../../lib/system-settings-theme.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";

async function renderThemeCss(entries: ContentEntryEngineAdapter, type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<string> {
  const entry = await entries.getSingletonEntry(type, allTypes);
  const vars = systemSettingsThemeVars(entry?.value ?? {});
  const declarations = Object.entries(vars).map(([token, value]) => `  ${token}: ${value};`);
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
