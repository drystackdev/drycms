import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import FloatingPanel from "../FloatingPanel.js";
import type { FileManagerSource } from "../file-manager-types.js";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, ComponentIcon, LockIcon, SettingsIcon, TrashIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import { flattenDryComponentRecords, type DryComponentRecord } from "./component-registry-types.js";
import DryComponentPropsForm, {
  emptyDryComponentProps,
  isDryComponentPropsValid,
} from "./dry-component-props-form.js";
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

interface ComponentTreeNodeProps {
  record: DryComponentRecord;
  records: DryComponentRecord[];
  trail: Set<string>;
  selectable: boolean;
  onSelect: (record: DryComponentRecord) => void;
}

function ComponentTreeNode({ record, records, trail, selectable, onSelect }: ComponentTreeNodeProps) {
  const nextTrail = new Set(trail).add(record.name);
  const children = (record.refs ?? []).map((name) => records.find((item) => item.name === name) ?? {
    name,
    label: `<dry-${name}>`,
    description: "",
    type: "block" as const,
    shadow: false,
    children: false,
    props: {},
    defaults: {},
    sourcePath: "",
    enabled: true as const,
  });

  return (
    <li role="treeitem" class="dry-component-tree-node">
      <span class={`dry-component-tree-label${selectable ? " selectable" : ""}`}>
        <ComponentIcon />
        <span>{record.label}</span>
        <code>{`<dry-${record.name}>`}</code>
        {selectable && (
          <button
            type="button"
            class="ghost sm dry-component-tree-select"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(record);
            }}
          >
            Select
          </button>
        )}
      </span>
      {children.length > 0 && !trail.has(record.name) && (
        <ul role="group" class="dry-component-tree-children">
          {children.map((child) =>
            nextTrail.has(child.name) ? (
              <li role="treeitem" class="dry-component-tree-node" key={child.name}>
                <span class="dry-component-tree-label">
                  <ComponentIcon />
                  <span>{child.label}</span>
                  <small>(circular ref)</small>
                </span>
              </li>
            ) : (
                  <ComponentTreeNode
                    key={child.name}
                    record={child}
                    records={records}
                    trail={nextTrail}
                    selectable
                    onSelect={onSelect}
                  />
            ),
          )}
        </ul>
      )}
    </li>
  );
}

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
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [configuringRef, setConfiguringRef] = useState<DryComponentRecord | null>(null);
  const [refDraft, setRefDraft] = useState<Record<string, unknown>>({});
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const dialogRef = useDialogSync(open, () => setOpen(false));
  const treeDialogRef = useDialogSync(treeOpen, () => setTreeOpen(false));
  const refDialogRef = useDialogSync(!!configuringRef, () => setConfiguringRef(null));

  useEffect(() => {
    loadRichtextComponents().then(setRecords);
  }, []);

  // The toolbar picker contains only confirmed top-level components, while
  // refs may be stored recursively under `refRecords`. The refs tree needs
  // the flattened metadata too, otherwise a nested Carousel is rendered as
  // an empty fallback record and its props dialog can never open.
  const allRecords = flattenDryComponentRecords(records);

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
  const record = name ? (allRecords.find((r) => r.name === name) ?? null) : null;
  const anchor = pos !== null && view ? (view.nodeDOM(pos) as HTMLElement | null) : null;
  const hasProps = record ? Object.keys(record.props).length > 0 : false;
  const hasRefs = !!record?.refs?.length;

  // Retry after a component becomes selected. This matters when the editor
  // mounted before authentication finished: the initial registry request may
  // have returned 401, leaving the toolbar with no records until selection
  // changes and gives it another opportunity to load.
  useEffect(() => {
    if (name) loadRichtextComponents().then(setRecords);
  }, [name]);

  const insertRef = (ref: DryComponentRecord, props: Record<string, unknown>): boolean => {
    const currentView = viewRef.current ?? view;
    if (!currentView || pos === null || !record || !node) {
      setTreeError("Select the parent component again, then try inserting the ref.");
      return false;
    }
    // Use the schema owned by the live EditorView. The module-level schema is
    // replaced when the async component registry resolves; reading it here
    // can otherwise leave a toolbar callback holding the pre-registry schema
    // while the editor itself already has the ref node type.
    const editorSchema = currentView.state.schema;
    const nodeType = editorSchema.nodes[`dry_${ref.name}`];
    if (!nodeType) {
      setTreeError(`Component <dry-${ref.name}> is not registered in the editor schema.`);
      return false;
    }
    try {
      const child = ref.children
        ? nodeType.create({ props }, editorSchema.nodes.paragraph!.createAndFill()!)
        : nodeType.create({ props });
      // Inline refs belong inside the first textblock of the parent's block
      // children; block refs belong immediately before the parent's closing
      // token. Inserting an inline node directly into `block+` content makes
      // ProseMirror reject the transaction.
      let insertPos = pos + node.nodeSize - 1;
      if (nodeType.isInline) {
        let textblockStart: number | null = null;
        node.descendants((descendant, offset) => {
          if (textblockStart === null && descendant.isTextblock) {
            textblockStart = pos + 1 + offset;
            return false;
          }
          return textblockStart === null;
        });
        if (textblockStart !== null) {
          const textblock = currentView.state.doc.nodeAt(textblockStart);
          insertPos = textblockStart + 1 + (textblock?.content.size ?? 0);
        } else {
          // A children component can legally contain only block nodes. If it
          // currently has no paragraph/heading, create one so an inline ref
          // still has a valid place to live.
          const paragraph = editorSchema.nodes.paragraph!.create(null, child);
          currentView.dispatch(currentView.state.tr.insert(insertPos, paragraph).scrollIntoView());
          currentView.focus();
          setTreeOpen(false);
          return true;
        }
      }
      currentView.dispatch(currentView.state.tr.insert(insertPos, child).scrollIntoView());
      currentView.focus();
      setTreeOpen(false);
      return true;
    } catch (error) {
      console.error("[drycms] Unable to insert referenced component", error);
      setTreeError(`Unable to insert <dry-${ref.name}> into this component.`);
      return false;
    }
  };

  const selectRef = (ref: DryComponentRecord) => {
    if (Object.keys(ref.props).length > 0) {
      setRefDraft(emptyDryComponentProps(ref.props));
      setConfiguringRef(ref);
      setTreeOpen(false);
      return;
    }
    insertRef(ref, ref.defaults);
  };

  const confirmRef = () => {
    if (!configuringRef || !isDryComponentPropsValid(configuringRef.props, refDraft)) return;
    if (insertRef(configuringRef, refDraft)) setConfiguringRef(null);
  };

  const refDraftValid = configuringRef
    ? isDryComponentPropsValid(configuringRef.props, refDraft)
    : false;
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
            {hasRefs && (
              <button
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label="Select referenced component"
                data-tooltip="Select ref"
                aria-haspopup="dialog"
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setTreeError(null);
                  setTreeOpen(true);
                }}
              >
                <ComponentIcon />
              </button>
            )}
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
              {hasRefs && (
                <>
                  <button
                    type="button"
                    class={`ghost icon ${iconSize}`}
                    aria-label="Select referenced component"
                    data-tooltip="Select ref"
                    aria-haspopup="dialog"
                    disabled={controlsDisabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setTreeError(null);
                      setTreeOpen(true);
                    }}
                  >
                    <ComponentIcon />
                  </button>
                  <hr class="separator" role="separator" aria-orientation="vertical" />
                </>
              )}
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
      <dialog ref={treeDialogRef} class="md" aria-label={record ? `${record.label} refs` : "Component refs"}>
        {treeOpen && record && (
          <>
            <header>
              <h3>{record.label} refs</h3>
              <p class="hint">Select a component to insert it inside this component.</p>
            </header>
            <div class="dry-component-tree-dialog-body">
              {treeError && <p class="error">{treeError}</p>}
              <ul role="tree" class="dry-component-tree">
                <ComponentTreeNode
                  record={record}
                  records={allRecords}
                  trail={new Set()}
                  selectable={false}
                  onSelect={selectRef}
                />
              </ul>
            </div>
            <footer>
              <button type="button" onClick={() => setTreeOpen(false)}>Close</button>
            </footer>
          </>
        )}
      </dialog>
      <dialog ref={refDialogRef} class="md" aria-label={configuringRef ? `${configuringRef.label} settings` : "Referenced component settings"}>
        {configuringRef && (
          <>
            <header>
              <h3>{configuringRef.label}</h3>
            </header>
            <div class="stack">
              {treeError && <p class="error">{treeError}</p>}
              <DryComponentPropsForm
                schema={configuringRef.props}
                value={refDraft}
                onChange={setRefDraft}
                source={source}
              />
            </div>
            <footer>
              <button type="button" class="outline" onClick={() => setConfiguringRef(null)}>
                Cancel
              </button>
              <button type="button" disabled={!refDraftValid} onClick={confirmRef}>
                Insert
              </button>
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
