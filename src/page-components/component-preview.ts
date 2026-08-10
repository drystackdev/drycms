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

/**
 * `propsSource` is an object-literal SOURCE (see `props-sample.ts`), used
 * only when the component doesn't export `_preview` - an explicit `_preview`
 * always wins, and may be an ARRAY, in which case each entry renders as its
 * own variant, stacked in document order.
 *
 * The `typeof` guard turns "this file has no default export" into a readable
 * preview error instead of a bare "undefined is not a function" from deep
 * inside Preact's render.
 */
export function buildComponentPreviewSource(componentPath: string, propsSource: string): string {
  return `import DryPreviewComponent, * as dryPreviewModule from ${JSON.stringify(aliasSpecifierFor(componentPath))};

const dryGeneratedProps = ${propsSource};

export default function DryComponentPreview() {
  if (typeof DryPreviewComponent !== "function") {
    throw new Error(${JSON.stringify(`"${componentPath}" has no default export function to preview.`)});
  }
  const preview = (dryPreviewModule as { _preview?: unknown })._preview;
  const list = Array.isArray(preview) ? preview : [preview ?? dryGeneratedProps];
  return (
    <>
      {list.map((props: unknown, index: number) => (
        <DryPreviewComponent key={index} {...(props as Record<string, unknown>)} />
      ))}
    </>
  );
}
`;
}
