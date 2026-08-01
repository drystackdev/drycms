import { path } from "virtual:drycms/config";
import type { DryComponentRecord } from "./components/RichTextField/component-registry-types.js";
import { defineBuiltComponents } from "./components/RichTextField/dry-component-runtime.js";

/**
 * Published-site counterpart to `useRichTextEditor.ts`'s own component
 * bootstrap (mục 8, `status/register-compoennt.md`) - a page's exported
 * HTML holds inert `<dry-{name} props="...">` tags (`html.ts`'s
 * `dryComponentHtml`) until *something* calls `customElements.define` for
 * each one; this is that something, meant for a consumer's own layout to
 * import once for side effects:
 *
 * ```ts
 * import "drycms/richtext-runtime";
 * ```
 *
 * Only on any page that might render `RichTextField` content - harmless but
 * pointless to include site-wide. Same `defineDryComponent` the editor uses,
 * just driven by a real `fetch` here (no memoization/cache like
 * `useRichTextEditor.ts`'s `loadRichtextComponents` - a page bootstrap runs
 * once per navigation, not once per several co-mounted editor instances).
 */
async function bootstrapRichtextComponents(): Promise<void> {
  try {
    const res = await fetch(`${path}/api/richtext-components`);
    if (!res.ok) return;
    const data = await res.json();
    const records: DryComponentRecord[] = Array.isArray(data.records) ? data.records : [];
    defineBuiltComponents(path, records);
  } catch {
    // No richtext content on this page, or the admin API isn't reachable
    // from it (different deploy target, offline, ...) - either way, fail
    // silently rather than breaking the rest of the page's own scripts.
  }
}

if (typeof window !== "undefined" && typeof customElements !== "undefined") {
  void bootstrapRichtextComponents();
}
