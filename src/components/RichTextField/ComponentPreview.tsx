import { useEffect, useRef, useState } from "preact/hooks";
import { h } from "preact";
import {
  defineDryComponent,
  type DryComponentLoader,
} from "./dry-component-runtime.js";
import { isDryComponentDefinition } from "./register-component.js";
import { MinusIcon, PlusIcon } from "../icons/index.js";

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
  /** Set only when `load` is a `loadBuiltComponent(basePath, name)` loader
   * (the insert dialog's preview, always a confirmed record) - passed
   * straight through to `defineDryComponent` so it mounts through the same
   * Preact instance that component's own bundle got its hooks from, see
   * `dry-component-runtime.ts`'s own `resolvePreact` doc comment. Left unset
   * for the admin discovery grid's raw-source `load`, which needs no such
   * matching. */
  basePath?: string;
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
export default function ComponentPreview({
  name,
  label,
  defaults,
  load,
  shadow,
  childrenHtml,
  basePath,
}: ComponentPreviewProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setFailed(false);
    setZoom(1);
    setFitScale(1);
    defineDryComponent(name, load, shadow, basePath);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when name/loader/shadow/basePath change
  }, [name, load, shadow, basePath]);

  useEffect(() => {
    const element = previewRef.current;
    if (!element || !ready) return;

    const updateFitScale = () => {
      const styles = getComputedStyle(element);
      const paddingInline =
        parseFloat(styles.paddingLeft || "0") +
        parseFloat(styles.paddingRight || "0");
      const contentWidth = Math.max(1, element.clientWidth - paddingInline);
      setFitScale(Math.min(1, contentWidth / 768));
    };

    updateFitScale();
    const observer = new ResizeObserver(updateFitScale);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, name]);

  const currentScale = fitScale * zoom;
  const adjustZoom = (delta: number) => {
    setZoom((current) => Math.min(2, Math.max(0.5, Number((current + delta).toFixed(1)))));
  };
  const previewScaleStyle = {
    "--dry-component-preview-scale": `${currentScale.toFixed(2)}`,
  } as Record<string, string>;

  if (failed) {
    return (
      <div
        class="dry-component-preview dry-component-preview-error"
        aria-label={label}
      >
        Failed to load "{label}"
      </div>
    );
  }

  if (!ready) {
    return (
      <div
        class="dry-component-preview dry-component-preview-skeleton"
        aria-label={`Loading ${label}`}
        aria-busy="true"
      />
    );
  }

  return (
    <div ref={previewRef} class="dry-component-preview" data-component={name}>
      {/* Fixed at a 768px desktop width so the component always lays out the
       * same regardless of how narrow the actual card/grid cell is - CSS
       * scales this box down (never up) to fit, see .dry-component-preview-scale. */}
      <div class="dry-component-preview-scale" style={previewScaleStyle}>
        {h(`dry-${name}`, {
          props: JSON.stringify(defaults),
          ...(childrenHtml
            ? { dangerouslySetInnerHTML: { __html: childrenHtml } }
            : {}),
        })}
      </div>

      <div
        class="dry-component-preview-controls"
        aria-label="Preview zoom controls"
      >
        <button
          type="button"
          class="ghost icon sm"
          aria-label="Reset preview size"
          data-tooltip="Reset size"
          onClick={() => setZoom(1)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 21 21"
            aria-hidden="true"
          >
            <g
              fill="none"
              fill-rule="evenodd"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3.578 6.487A8 8 0 1 1 2.5 10.5" />
              <path d="M7.5 6.5h-4v-4" />
            </g>
          </svg>
        </button>
        <button
          type="button"
          class="ghost icon sm"
          aria-label="Zoom out preview"
          data-tooltip="Zoom out"
          onClick={() => adjustZoom(-0.1)}
        >
          <MinusIcon />
        </button>
        <button
          type="button"
          class="ghost icon sm"
          aria-label="Zoom in preview"
          data-tooltip="Zoom in"
          onClick={() => adjustZoom(0.1)}
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}
