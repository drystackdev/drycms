import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, LockIcon, SettingsIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import type { DryComponentRecord } from "./component-registry-types.js";
import DryComponentPropsForm from "./dry-component-props-form.js";
import type { ImageAlign } from "./schema.js";
import type { ToolbarIconSize, ToolbarState } from "./types.js";
import { loadRichtextComponents } from "./useRichTextEditor.js";

export interface DryComponentMenuProps {
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
  iconSize?: ToolbarIconSize;
}

/** Kept just above the CSS collapse transition (180ms, see
 * `.richtext-dry-component-menu-controls-wrap` in components.css) so the
 * card never gets unmounted mid-animation - same idiom `table-menu.tsx`'s/
 * `grid-menu.tsx`'s own `COLLAPSE_DURATION` already use. */
const COLLAPSE_DURATION = 200;

/**
 * The dry-component tool-group docked in the main toolbar (rendered by
 * `toolbar.tsx`, right after `GridMenu`) rather than floating over the
 * component itself - this used to anchor via `FloatingPanel` (same mechanism
 * as `image-menu.tsx`), the same migration `table-menu.tsx`/`grid-menu.tsx`
 * already went through and for the same reason: a separate panel popping up
 * over the content read as a different affordance than every other
 * contextual control in this field, which all live in the toolbar itself.
 * No permanent "insert" half to share a card with, same as `grid-menu.tsx` -
 * `DryComponentInsertButton` (toolbar-buttons.ts) already covers that on its
 * own - so this is purely the expand/collapse-on-selection card, mounted
 * `COLLAPSE_DURATION` past the selection leaving so the width-collapse
 * transition below has time to finish.
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
 * Align/lock buttons mirror `image-menu.tsx`'s own exactly (same
 * `ImageAlign` type, same `lockAspectRatio` semantics) - only shown for an
 * `inline` component (the only kind with those attrs, see schema.ts's
 * `buildDryNodeSpecs`). The settings gear (props dialog) is separate and
 * shown whenever the selected component's own schema has props, regardless
 * of inline/block.
 */
export default function DryComponentMenu({ viewRef, disabled = false, iconSize = "md" }: DryComponentMenuProps) {
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
  const expanded = !!record && (hasProps || isInline);

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
      {controlsMounted && (
        <div
          class={`richtext-dry-component-menu-controls-wrap${controlsShown ? " expanded" : ""}`}
          aria-hidden={!expanded}
        >
          <div class="richtext-dry-component-menu-controls">
            {isInline && (
              <>
                <button
                  type="button"
                  class={`ghost icon ${iconSize}`}
                  aria-label="Align left"
                  data-tooltip="Align left"
                  aria-pressed={align === "left"}
                  disabled={controlsDisabled}
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
                  disabled={controlsDisabled}
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
                  disabled={controlsDisabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleAlign("right")}
                >
                  <AlignRightIcon />
                </button>
                <button
                  type="button"
                  class={`ghost icon ${iconSize}`}
                  aria-label={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  data-tooltip={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  aria-pressed={locked}
                  disabled={controlsDisabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={toggleLock}
                >
                  <LockIcon />
                </button>
                {hasProps && <hr class="separator" role="separator" aria-orientation="vertical" />}
              </>
            )}
            {hasProps && (
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
            )}
          </div>
        </div>
      )}
      <dialog ref={dialogRef} class="md" aria-label={record ? `${record.label} settings` : "Component settings"}>
        {open && record && (
          <>
            <header>
              <h3>{record.label}</h3>
            </header>
            <div class="stack">
              <DryComponentPropsForm schema={record.props} value={draft} onChange={setDraft} />
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
