import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { NodeSelection, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import FloatingPanel from "../FloatingPanel.js";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, LockIcon, SettingsIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import type { DryComponentRecord } from "./component-registry-types.js";
import DryComponentPropsForm from "./dry-component-props-form.js";
import type { ImageAlign } from "./schema.js";
import type { ToolbarState } from "./types.js";
import { loadRichtextComponents } from "./useRichTextEditor.js";

export interface DryComponentMenuProps {
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
}

/**
 * Floating anchor for a selected `<dry-{name}>` node - same always-mounted-
 * but-usually-invisible shape as `image-menu.tsx`/`table-menu.tsx`
 * (`FloatingPanel anchor={null}` renders nothing). Detects its own
 * selection locally (`viewRef.current.state.selection`) rather than through
 * a new `ToolbarState` field - none of its own fields are read here. `state`
 * is still accepted and passed through anyway (confirmed via a real browser
 * test, not just reasoning about it): a *new* prop reference each
 * transaction is what actually makes `toolbar.tsx`'s re-render reliably
 * reach this component on every dispatch - `viewRef` (a stable ref object)
 * and `disabled` (unchanged across most transactions) alone weren't enough
 * for that in practice, unlike prose-level reasoning about "the parent
 * re-rendered so this should too" would suggest.
 *
 * Align/lock buttons mirror `image-menu.tsx`'s own exactly (same
 * `ImageAlign` type, same `lockAspectRatio` semantics) - only shown for an
 * `inline` component (the only kind with those attrs, see schema.ts's
 * `buildDryNodeSpecs`). The settings gear (props dialog) is separate and
 * shown whenever the selected component's own schema has props, regardless
 * of inline/block.
 */
export default function DryComponentMenu({ viewRef, disabled = false }: DryComponentMenuProps) {
  const [records, setRecords] = useState<DryComponentRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const dialogRef = useDialogSync(open, () => setOpen(false));

  useEffect(() => {
    loadRichtextComponents().then(setRecords);
  }, []);

  const view = viewRef.current;
  const selection = view?.state.selection;
  const isDrySelection = selection instanceof NodeSelection && selection.node.type.name.startsWith("dry_");
  const node = isDrySelection ? (selection as NodeSelection).node : null;
  const isInline = !!node?.type.isInline;
  const name = node ? node.type.name.slice("dry_".length) : null;
  const record = name ? (records.find((r) => r.name === name) ?? null) : null;
  const pos = isDrySelection ? (selection as NodeSelection).from : null;
  const anchor = pos !== null && view ? (view.nodeDOM(pos) as HTMLElement | null) : null;
  const hasProps = record ? Object.keys(record.props).length > 0 : false;
  const showPanel = !!record && (hasProps || isInline);

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
    if (!node) return;
    setDraft({ ...(node.attrs.props as Record<string, unknown>) });
    setOpen(true);
  };

  const save = () => {
    if (!view || pos === null) return;
    view.dispatch(view.state.tr.setNodeAttribute(pos, "props", draft));
    setOpen(false);
    view.focus();
  };

  return (
    <FloatingPanel anchor={showPanel ? anchor : null} class="dry-component-menu">
      <div class="richtext-image-menu">
        {isInline && (
          <>
            <button
              type="button"
              class="ghost icon sm"
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
              class="ghost icon sm"
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
              class="ghost icon sm"
              aria-label="Align right"
              data-tooltip="Align right"
              aria-pressed={align === "right"}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggleAlign("right")}
            >
              <AlignRightIcon />
            </button>
            <button
              type="button"
              class="ghost icon sm"
              aria-label={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
              data-tooltip={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
              aria-pressed={locked}
              disabled={disabled}
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
            class="ghost icon sm"
            aria-label="Component settings"
            data-tooltip="Settings"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openDialog}
          >
            <SettingsIcon />
          </button>
        )}
      </div>
      <dialog ref={dialogRef} aria-label={record ? `${record.label} settings` : "Component settings"}>
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
    </FloatingPanel>
  );
}
