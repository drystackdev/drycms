import { COMPONENT_ALIAS, COMPONENT_ROOT } from "../server/app-router/source-roots.js";

/**
 * The synthetic page a component is previewed through (`plans/component.md`
 * mục 4). Nothing here is ever written to storage - `PageEditor.tsx` merges
 * it into its own LOCAL copy of `sourceByPath` for one `buildPage()` call,
 * the same trick `LAYOUT_PLACEHOLDER_PATH` already uses to preview a layout.
 *
 * Going through `buildPage()` (rather than rendering the component straight
 * into the admin document) is what makes the preview truthful: the component
 * renders inside a real built page, so it gets the site's own `globals.css`
 * and a Tailwind compile of exactly the classes it uses - which is the whole
 * point of previewing it at all.
 */

/** Never a real file - lives at the storage root, outside every source root,
 * so it can't collide with anything a user creates. */
export const COMPONENT_PREVIEW_ENTRY_PATH = "__dry-preview-component.tsx";

/** `"component/ui/Card.tsx"` -> `"@component/ui/Card"`. */
export function aliasSpecifierFor(componentPath: string): string {
  return `${COMPONENT_ALIAS}/${componentPath.slice(COMPONENT_ROOT.length + 1).replace(/\.tsx?$/, "")}`;
}

/** The stage every component preview renders inside: one viewport-sized box
 * centering it both ways, so a component sits in the middle of the preview
 * frame instead of hugging its top-left corner. Plain inline CSS on purpose -
 * a previewed component may use no Tailwind at all, and the stage has to look
 * right either way (it's chrome the build injects, not something the author
 * wrote). `backgroundColor` is passed in already resolved to a concrete color
 * (`resolveThemeColor`, `lib/native/theme.ts`) - the built page carries none
 * of the admin's own tokens, so a `var(--dry-background)` here would resolve
 * to nothing inside the preview iframe. */
function previewStageStyle(backgroundColor: string): string {
  return `display:flex;justify-content:center;align-items:center;width:100dvw;height:100dvh;background-color:${backgroundColor};`;
}

/**
 * Two escape hatches, checked in this order:
 *
 * - `export const _view = (<>…</>)` - already-rendered JSX, shown AS IS. For
 *   a component whose interesting preview isn't "one instance with some
 *   props" (several sizes side by side, a wrapper the component needs around
 *   it, composed children). Nothing is invented for it: what's exported is
 *   exactly what the stage shows.
 * - `export const defaultProps = {…}` - props to render the default export
 *   with, overriding `propsSource` (the object-literal SOURCE invented from
 *   the component's real TS types, see `props-sample.ts`). May be an ARRAY,
 *   in which case each entry renders as its own variant, in document order.
 *
 * With neither, the preview falls back to `propsSource` alone.
 *
 * The `typeof` guard turns "this file has no default export" into a readable
 * preview error instead of a bare "undefined is not a function" from deep
 * inside Preact's render. It sits behind the `_view` check on purpose - a
 * file previewing through `_view` renders whatever that node holds and never
 * touches the default export, so it shouldn't have to have one.
 */
export function buildComponentPreviewSource(
  componentPath: string,
  propsSource: string,
  backgroundColor = "#ffffff",
): string {
  return `import DryPreviewComponent, * as dryPreviewModule from ${JSON.stringify(aliasSpecifierFor(componentPath))};

const dryGeneratedProps = ${propsSource};
const dryPreviewExports = dryPreviewModule as { defaultProps?: unknown; _view?: any };

function dryPreviewChildren() {
  const view = dryPreviewExports._view;
  if (view !== undefined && view !== null) return view;
  if (typeof DryPreviewComponent !== "function") {
    throw new Error(${JSON.stringify(`"${componentPath}" has no default export function to preview.`)});
  }
  const defaults = dryPreviewExports.defaultProps;
  const list = Array.isArray(defaults) ? defaults : [defaults ?? dryGeneratedProps];
  return list.map((props: unknown, index: number) => (
    <DryPreviewComponent key={index} {...(props as Record<string, unknown>)} />
  ));
}

export default function DryComponentPreview() {
  return <div style=${JSON.stringify(previewStageStyle(backgroundColor))}>{dryPreviewChildren()}</div>;
}
`;
}
