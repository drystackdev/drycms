import { Component, h, render, type ComponentChildren, type ComponentType } from "preact";
import { isDryComponentDefinition } from "./register-component.js";

/**
 * Isolates one custom component's render from the rest of the page/editor -
 * a component author's own bug (throwing during render) only takes down its
 * own `<dry-{name}>` instance, not the whole editor/admin preview grid.
 * Shared by `ComponentPreview.tsx` (mục 3's admin list + mục 4's insert
 * dialog) and `defineDryComponent` below (mục 7) - same failure mode either
 * place.
 */
export class DryComponentErrorBoundary extends Component<{ children: ComponentChildren }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return h("div", { class: "dry-component-error" }, `Component error: ${this.state.error.message}`);
    }
    return this.props.children;
  }
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
 * Registers `<dry-{name}>` as a native custom element wrapping a lazily-
 * loaded Preact component - hand-rolled (no `preact-custom-element`
 * dependency, mục 7 of `status/register-compoennt.md`) since the only thing
 * this needs to read is a single `props` attribute (one JSON blob, not one
 * attribute per field the way that library's generic support does).
 *
 * Shared by the editor (`useRichTextEditor.ts`, registering on mount) and
 * the published site's own bootstrap script (`richtext-runtime.ts`) - same
 * function, only `load`/call site differ.
 */
export function defineDryComponent(name: string, load: DryComponentLoader, shadow: boolean): void {
  const tag = `dry-${name}`;
  if (customElements.get(tag)) return;

  customElements.define(
    tag,
    class extends HTMLElement {
      static observedAttributes = ["props"];
      #Comp: ComponentType<Record<string, unknown>> | null = null;
      #root: Element | ShadowRoot = this;

      connectedCallback() {
        if (shadow) this.#root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        load()
          .then((mod) => {
            // `mod.default` is the whole `DryEditerComponent(...)` result,
            // not the Preact component itself - see `isDryComponentDefinition`.
            if (!isDryComponentDefinition(mod.default)) return;
            this.#Comp = mod.default.component as ComponentType<Record<string, unknown>>;
            this.#render();
          })
          .catch(() => {
            // Confirmed but never (yet) built (e.g. a 404 on its `.js`) -
            // leave this instance blank rather than an unhandled rejection.
          });
      }

      attributeChangedCallback() {
        if (this.#Comp) this.#render();
      }

      disconnectedCallback() {
        render(null, this.#root as Element);
      }

      #render() {
        let props: Record<string, unknown> = {};
        try {
          props = JSON.parse(this.getAttribute("props") ?? "{}");
        } catch {
          // Hand-edited/corrupted markup - render with empty props rather
          // than throwing and leaving this element permanently blank.
        }
        render(h(DryComponentErrorBoundary, { children: h(this.#Comp!, props) }), this.#root as Element);
      }
    },
  );
}
