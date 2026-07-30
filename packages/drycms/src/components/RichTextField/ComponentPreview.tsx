import { useEffect, useState } from "preact/hooks";
import { h } from "preact";
import { defineDryComponent, type DryComponentLoader } from "./dry-component-runtime.js";
import { isDryComponentDefinition } from "./register-component.js";

export interface ComponentPreviewProps {
  name: string;
  label: string;
  defaults: Record<string, unknown>;
  load: DryComponentLoader;
  shadow: boolean;
  /** Default light-DOM HTML for a `children: true` component - see
   * `DryComponentConfig.children`'s own doc comment (register-component.ts).
   * Set as the mounted `<dry-{name}>` element's own `innerHTML`, exactly
   * where the editor's real projected content would otherwise live, so the
   * native `<slot>` inside its shadow root has something to show here. */
  childrenHtml?: string;
}

/**
 * Live preview of a registered component - mounts the SAME `<dry-{name}>`
 * custom element `RichTextField` itself inserts (`defineDryComponent`,
 * `dry-component-runtime.ts`), not a bare `<Comp {...defaults}/>` - so a
 * `shadow: true` component previews inside its own real shadow root (no
 * page-level styles leaking in, exactly the isolation the editor gives it)
 * instead of always rendering as if `shadow` were off. Shared between the
 * component management admin page (mục 3, listing every discovered file)
 * and the richtext toolbar's insert dialog (mục 4, same grid-of-previews
 * shape) so there's exactly one place that knows how to lazy-load +
 * isolate-render one of these (`status/register-compoennt.md`).
 * Loads in parallel with sibling previews, never blocking whatever list/grid
 * it's placed into - a skeleton placeholder fills in until `load()` resolves.
 */
export default function ComponentPreview({ name, label, defaults, load, shadow, childrenHtml }: ComponentPreviewProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setFailed(false);
    defineDryComponent(name, load, shadow);
    load()
      .then((mod) => {
        if (cancelled) return;
        if (isDryComponentDefinition(mod.default)) {
          setReady(true);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when name/loader/shadow change
  }, [name, load, shadow]);

  if (failed) {
    return (
      <div class="dry-component-preview dry-component-preview-error" aria-label={label}>
        Failed to load "{label}"
      </div>
    );
  }

  if (!ready) {
    return <div class="dry-component-preview dry-component-preview-skeleton" aria-label={`Loading ${label}`} aria-busy="true" />;
  }

  return (
    <div class="dry-component-preview" data-component={name}>
      {h(`dry-${name}`, {
        props: JSON.stringify(defaults),
        ...(childrenHtml ? { dangerouslySetInnerHTML: { __html: childrenHtml } } : {}),
      })}
    </div>
  );
}
