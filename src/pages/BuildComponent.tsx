import { Component, Fragment, h, render, type ComponentChild, type ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CodeEditerField } from "../components/CodeEditorField.js";
import { transformTsxToElement } from "./build-component-transform.js";
import { useDocumentTitle } from "./page-common.js";

const SAMPLE_CODE = `<div style={{ padding: "1rem", color: "crimson" }}>
  Hello from build-component
</div>`;

type Device = "mobile" | "tablet" | "desktop";

/** Reference viewport widths the preview is laid out at before being scaled
 * down (never up) to fit the card - same "fixed width, shrink to fit"
 * technique as `ComponentPreview.tsx`'s `dry-component-preview-scale`. */
const DEVICE_WIDTHS: Record<Device, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 1280,
};

/** Catches a *runtime* error thrown while rendering the typed component
 * (as opposed to a build/transform error, caught in `BuildComponent` itself)
 * and reports it up via `onError` rather than rendering anything - the
 * shadow root goes blank and the same alert banner in the light-DOM preview
 * card takes over, mirroring how a build error is shown. Keyed by the
 * caller on `code` so editing the code always mounts a fresh instance
 * (clearing any previously-caught error) instead of staying latched. */
class PreviewErrorBoundary extends Component<
  { onError: (message: string) => void; children?: ComponentChildren },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children as ComponentChild;
  }
}

/**
 * Initial demo of "build a custom component directly in the CMS"
 * (`plans/build-component.md`) - unrelated to the RichText component
 * feature. Typed TSX is compiled entirely in the browser (sucrase, no Vite/
 * Node build step) and rendered into a shadow root for CSS isolation - the
 * preview intentionally gets no app styling at all, since that's the whole
 * point of the isolation being demonstrated here.
 */
export default function BuildComponent() {
  useDocumentTitle("Build Component");

  const [code, setCode] = useState(SAMPLE_CODE);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  // Mirrors EditableDemo.tsx's transform-in-useMemo shape: recompute only
  // when `code` changes, folding the try/catch's error branch into the same
  // memo rather than a separate effect.
  const element = useMemo(() => {
    try {
      const result = transformTsxToElement(code, h, Fragment);
      setBuildError(null);
      return result;
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- transform is pure in `code` alone
  }, [code]);

  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;
    shadowRootRef.current = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  }, []);

  const [device, setDevice] = useState<Device>("desktop");
  const [fitScale, setFitScale] = useState(1);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // Same `fitScale` idea as `ComponentPreview.tsx`: measure the frame's own
  // content width and shrink the fixed device-width box to match, so a
  // "desktop" preview still fits inside a narrow card instead of overflowing
  // it - re-measured on resize and whenever the selected device changes.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateFitScale = () => {
      const styles = getComputedStyle(frame);
      const paddingInline =
        parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
      const contentWidth = Math.max(1, frame.clientWidth - paddingInline);
      setFitScale(Math.min(1, contentWidth / DEVICE_WIDTHS[device]));
    };
    updateFitScale();
    const observer = new ResizeObserver(updateFitScale);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [device]);

  useEffect(() => {
    const root = shadowRootRef.current;
    if (!root) return;
    setRuntimeError(null);
    if (element === null) {
      render(null, root);
      return;
    }
    render(h(PreviewErrorBoundary, { key: code, onError: setRuntimeError }, element), root);
  }, [element, code]);

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Build Component</h1>
          <p>
            Type a TSX expression on the right - it's compiled in the
            browser and rendered live on the left, isolated in a shadow
            root.
          </p>
        </div>
      </div>

      <div class="build-component-grid">
        <div class="card">
          <header>
            <div class="row justify-between">
              <h2>Preview</h2>
              <div class="file-view-toggle" role="group" aria-label="Preview device">
                {(["mobile", "tablet", "desktop"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    class="ghost sm"
                    aria-pressed={device === option}
                    onClick={() => setDevice(option)}
                  >
                    {option[0]!.toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </header>
          {buildError && (
            <div class="alert destructive" style={{ marginBottom: "1rem" }}>
              <strong>Build error:</strong> {buildError}
            </div>
          )}
          {!buildError && runtimeError && (
            <div class="alert destructive" style={{ marginBottom: "1rem" }}>
              <strong>Runtime error:</strong> {runtimeError}
            </div>
          )}
          <div class="build-component-preview" ref={frameRef}>
            <div
              class="build-component-preview-scale"
              style={{
                width: `${DEVICE_WIDTHS[device]}px`,
                transform: `scale(${fitScale})`,
              }}
            >
              <div ref={previewHostRef} class="build-component-preview-host" />
            </div>
          </div>
        </div>

        <div class="card">
          <header>
            <h2>Code</h2>
          </header>
          <CodeEditerField
            label="Component TSX"
            value={code}
            onChange={setCode}
            language="jsx"
            placeholder={SAMPLE_CODE}
            description="A bare JSX expression, no imports - rendered with Preact's h/Fragment."
          />
        </div>
      </div>
    </>
  );
}
