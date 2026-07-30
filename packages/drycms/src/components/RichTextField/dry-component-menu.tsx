import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import FloatingPanel from "../FloatingPanel.js";
import { SettingsIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import type { DryComponentRecord } from "./component-registry-types.js";
import DryComponentPropsForm from "./dry-component-props-form.js";
import type { ToolbarState } from "./types.js";
import { loadRichtextComponents } from "./useRichTextEditor.js";

export interface DryComponentMenuProps {
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
}

/**
 * Floating "settings" anchor for a selected `<dry-{name}>` node - same
 * always-mounted-but-usually-invisible shape as `image-menu.tsx`/
 * `table-menu.tsx` (`FloatingPanel anchor={null}` renders nothing). Detects
 * its own selection locally (`viewRef.current.state.selection`) rather than
 * through a new `ToolbarState` field - none of its own fields are read here.
 * `state` is still accepted and passed through anyway (confirmed via a real
 * browser test, not just reasoning about it): a *new* prop reference each
 * transaction is what actually makes `toolbar.tsx`'s re-render reliably
 * reach this component on every dispatch - `viewRef` (a stable ref object)
 * and `disabled` (unchanged across most transactions) alone weren't enough
 * for that in practice, unlike prose-level reasoning about "the parent
 * re-rendered so this should too" would suggest. Hidden entirely when the
 * selected component's own schema has no props (mục 9).
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
  const name = isDrySelection ? (selection as NodeSelection).node.type.name.slice("dry_".length) : null;
  const record = name ? (records.find((r) => r.name === name) ?? null) : null;
  const pos = isDrySelection ? (selection as NodeSelection).from : null;
  const anchor = pos !== null && view ? (view.nodeDOM(pos) as HTMLElement | null) : null;
  const hasProps = record ? Object.keys(record.props).length > 0 : false;

  const openDialog = () => {
    if (!isDrySelection) return;
    setDraft({ ...((selection as NodeSelection).node.attrs.props as Record<string, unknown>) });
    setOpen(true);
  };

  const save = () => {
    if (!view || pos === null) return;
    view.dispatch(view.state.tr.setNodeAttribute(pos, "props", draft));
    setOpen(false);
    view.focus();
  };

  return (
    <FloatingPanel anchor={record && hasProps ? anchor : null} class="dry-component-menu">
      <button
        type="button"
        class="ghost icon sm"
        aria-label="Component settings"
        data-tooltip="Settings"
        disabled={disabled}
        onClick={openDialog}
      >
        <SettingsIcon />
      </button>
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
