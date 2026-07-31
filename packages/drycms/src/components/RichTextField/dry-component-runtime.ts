import { Component, h, render, type ComponentChildren, type ComponentType } from "preact";
import { isDryComponentDefinition } from "./register-component.js";

/** The subset of Preact's own exports a `<dry-{name}>` instance needs to
 * mount/diff its subtree - see `resolvePreact` below for why this is ever
 * anything other than this package's own statically-imported `preact`. */
interface PreactRuntime {
  h: typeof h;
  render: typeof render;
  Component: typeof Component;
}

const hostPreact: PreactRuntime = { h, render, Component };

/**
 * Isolates one custom component's render from the rest of the page/editor -
 * a component author's own bug (throwing during render) only takes down its
 * own `<dry-{name}>` instance, not the whole editor/admin preview grid.
 * Built fresh per `PreactRuntime` (never a single shared class) - an error
 * boundary mounted through one Preact module instance can't catch errors
 * thrown by hooks bound to a *different* instance, same mismatch
 * `resolvePreact` exists to avoid in the first place.
 */
function makeErrorBoundary(preact: PreactRuntime): ComponentType<{ children: ComponentChildren }> {
  return class extends preact.Component<{ children: ComponentChildren }, { error: Error | null }> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
      return { error };
    }

    render() {
      if (this.state.error) {
        return preact.h("div", { class: "dry-component-error" }, `Component error: ${this.state.error.message}`);
      }
      return this.props.children;
    }
  };
}

export type DryComponentLoader = () => Promise<{ default?: unknown }>;

/**
 * Loader for a confirmed component's pre-built bundle
 * (`routes/richtext-components.ts`'s `GET .../{name}.js`) - a genuinely
 * self-contained ES module (Preact + the component's own code inlined, see
 * `build-component-bundle.ts`), so the editor and the published site never
 * need `componentsDir`'s raw source (or their own `preact` dependency) in
 * their own build graph. Used everywhere a *confirmed* component is loaded
 * (`useRichTextEditor.ts`, `dry-component-insert-button.tsx`,
 * `richtext-runtime.ts`); the admin page's own discovery/preview grid is the
 * one place that still loads straight from source, since it lists
 * unconfirmed components too.
 */
export function loadBuiltComponent(basePath: string, name: string): DryComponentLoader {
  return () => import(/* @vite-ignore */ `${basePath}/api/richtext-components/${name}.js`);
}

/**
 * A built component's own bundle imports its `preact`/`preact/hooks` from
 * the shared `preact.js` vendor chunk (`build-component-bundle.ts`'s
 * `PREACT_EXTERNALS`) rather than inlining its own copy - one browser-cached
 * module per confirmed component's *own* code, not a fresh copy of Preact
 * each. But that vendor chunk is a wholly separate build (its own
 * `vite.build()` pass in `buildSharedPreactBundle`), so it's a *different*
 * Preact module instance than the one this package itself statically
 * imports above - same version, different `options` singleton. Preact's
 * hooks (`useState` et al) read a "current component" ref that only that
 * *same* module instance's own render walk ever sets; mounting a built
 * component's tree through `hostPreact` leaves the vendor hooks module's own
 * ref permanently unset, so any hook call inside it throws "Cannot read
 * properties of undefined (reading '__H')" - deterministically, the first
 * time that component renders, not as some dev-only sync fluke. Fetched (and
 * cached) once per `basePath`, then reused for every `<dry-*>` instance
 * `defineDryComponent` mounts from a loader built via `loadBuiltComponent`
 * above with that same `basePath`.
 */
const vendorPreactCache = new Map<string, Promise<PreactRuntime>>();
function loadVendorPreact(basePath: string): Promise<PreactRuntime> {
  let cached = vendorPreactCache.get(basePath);
  if (!cached) {
    cached = import(/* @vite-ignore */ `${basePath}/api/richtext-components/preact.js`) as Promise<PreactRuntime>;
    vendorPreactCache.set(basePath, cached);
  }
  return cached;
}

/**
 * `basePath` set means `load` came from `loadBuiltComponent` (a *built*
 * component) - resolve the matching vendor Preact instance (`loadVendorPreact`
 * above) so its hooks work. Unset means raw/unconfirmed source
 * (`RichtextComponents.tsx`'s own discovery grid, still `import()`-ing a
 * `.tsx` straight from `componentsDir`) - that already shares this page's
 * own module graph (and so this package's own `preact` import) via the dev
 * server, no special-casing needed.
 */
function resolvePreact(basePath: string | undefined): Promise<PreactRuntime> {
  return basePath === undefined ? Promise.resolve(hostPreact) : loadVendorPreact(basePath);
}

/**
 * Registers `<dry-{name}>` as a native custom element wrapping a lazily-
 * loaded Preact component - hand-rolled (no `preact-custom-element`
 * dependency, mục 7 of `status/register-compoennt.md`) since the only thing
 * this needs to read is a single `props` attribute (one JSON blob, not one
 * attribute per field the way that library's generic support does).
 *
 * Shared by the editor (`useRichTextEditor.ts`, registering on mount) and
 * the published site's own bootstrap script (`richtext-runtime.ts`) - same
 * function, only `load`/call site differ. `basePath` should be passed
 * whenever `load` is a `loadBuiltComponent(basePath, name)` loader - see
 * `resolvePreact` above for why.
 */
export function defineDryComponent(name: string, load: DryComponentLoader, shadow: boolean, basePath?: string): void {
  const tag = `dry-${name}`;
  if (customElements.get(tag)) return;

  customElements.define(
    tag,
    class extends HTMLElement {
      static observedAttributes = ["props"];
      #Comp: ComponentType<Record<string, unknown>> | null = null;
      #preact: PreactRuntime | null = null;
      #ErrorBoundary: ComponentType<{ children: ComponentChildren }> | null = null;
      #root: Element | ShadowRoot = this;
      #styleInjected = false;
      #selectionStyleInjected = false;

      connectedCallback() {
        if (shadow) {
          this.#root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
          // A NodeSelection (or an ordinary text drag spanning across this
          // node) is realized as a real DOM Range around the light-DOM
          // element, and Range/Selection extends into open shadow trees -
          // without this, the browser paints its own default ::selection
          // highlight over this component's rendered internals, since
          // content-shadow-styles.ts's editor-wide override doesn't reach
          // past this nested shadow boundary. Same "transparent, let
          // .dry-component-is-selected's outline be the only indicator"
          // reasoning as that file's `.dry-tx-image::selection` - just
          // re-declared here since ::selection rules don't inherit into a
          // shadow root the way most other properties do. Injected
          // unconditionally (not gated on `mod.default.style` like the
          // author style below) so it's in place before anything is ever
          // rendered, and guarded by its own flag since `connectedCallback`
          // can re-run if this element is moved in the DOM.
          if (!this.#selectionStyleInjected) {
            this.#selectionStyleInjected = true;
            const selectionStyleEl = document.createElement("style");
            selectionStyleEl.textContent = "*::selection { background-color: transparent; }";
            this.#root.appendChild(selectionStyleEl);
          }
        }
        Promise.all([load(), resolvePreact(basePath)])
          .then(([mod, preact]) => {
            // `mod.default` is the whole `DryEditerComponent(...)` result,
            // not the Preact component itself - see `isDryComponentDefinition`.
            if (!isDryComponentDefinition(mod.default)) return;
            this.#Comp = mod.default.component as ComponentType<Record<string, unknown>>;
            this.#preact = preact;
            this.#ErrorBoundary = makeErrorBoundary(preact);
            // Appended as a plain sibling node rather than through Preact -
            // `#render()` below only ever diffs the vnode tree it itself
            // mounted, so it never touches (or duplicates) this. Guarded by
            // `#styleInjected` since `connectedCallback` (and so this `.then`)
            // can re-run if the element is moved in the DOM, while the
            // shadow root itself - and anything already appended to it -
            // survives that move.
            if (shadow && mod.default.style && !this.#styleInjected) {
              this.#styleInjected = true;
              const styleEl = document.createElement("style");
              styleEl.textContent = mod.default.style;
              this.#root.appendChild(styleEl);
            }
            this.#render();
          })
          .catch(() => {
            // Confirmed but never (yet) built (e.g. a 404 on its `.js`) -
            // leave this instance blank rather than an unhandled rejection.
          });
      }

      attributeChangedCallback() {
        if (this.#Comp && this.#preact) this.#render();
      }

      disconnectedCallback() {
        this.#preact?.render(null, this.#root as Element);
      }

      #render() {
        let props: Record<string, unknown> = {};
        try {
          props = JSON.parse(this.getAttribute("props") ?? "{}");
        } catch {
          // Hand-edited/corrupted markup - render with empty props rather
          // than throwing and leaving this element permanently blank.
        }
        const preact = this.#preact!;
        preact.render(preact.h(this.#ErrorBoundary!, { children: preact.h(this.#Comp!, props) }), this.#root as Element);
      }
    },
  );
}
