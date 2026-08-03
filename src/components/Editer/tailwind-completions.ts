import type { CompletionSource } from "prism-code-editor/autocomplete";
import tailwindIndexCss from "tailwindcss/index.css?raw";
import { __unstable__loadDesignSystem } from "tailwindcss";

/**
 * Shared across every `Editer` instance on the page - the class list only
 * depends on the (for now, fixed default) theme, not on which file is being
 * edited, so there's no reason to reload it per instance.
 */
let classList: string[] | undefined;
let classListPromise: Promise<string[]> | undefined;

function loadClassList(): Promise<string[]> {
  if (!classListPromise) {
    // `tailwindcss/index.css` (unlike most CSS entry points) has no further
    // `@import`s of its own - theme tokens, base reset and the `@tailwind
    // utilities` marker are all inlined in that one file - so `loadStylesheet`
    // only ever needs to resolve the single top-level `@import "tailwindcss"` below.
    classListPromise = __unstable__loadDesignSystem('@import "tailwindcss";', {
      loadStylesheet: async (id, base) => ({ path: id, base, content: tailwindIndexCss }),
    }).then((designSystem) => {
      classList = designSystem.getClassList().map(([className]) => className);
      return classList;
    });
  }
  return classListPromise;
}

/** Kicks off the (one-time) load eagerly so `classList` is likely warm by the
 * time the user's first keystroke could trigger a completion. */
void loadClassList();

const CLASS_ATTR_RE = /\b(?:className|class)\s*=\s*["']([^"']*)$/;

/** `CompletionSource` for `prism-code-editor`'s autocomplete extension (see
 * `Editer.tsx`) - suggests Tailwind utility classes while the cursor is
 * inside a `className="..."` string. */
export const tailwindCompletionSource: CompletionSource = (context) => {
  if (!classList) return null;
  const match = CLASS_ATTR_RE.exec(context.before);
  if (!match) return null;
  const classesSoFar = match[1] ?? "";
  const prefix = classesSoFar.slice(classesSoFar.lastIndexOf(" ") + 1);
  if (!prefix) return null;
  const matches = classList.filter((name) => name.startsWith(prefix)).slice(0, 50);
  if (matches.length === 0) return null;
  return {
    from: context.pos - prefix.length,
    options: matches.map((label) => ({ label, icon: "property" })),
  };
};
