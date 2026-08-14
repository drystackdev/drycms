import type { Completion, CompletionSource } from "prism-code-editor/autocomplete";
import tailwindColors from "tailwindcss/colors";
import tailwindIndexCss from "tailwindcss/index.css?raw";
import { __unstable__loadDesignSystem } from "tailwindcss";

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;

export interface TailwindCompletionSnapshot {
  classList: readonly string[];
  variantList: readonly string[];
  themeVariableList: readonly string[];
}

/**
 * `colorKey` ("red-500", "black", "current", ...) -> its resolved CSS color -
 * flattened from `tailwindcss/colors`' default palette once at module load.
 * Used to show a real color swatch icon (`resolveTailwindColorIcon` below)
 * instead of the generic "property" icon for a color utility class
 * (`bg-red-500`, `text-current`, ...). Deliberately sourced from the static
 * `tailwindcss/colors` export rather than the async `DesignSystem` loaded
 * below - it's synchronously available at import time, so there's no race
 * with `Editer.tsx`'s `shadowStyles` (a module-level constant, computed once,
 * long before `loadTailwindLists`'s promise could resolve) needing the
 * swatch CSS ready before any editor mounts.
 */
const tailwindColorTokens = new Map<string, string>(
  Object.entries(tailwindColors as Record<string, string | Record<string, string>>).flatMap(([name, value]) =>
    typeof value === "string" ? [[name, value] as const] : Object.entries(value).map(([shade, hex]) => [`${name}-${shade}`, hex] as const),
  ),
);
/** Longest key first, so a compound key (`red-500`) is tried before any
 * shorter one that might otherwise coincidentally match the same suffix. */
const tailwindColorKeysByLength = [...tailwindColorTokens.keys()].sort((a, b) => b.length - a.length);

/** A color utility's class name always ends in `-<colorKey>` (`bg-red-500`,
 * `ring-offset-current`, ...) - checking the suffix against every known
 * color key is cheap (at most 50 classes per keystroke, see `classCompletions`)
 * and needs no hardcoded list of which utility prefixes take a color, which
 * Tailwind itself doesn't keep fixed across versions. */
function resolveTailwindColorIcon(className: string): string | undefined {
  const key = tailwindColorKeysByLength.find((k) => className.length > k.length + 1 && className.endsWith(`-${k}`));
  return key && `swatch-${key}`;
}

const SWATCH_MASK = `url('data:image/svg+xml,<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="12" height="12" rx="3"/></svg>')`;

/**
 * CSS for the `swatch-<colorKey>` icons `resolveTailwindColorIcon` hands out -
 * appended into `Editer.tsx`'s shared `shadowStyles` alongside
 * `prism-code-editor`'s own `autocomplete-icons.css`, whose `.pce-ac-icon-<name>{--mask:
 * ...}` / `iconEl.style.color = var(--pce-ac-icon-<name>)` convention (see that file) this
 * follows: one shared filled-square mask for every `swatch-*` icon (attribute selector,
 * so it isn't repeated per color), then one rule per color token supplying that color's
 * actual value through the same-named CSS variable.
 */
export const tailwindSwatchIconsCss: string =
  `[class*="pce-ac-icon-swatch-"]{--mask:${SWATCH_MASK}}` +
  // `autocomplete-icons.css`'s own `.pce-ac-row[aria-selected] .pce-ac-icon:before{color:
  // var(--pce-widget-color-active)}` forces every icon to one fixed "active" color on the
  // currently highlighted row - right for a monochrome icon (guarantees contrast against
  // the highlight), wrong for a swatch, which should keep showing its real color there too.
  // Higher specificity (`[class*=...]` adds a selector part) than that rule, so this wins
  // and `color: inherit` falls back to the swatch's own color, set via inline style on the
  // parent `.pce-ac-icon` (see `iconEl.style.color` in `prism-code-editor`'s tooltip code).
  `.pce-ac-row[aria-selected] .pce-ac-icon[class*="pce-ac-icon-swatch-"]:before{color:inherit}` +
  [...tailwindColorTokens.entries()].map(([key, value]) => `.pce-ac-icon-swatch-${key}{--pce-ac-icon-swatch-${key}:${value}}`).join("");

/** Project snapshots are cached by their fully-expanded stylesheet. The
 * editor keeps the selected snapshot per instance; this cache only avoids
 * recompiling an identical theme when changing files. */
let defaultSnapshot: TailwindCompletionSnapshot | undefined;
const snapshotCache = new Map<string, Promise<TailwindCompletionSnapshot>>();
const MAX_SNAPSHOT_CACHE_SIZE = 8;

/**
 * Flattens `DesignSystem.getVariants()` into every variant name that's valid
 * to insert on its own - both plain ones (`hover`, `focus`, `md`, `dark`,
 * `first`, ...) and, for variants that only compose with a fixed set of
 * sub-values (`group`, `peer`, `has`, `not`, `in`, `aria`, `max`, ...), the
 * composed forms (`group-hover`, `peer-checked`, `aria-disabled`,
 * `max-md`, ...). `isArbitrary` is what distinguishes the two: it's set on
 * exactly the variants whose bare name isn't valid by itself (it either
 * needs one of `values` appended, or a `[...]` arbitrary value this
 * completion source doesn't attempt to suggest) - so the bare name is only
 * added when `isArbitrary` is false.
 */
function buildVariantList(designSystem: DesignSystem): string[] {
  const names = new Set<string>();
  for (const variant of designSystem.getVariants()) {
    if (!variant.isArbitrary) names.add(variant.name);
    for (const value of variant.values) {
      if (value) names.add(variant.hasDash ? `${variant.name}-${value}` : `${variant.name}${value}`);
    }
  }
  return [...names];
}

export function loadTailwindCompletionSnapshot(
  stylesheetSource = '@import "tailwindcss";',
): Promise<TailwindCompletionSnapshot> {
  const cached = snapshotCache.get(stylesheetSource);
  if (cached) return cached;

  const promise = __unstable__loadDesignSystem(stylesheetSource, {
    // `tailwindStylesheetSource` has already expanded every project-relative
    // import. The one external import left is Tailwind's own self-contained
    // entry, supplied from the installed package rather than fetched.
    loadStylesheet: async (id, base) => {
      if (id !== "tailwindcss") throw new Error(`[drycms] Unsupported Tailwind stylesheet import "${id}" from "${base}".`);
      return { path: id, base, content: tailwindIndexCss };
    },
  }).then((designSystem) => ({
    classList: designSystem.getClassList().map(([className]) => className),
    variantList: buildVariantList(designSystem),
    themeVariableList: [...designSystem.theme.entries()].map(([name]) => name),
  }));

  snapshotCache.set(stylesheetSource, promise);
  if (snapshotCache.size > MAX_SNAPSHOT_CACHE_SIZE) {
    const oldest = snapshotCache.keys().next().value;
    if (oldest !== undefined) snapshotCache.delete(oldest);
  }
  promise.catch(() => {
    if (snapshotCache.get(stylesheetSource) === promise) snapshotCache.delete(stylesheetSource);
  });
  return promise;
}

/** Kicks off the (one-time) load eagerly so the lists are likely warm by the
 * time the user's first keystroke could trigger a completion. */
void loadTailwindCompletionSnapshot().then((snapshot) => {
  defaultSnapshot = snapshot;
});

const CLASS_ATTR_RE = /\b(?:className|class)\s*=\s*["']([^"']*)$/;
/** `@apply flex items-c` (Tailwind v4 CSS) - same "everything after the
 * open-ended token" shape as `CLASS_ATTR_RE`, just not string-quoted: an
 * `@apply` line ends at `;`/`{`/`}`, not a closing quote. */
const APPLY_RE = /@apply\s+([^;{}]*)$/;

/**
 * Shared by both completion sources below - `classesSoFar` is everything the
 * triggering regex captured (the `class="..."` string content, or the
 * `@apply ...` token list); `segment` is the in-progress token being typed
 * out of it (everything after the last space, further split on its last `:`
 * so an already-chosen variant prefix like `md:hover:` is left alone).
 * Variants and utility classes are offered side by side, since either is a
 * valid next thing to type there; picking a variant inserts its trailing `:`
 * too, so the very next keystroke re-runs the source with a new, now-empty
 * `segment` after it - which is how stacking (`md:hover:bg-red-500`) falls
 * out for free, with no explicit handling of "how many variants deep" here.
 */
function classCompletions(
  pos: number,
  classesSoFar: string,
  snapshot = defaultSnapshot,
): { from: number; options: Completion[] } | null {
  if (!snapshot) return null;
  const currentToken = classesSoFar.slice(classesSoFar.lastIndexOf(" ") + 1);
  const segment = currentToken.slice(currentToken.lastIndexOf(":") + 1);
  if (!segment) return null;

  const options: Completion[] = [
    ...snapshot.variantList
      .filter((name) => name.startsWith(segment))
      .slice(0, 30)
      .map((label) => ({ label, insert: `${label}:`, icon: "keyword" as const, detail: "variant" })),
    ...snapshot.classList
      .filter((name) => name.startsWith(segment))
      .slice(0, 50)
      .map((label) => ({ label, icon: resolveTailwindColorIcon(label) ?? "property" })),
  ];
  if (options.length === 0) return null;
  return {
    from: pos - segment.length,
    options,
  };
}

/**
 * `CompletionSource` for `prism-code-editor`'s autocomplete extension (see
 * `Editer.tsx`) - suggests Tailwind utility classes and variants (`hover:`,
 * `md:`, `group-hover:`, ...) while the cursor is inside a `className="..."`
 * string.
 */
export const tailwindCompletionSource = (
  context: Parameters<CompletionSource>[0],
  snapshot?: TailwindCompletionSnapshot,
): ReturnType<CompletionSource> => {
  const match = CLASS_ATTR_RE.exec(context.before);
  if (!match) return null;
  return classCompletions(context.pos, match[1] ?? "", snapshot);
};

/**
 * Same suggestions as `tailwindCompletionSource`, triggered by an `@apply`
 * at-rule instead of a `class="..."` attribute - the CSS-mode counterpart
 * registered for the `"css"` language (`Editer.tsx`), used while editing the
 * Page Builder's `styles/*.css` files.
 */
export const tailwindApplyCompletionSource = (
  context: Parameters<CompletionSource>[0],
  snapshot?: TailwindCompletionSnapshot,
): ReturnType<CompletionSource> => {
  const match = APPLY_RE.exec(context.before);
  if (!match) return null;
  return classCompletions(context.pos, match[1] ?? "", snapshot);
};

const AT_RULE_RE = /@([\w-]*)$/;
/** `@layer base|components|utilities` - a closed set, unlike every other at-rule here. */
const LAYER_VALUE_RE = /@layer\s+([\w-]*)$/;

/** Tailwind v4's own CSS at-rules - `prism-code-editor`'s built-in `cssCompletion`
 * (`Editer.tsx`) ships a fixed, standard-CSS-only at-rule list (`@media`, `@import`,
 * `@layer`, ...) with no way to extend it, so these are offered as a separate source
 * instead. Labels double as the inserted text (`Completion.insert` defaults to
 * `label`), so they carry the leading `@` themselves - `from` is computed to include
 * the already-typed `@` in the replaced range (see `tailwindAtRuleCompletionSource`). */
const TAILWIND_AT_RULES: Completion[] = [
  "theme",
  "layer",
  "apply",
  "import",
  "variant",
  "custom-variant",
  "utility",
  "source",
  "plugin",
  "reference",
  "config",
].map((name) => ({ label: `@${name}`, icon: "keyword" as const, detail: "Tailwind" }));

const TAILWIND_LAYER_NAMES: Completion[] = ["base", "components", "utilities"].map((label) => ({
  label,
  icon: "constant" as const,
  detail: "Tailwind layer",
}));

/**
 * `CompletionSource` for Tailwind v4's CSS-side at-rules (`@theme`, `@layer`, `@apply`,
 * `@variant`, ...) plus `@layer`'s own base/components/utilities values - registered
 * alongside `prism-code-editor`'s built-in `cssCompletion` for the `"css"` language
 * (`Editer.tsx`); both fire on the same `@` trigger and their results merge (every
 * registered source runs and their non-null results are pooled, then filtered/sorted
 * together - see `registerCompletions`).
 */
export const tailwindAtRuleCompletionSource: CompletionSource = (context) => {
  const layerMatch = LAYER_VALUE_RE.exec(context.before);
  if (layerMatch) {
    return { from: context.pos - (layerMatch[1]?.length ?? 0), options: TAILWIND_LAYER_NAMES };
  }
  const match = AT_RULE_RE.exec(context.before);
  if (!match) return null;
  return { from: context.pos - (match[1]?.length ?? 0) - 1, options: TAILWIND_AT_RULES };
};
