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
    });
  }
  return listsPromise;
}

/** Kicks off the (one-time) load eagerly so the lists are likely warm by the
 * time the user's first keystroke could trigger a completion. */
void loadTailwindLists();

const CLASS_ATTR_RE = /\b(?:className|class)\s*=\s*["']([^"']*)$/;

/**
 * `CompletionSource` for `prism-code-editor`'s autocomplete extension (see
 * `Editer.tsx`) - suggests Tailwind utility classes and variants (`hover:`,
 * `md:`, `group-hover:`, ...) while the cursor is inside a `className="..."`
 * string.
 *
 * Both kinds of suggestion are computed off the same in-progress token
 * (everything after the last space), further split on its last `:` - the
 * part after that is what's currently being typed (`segment`), the part
 * before (if any) is one or more already-chosen variants left untouched in
 * the document. Variants and utility classes are offered side by side for
 * that same `segment`, since either is a valid next thing to type there;
 * picking a variant inserts its trailing `:` too, so the very next keystroke
 * re-runs this same source with a new, now-empty `segment` after it - which
 * is how stacking (`md:hover:bg-red-500`) falls out for free, with no
 * explicit handling of "how many variants deep" here.
 */
export const tailwindCompletionSource: CompletionSource = (context) => {
  if (!classList || !variantList) return null;
  const match = CLASS_ATTR_RE.exec(context.before);
  if (!match) return null;
  const classesSoFar = match[1] ?? "";
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
    from: context.pos - segment.length,
    options,
  };
};
