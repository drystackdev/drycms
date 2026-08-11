import type { Completion, CompletionSource } from "prism-code-editor/autocomplete";
import tailwindIndexCss from "tailwindcss/index.css?raw";
import { __unstable__loadDesignSystem } from "tailwindcss";

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;

/**
 * Shared across every `Editer` instance on the page - the class/variant lists
 * only depend on the (for now, fixed default) theme, not on which file is
 * being edited, so there's no reason to reload them per instance.
 */
let classList: string[] | undefined;
let variantList: string[] | undefined;
let themeVariableList: string[] | undefined;
let listsPromise: Promise<void> | undefined;

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

function loadTailwindLists(): Promise<void> {
  if (!listsPromise) {
    // `tailwindcss/index.css` (unlike most CSS entry points) has no further
    // `@import`s of its own - theme tokens, base reset and the `@tailwind
    // utilities` marker are all inlined in that one file - so `loadStylesheet`
    // only ever needs to resolve the single top-level `@import "tailwindcss"` below.
    listsPromise = __unstable__loadDesignSystem('@import "tailwindcss";', {
      loadStylesheet: async (id, base) => ({ path: id, base, content: tailwindIndexCss }),
    }).then((designSystem) => {
      classList = designSystem.getClassList().map(([className]) => className);
      variantList = buildVariantList(designSystem);
      // Every `--color-red-500`/`--font-sans`/`--radius-lg`/... CSS custom property the
      // default theme defines - what `@theme { ... }` blocks and `var(...)` calls in a
      // `styles/*.css` file (`tailwindThemeVariables` below) draw their completions from.
      themeVariableList = [...designSystem.theme.entries()].map(([name]) => name);
    });
  }
  return listsPromise;
}

/** Kicks off the (one-time) load eagerly so the lists are likely warm by the
 * time the user's first keystroke could trigger a completion. */
void loadTailwindLists();

/**
 * Live views over `classList`/`themeVariableList` for `prism-code-editor`'s built-in
 * `cssCompletion` (`Editer.tsx`), which captures whatever `classes`/`variables`
 * iterable it's given ONCE, at registration time - before `loadTailwindLists` above
 * has necessarily resolved. A plain array reference captured that early would stay
 * empty forever (the `let`s above are reassigned wholesale once the design system
 * loads, never mutated in place); these wrap the *variable*, not its current value,
 * so every completion query - which re-iterates fresh each time - sees whatever's
 * loaded by then.
 */
export const tailwindClassNames: Iterable<string> = { [Symbol.iterator]: () => (classList ?? [])[Symbol.iterator]() };
export const tailwindThemeVariables: Iterable<string> = {
  [Symbol.iterator]: () => (themeVariableList ?? [])[Symbol.iterator](),
};

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
function classCompletions(pos: number, classesSoFar: string): { from: number; options: Completion[] } | null {
  if (!classList || !variantList) return null;
  const currentToken = classesSoFar.slice(classesSoFar.lastIndexOf(" ") + 1);
  const segment = currentToken.slice(currentToken.lastIndexOf(":") + 1);
  if (!segment) return null;

  const options: Completion[] = [
    ...variantList
      .filter((name) => name.startsWith(segment))
      .slice(0, 30)
      .map((label) => ({ label, insert: `${label}:`, icon: "keyword" as const, detail: "variant" })),
    ...classList
      .filter((name) => name.startsWith(segment))
      .slice(0, 50)
      .map((label) => ({ label, icon: "property" as const })),
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
export const tailwindCompletionSource: CompletionSource = (context) => {
  const match = CLASS_ATTR_RE.exec(context.before);
  if (!match) return null;
  return classCompletions(context.pos, match[1] ?? "");
};

/**
 * Same suggestions as `tailwindCompletionSource`, triggered by an `@apply`
 * at-rule instead of a `class="..."` attribute - the CSS-mode counterpart
 * registered for the `"css"` language (`Editer.tsx`), used while editing the
 * Page Builder's `styles/*.css` files.
 */
export const tailwindApplyCompletionSource: CompletionSource = (context) => {
  const match = APPLY_RE.exec(context.before);
  if (!match) return null;
  return classCompletions(context.pos, match[1] ?? "");
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
