import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import FloatingPanel from "../FloatingPanel.js";
import type { FileManagerSource } from "../file-manager-types.js";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, LockIcon, SettingsIcon, TrashIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import type { DryComponentRecord } from "./component-registry-types.js";
import DryComponentPropsForm from "./dry-component-props-form.js";
import type { ImageAlign } from "./schema.js";
import type { ToolbarIconSize, ToolbarState } from "./types.js";
import { loadRichtextComponents } from "./component-registry.js";

export interface DryComponentMenuProps {
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
  /** Where the settings dialog's `image`/`images` props read their picker
   * from - same optionality as `ToolbarCustomProps.source`, just not routed
   * through that type since this isn't a `TOOLBAR_GROUPS` custom item
   * (`toolbar.tsx` renders it directly, passing `source` the same way). */
  source?: FileManagerSource;
  iconSize?: ToolbarIconSize;
}

/** Kept just above the CSS collapse transition (180ms, see
 * `.richtext-dry-component-menu-controls-wrap` in components.css) so the
 * card never gets unmounted mid-animation - same idiom `table-menu.tsx`'s/
 * `grid-menu.tsx`'s own `COLLAPSE_DURATION` already use. */
const COLLAPSE_DURATION = 200;

/**
 * An `inline` dry component (the only kind with `image`-style `width`/
 * `height`/`align`/`lockAspectRatio` attrs, see schema.ts's
 * `buildDryNodeSpecs`) gets a `FloatingPanel` anchored to its own node-view
 * DOM, same mechanism (and same align/lock/delete button set) as
 * `image-menu.tsx`'s own floating toolbar - a `block` one instead stays
 * docked in the main toolbar (rendered by `toolbar.tsx`, right after
 * `GridMenu`), the same "no permanent insert half to share a card with, so
 * just an expand/collapse-on-selection card" shape `grid-menu.tsx` uses
 * (`DryComponentInsertButton` in toolbar-buttons.ts already covers
 * inserting one) - mounted `COLLAPSE_DURATION` past the selection leaving
 * so the width-collapse transition below has time to finish.
 *
 * Detects its own selection locally (`viewRef.current.state.selection`)
 * rather than through a new `ToolbarState` field - none of its own fields are
 * read here. `state` is still accepted and passed through anyway (confirmed
 * via a real browser test, not just reasoning about it): a *new* prop
 * reference each transaction is what actually makes `toolbar.tsx`'s
 * re-render reliably reach this component on every dispatch - `viewRef` (a
 * stable ref object) and `disabled` (unchanged across most transactions)
 * alone weren't enough for that in practice, unlike prose-level reasoning
 * about "the parent re-rendered so this should too" would suggest.
 *
 * The settings gear (props dialog) shows whenever the selected component's
 * own schema has props, regardless of inline/block; delete always shows for
 * either kind (the docked block card otherwise has nothing to show at all
 * for a props-less block component, previously leaving it with no way to
 * remove one once inserted).
 */
export default function DryComponentMenu({ viewRef, disabled = false, source, iconSize = "md" }: DryComponentMenuProps) {
  const [records, setRecords] = useState<DryComponentRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const dialogRef = useDialogSync(open, () => setOpen(false));

  useEffect(() => {
    loadRichtextComponents().then(setRecords);
  }, []);

  const view = viewRef.current;
  const selection = view?.state.selection;
  // Either a `NodeSelection` sitting directly on the atom (the only way any
  // dry component used to be selectable), or - for a `children: true`
  // component - the cursor resolved somewhere *inside* its own content
  // (`getSelectedGrid` in `grid.ts` is the same ancestor walk, for the same
  // "selection is inside, not necessarily ON, this node" reason). Checked in
  // that order so an explicit `NodeSelection` (still possible on a
  // `children: true` component too, e.g. selecting it as a whole via
  // keyboard) always wins over the ancestor walk.
  let node: PMNode | null = null;
  let pos: number | null = null;
  if (selection instanceof NodeSelection && selection.node.type.name.startsWith("dry_")) {
    node = selection.node;
    pos = selection.from;
  } else if (selection) {
    const $from = selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      const ancestor = $from.node(d);
      if (ancestor.type.name.startsWith("dry_")) {
        node = ancestor;
        pos = $from.before(d);
        break;
      }
    }
  }
  const isInline = !!node?.type.isInline;
  const name = node ? node.type.name.slice("dry_".length) : null;
  const record = name ? (records.find((r) => r.name === name) ?? null) : null;
  const anchor = pos !== null && view ? (view.nodeDOM(pos) as HTMLElement | null) : null;
  const hasProps = record ? Object.keys(record.props).length > 0 : false;
  // Only actually read by the docked `block` card below - always expanded
  // once one is focused/selected (delete alone is enough reason to show it,
  // even with no props of its own), regardless of `hasProps`.
  const expanded = !!record;

  // Same expand/collapse-on-selection staging as `grid-menu.tsx`'s own
  // `controlsMounted`/`controlsShown`: the card stays mounted
  // `COLLAPSE_DURATION` past `expanded` going false so its width-collapse
  // transition has time to play before it actually unmounts.
  const [controlsMounted, setControlsMounted] = useState(expanded);
  const [controlsShown, setControlsShown] = useState(expanded);
  useEffect(() => {
    if (expanded) {
      setControlsMounted(true);
      const raf = requestAnimationFrame(() => setControlsShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setControlsShown(false);
    const timeout = setTimeout(() => setControlsMounted(false), COLLAPSE_DURATION);
    return () => clearTimeout(timeout);
  }, [expanded]);
  const controlsDisabled = disabled || !expanded;

  const run = (mutate: (tr: Transaction) => Transaction) => {
    if (!view || pos === null) return;
    view.dispatch(mutate(view.state.tr));
    view.focus();
  };

  const align = (node?.attrs.align as ImageAlign | null) ?? null;
  const locked = !!node?.attrs.lockAspectRatio;

  const toggleAlign = (value: ImageAlign) => {
    if (pos === null) return;
    const next = align === value ? null : value;
    run((tr) => tr.setNodeAttribute(pos, "align", next));
  };

  /** Same idea as `image-menu.tsx`'s own `toggleLock`: turning it ON
   * resyncs height to the box's *currently rendered* ratio (no natural-size
   * concept for an arbitrary component, see `dry-component-view.ts`'s own
   * doc comment) so a freely-resized box doesn't keep drifting once locked. */
  const toggleLock = () => {
    if (pos === null || !node) return;
    if (locked) {
      run((tr) => tr.setNodeAttribute(pos, "lockAspectRatio", false));
      return;
    }
    const box = anchor?.querySelector(".dry-component-box") as HTMLElement | null;
    const rect = box?.getBoundingClientRect();
    const width = (node.attrs.width as number | null) ?? (rect ? Math.round(rect.width) : null);
    const ratio = rect?.height ? rect.width / rect.height : null;
    if (width != null && ratio) {
      run((tr) => tr.setNodeAttribute(pos, "lockAspectRatio", true).setNodeAttribute(pos, "height", Math.round(width / ratio)));
    } else {
      run((tr) => tr.setNodeAttribute(pos, "lockAspectRatio", true));
    }
  };

  /** Removes the whole component node, same shape as `image-menu.tsx`'s own
   * delete (`removeNodeAt`) - `node.nodeSize` already covers a `children:
   * true` component's own nested content too, so this is a single clean
   * delete regardless of whether the node is a leaf/atom or not. */
  const remove = () => {
    if (pos === null || !node) return;
    const removeAt = pos;
    const size = node.nodeSize;
    run((tr) => tr.delete(removeAt, removeAt + size));
  };

  const openDialog = () => {
    if (!node || !record) return;
    // `record.defaults` (register-component.ts's `resolveDefaults`) always
    // has every prop key filled in; `node.attrs.props` doesn't, whenever the
    // node predates a prop the schema has since gained (or was placed some
    // other way than through this dialog) - defaulting those missing keys
    // here means the form shows the component's real defaults instead of a
    // blank/zero value the first time this dialog opens on such a node.
    setDraft({ ...record.defaults, ...(node.attrs.props as Record<string, unknown>) });
    setOpen(true);
  };

  const save = () => {
    if (!view || pos === null) return;
    view.dispatch(view.state.tr.setNodeAttribute(pos, "props", draft));
    setOpen(false);
    view.focus();
  };

  return (
    <>
      {isInline ? (
        <FloatingPanel anchor={anchor}>
          <div class="richtext-dry-component-floating-menu">
            <button
              type="button"
              class={`ghost icon ${iconSize}`}
              aria-label="Align left"
              data-tooltip="Align left"
              aria-pressed={align === "left"}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggleAlign("left")}
            >
              <AlignLeftIcon />
            </button>
            <button
              type="button"
              class={`ghost icon ${iconSize}`}
              aria-label="Align center"
              data-tooltip="Align center"
              aria-pressed={align === "center"}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggleAlign("center")}
            >
              <AlignCenterIcon />
            </button>
            <button
              type="button"
              class={`ghost icon ${iconSize}`}
              aria-label="Align right"
              data-tooltip="Align right"
              aria-pressed={align === "right"}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggleAlign("right")}
            >
              <AlignRightIcon />
            </button>
            <hr class="separator" role="separator" aria-orientation="vertical" />
            <button
              type="button"
              class={`ghost icon ${iconSize}`}
              aria-label={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
              data-tooltip={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
              aria-pressed={locked}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleLock}
            >
              <LockIcon />
            </button>
            {hasProps && (
              <button
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label="Component settings"
                data-tooltip="Settings"
                aria-haspopup="dialog"
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={openDialog}
              >
                <SettingsIcon />
              </button>
            )}
            <hr class="separator" role="separator" aria-orientation="vertical" />
            <button
              type="button"
              class={`ghost icon ${iconSize}`}
              aria-label="Delete component"
              data-tooltip="Delete component"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={remove}
            >
              <TrashIcon />
            </button>
          </div>
        </FloatingPanel>
      ) : (
        controlsMounted && (
          <div
            class={`richtext-dry-component-menu-controls-wrap${controlsShown ? " expanded" : ""}`}
            aria-hidden={!expanded}
          >
            <div class="richtext-dry-component-menu-controls">
              {hasProps && (
                <>
                  <button
                    type="button"
                    class={`ghost icon ${iconSize}`}
                    aria-label="Component settings"
                    data-tooltip="Settings"
                    aria-haspopup="dialog"
                    disabled={controlsDisabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={openDialog}
                  >
                    <SettingsIcon />
                  </button>
                  <hr class="separator" role="separator" aria-orientation="vertical" />
                </>
              )}
              <button
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label="Delete component"
                data-tooltip="Delete component"
                disabled={controlsDisabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={remove}
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        )
      )}
      <dialog ref={dialogRef} class="md" aria-label={record ? `${record.label} settings` : "Component settings"}>
        {open && record && (
          <>
            <header>
              <h3>{record.label}</h3>
            </header>
            <div class="stack">
              <DryComponentPropsForm schema={record.props} value={draft} onChange={setDraft} source={source} />
            </div>
            <footer>
              <button type="button" class="outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={save}>
                Save
              </button>
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
