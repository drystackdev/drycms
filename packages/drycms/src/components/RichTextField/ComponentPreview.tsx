import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import { DryComponentErrorBoundary } from "./dry-component-runtime.js";
import { isDryComponentDefinition } from "./register-component.js";

export interface ComponentPreviewProps {
  name: string;
  label: string;
  defaults: Record<string, unknown>;
  load: () => Promise<{ default?: unknown }>;
}

/**
 * Live preview of a registered component, rendered with its own `defaults` -
 * shared between the component management admin page (mục 3, listing every
 * discovered file) and the richtext toolbar's insert dialog (mục 4, same
 * grid-of-previews shape) so there's exactly one place that knows how to
 * lazy-load + isolate-render one of these (`status/register-compoennt.md`).
 * Loads in parallel with sibling previews, never blocking whatever list/grid
 * it's placed into - a skeleton placeholder fills in until `load()` resolves.
 */
export default function ComponentPreview({ name, label, defaults, load }: ComponentPreviewProps) {
  const [Comp, setComp] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setComp(null);
    setFailed(false);
    load()
      .then((mod) => {
        if (cancelled) return;
        // `mod.default` is the whole `DryEditerComponent(...)` result, not
        // the Preact component itself - the real one lives at `.component`
        // (see `isDryComponentDefinition`'s own doc comment).
        if (isDryComponentDefinition(mod.default)) {
          // Captured into a local first, not read inline inside the
          // `setComp` updater closure below - narrowing from the `if`
          // above doesn't persist into a separately-defined function body.
          const component = mod.default.component as ComponentType<Record<string, unknown>>;
          setComp(() => component);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the loader itself changes
  }, [load]);

  if (failed) {
    return (
      <div class="dry-component-preview dry-component-preview-error" aria-label={label}>
        Failed to load "{label}"
      </div>
    );
  }

  if (!Comp) {
    return <div class="dry-component-preview dry-component-preview-skeleton" aria-label={`Loading ${label}`} aria-busy="true" />;
  }

  return (
    <div class="dry-component-preview" data-component={name}>
      <DryComponentErrorBoundary>
        <Comp {...defaults} />
      </DryComponentErrorBoundary>
    </div>
  );
}
