import { useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import FileManager from "../FileManager/FileManager.js";
import FloatingPanel from "../FloatingPanel.js";
import NumberField from "../fields/NumberField.js";
import Select, { type SelectOption } from "../Select.js";
import TextField from "../fields/TextField.js";
import type { FileManagerSource } from "../../storage/entry-types.js";
import { parentFolderOf } from "../../storage/entry-utils.js";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  EditIcon,
  LockIcon,
  ReplaceIcon,
  TrashIcon,
} from "../icons/index.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { removeNodeAt, replaceImageSrc, runCommand, setImageAlign, setImageAttrs } from "./commands.js";
import type { ImageAlign, ImageObjectFit } from "./schema.js";
import type { ToolbarIconSize, ToolbarState } from "./types.js";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "svg", "webp"];
const MIN_IMAGE_SIZE = 24;

/** "Auto scale" is this dialog's own friendlier label for CSS `object-fit:
 * fill` - width and height scale independently to match the box exactly,
 * distorting the image's own ratio if the box's doesn't match it. Only
 * visibly differs from `cover`/`contain` once the box IS a different ratio
 * than the image - i.e. only while aspect ratio is unlocked (see `editLock`
 * disabling this whole select below). */
const OBJECT_FIT_OPTIONS: SelectOption[] = [
  { value: "fill", label: "Auto scale" },
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
];

export interface ImageMenuProps {
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
  /** Same optionality as `ImageInsertButton`'s - only lights up "Replace
   * image" (the toolbar button, and the edit dialog's own shortcut into the
   * same flow) - nothing else here needs a file source. */
  source?: FileManagerSource;
  iconSize?: ToolbarIconSize;
}

/**
 * Floating per-image toolbar - ported from drystack's own image popover
 * (`form/fields/markdoc/editor/popovers/images.tsx`): align, lock-aspect-
 * ratio, edit (alt/caption/width/height/object-fit), replace, and remove -
 * unlike drystack, caption lives in the same edit dialog as everything else
 * rather than its own dedicated button/popover. Anchored via `FloatingPanel`
 * to the selected image's own node-view DOM (`view.nodeDOM`), the same
 * "follow an arbitrary element" mechanism that component's own docstring
 * already calls out this feature as its intended use for.
 */
export default function ImageMenu({ viewRef, state, disabled = false, source, iconSize = "md" }: ImageMenuProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState("");
  const dialogRef = useDialogSync(open, () => setOpen(false));
  const { ref: pickerBody } = useOverlayScrollbars<HTMLDivElement>([open]);

  const [editOpen, setEditOpen] = useState(false);
  const [editAlt, setEditAlt] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [editWidth, setEditWidth] = useState(0);
  const [editHeight, setEditHeight] = useState(0);
  const [editObjectFit, setEditObjectFit] = useState<ImageObjectFit>("contain");
  const [editLock, setEditLock] = useState(false);
  const editDialogRef = useDialogSync(editOpen, () => setEditOpen(false));
  // The dialog's width/height fields sync off this while it's open - read
  // once from the loaded `<img>` rather than kept in state, since it never
  // changes for a given image and `naturalWidth`/`naturalHeight` (unlike the
  // node's own `width`/`height` attrs) are always the image's true ratio.
  const naturalRatioRef = useRef<number | null>(null);

  const selected = state.selectedImage;
  const view = viewRef.current;
  // `view.nodeDOM` is the node view's own root (`.dry-tx-image-wrapper`,
  // `image-view.ts`'s `dom`) - fine as the base for `imgEl()`'s own
  // `querySelector`, but wrong as `FloatingPanel`'s anchor once the image is
  // center-aligned: centering stretches that wrapper to the paragraph's full
  // width (`min-width: 100%`) and text-aligns the actual `<img>` inside it,
  // so the wrapper's own bounding rect no longer overlaps the image at all -
  // the menu would float off at the paragraph's left edge instead of over
  // the now-centered image. `.dry-tx-image-box` (`imageBox` in that same
  // file) is the tightly-fit inner box the resize handles already anchor to
  // for the same reason, so the floating menu follows it instead.
  const wrapperEl = selected && view ? (view.nodeDOM(selected.pos) as HTMLElement | null) : null;
  const anchor = (wrapperEl?.querySelector(".dry-tx-image-box") as HTMLElement | null) ?? wrapperEl;

  const run = (command: Command) => {
    if (!view) return;
    runCommand(view, command);
  };

  const toggleAlign = (value: ImageAlign) => {
    if (!selected) return;
    const current = (selected.node.attrs.align as ImageAlign | null) ?? null;
    run(setImageAlign(selected.pos, current === value ? null : value));
  };

  const openReplace = () => {
    if (disabled || !selected) return;
    setPending("");
    setOpen(true);
  };

  const confirmReplace = async () => {
    if (!pending || !selected || !source) return;
    const all = (await source.listAll?.()) ?? null;
    const list = all ?? (await source.list(parentFolderOf(pending)));
    const entry = list.find((item) => item.id === pending);
    setOpen(false);
    if (entry?.previewUrl) run(replaceImageSrc(selected.pos, entry.previewUrl, entry.name));
  };

  /** Reads the actually-rendered `<img>` for the selected node - used both
   * by the standalone lock toggle below and by `openEdit` to seed the
   * dialog, since `naturalWidth`/`naturalHeight` only live on that live DOM
   * element, not on the ProseMirror node. */
  const imgEl = () => anchor?.querySelector("img") ?? null;

  /** Toggles `lockAspectRatio` directly from the toolbar (no dialog). Per
   * this field's own spec, turning it ON also resyncs height to the
   * image's natural ratio at the *current* width - the whole point of
   * locking is that the two stop drifting apart, so a since-freely-resized
   * image needs to snap back into ratio right away rather than waiting for
   * the next drag. Turning it off just flips the flag - free resize starts
   * from whatever size is already there. */
  const toggleLock = () => {
    if (disabled || !selected) return;
    const locked = !!selected.node.attrs.lockAspectRatio;
    if (locked) {
      run(setImageAttrs(selected.pos, { lockAspectRatio: false }));
      return;
    }
    const img = imgEl();
    const width = (selected.node.attrs.width as number | null) ?? (img ? Math.round(img.getBoundingClientRect().width) : null);
    const ratio = img?.naturalHeight ? img.naturalWidth / img.naturalHeight : null;
    if (width != null && ratio) {
      run(setImageAttrs(selected.pos, { lockAspectRatio: true, width, height: Math.round(width / ratio) }));
    } else {
      run(setImageAttrs(selected.pos, { lockAspectRatio: true }));
    }
  };

  const openEdit = () => {
    if (disabled || !selected) return;
    const img = imgEl();
    naturalRatioRef.current = img?.naturalHeight ? img.naturalWidth / img.naturalHeight : null;
    const rect = img?.getBoundingClientRect();
    setEditAlt((selected.node.attrs.alt as string) ?? "");
    setEditCaption((selected.node.attrs.caption as string) ?? "");
    setEditWidth((selected.node.attrs.width as number | null) ?? (rect ? Math.round(rect.width) : MIN_IMAGE_SIZE));
    setEditHeight((selected.node.attrs.height as number | null) ?? (rect ? Math.round(rect.height) : MIN_IMAGE_SIZE));
    setEditObjectFit((selected.node.attrs.objectFit as ImageObjectFit) ?? "contain");
    setEditLock(!!selected.node.attrs.lockAspectRatio);
    setEditOpen(true);
  };

  const onEditWidth = (value: number) => {
    setEditWidth(value);
    if (editLock && naturalRatioRef.current) setEditHeight(Math.round(value / naturalRatioRef.current));
  };

  const onEditHeight = (value: number) => {
    setEditHeight(value);
    if (editLock && naturalRatioRef.current) setEditWidth(Math.round(value * naturalRatioRef.current));
  };

  const onEditLockToggle = () => {
    const next = !editLock;
    setEditLock(next);
    if (next && naturalRatioRef.current) setEditHeight(Math.round(editWidth / naturalRatioRef.current));
  };

  const confirmEdit = () => {
    if (!selected) return;
    setEditOpen(false);
    run(
      setImageAttrs(selected.pos, {
        alt: editAlt,
        caption: editCaption,
        width: editWidth,
        height: editHeight,
        objectFit: editObjectFit,
        lockAspectRatio: editLock,
      }),
    );
  };

  if (!selected) return null;
  const align = (selected.node.attrs.align as ImageAlign | null) ?? null;
  const locked = !!selected.node.attrs.lockAspectRatio;

  return (
    <>
      <FloatingPanel anchor={anchor}>
        <div class="richtext-image-menu">
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
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label="Edit image"
            data-tooltip="Edit image"
            aria-haspopup="dialog"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openEdit}
          >
            <EditIcon />
          </button>
          {source && (
            <>
              <hr class="separator" role="separator" aria-orientation="vertical" />
              <button
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label="Replace image"
                data-tooltip="Replace image"
                aria-haspopup="dialog"
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={openReplace}
              >
                <ReplaceIcon />
              </button>
            </>
          )}
          <hr class="separator" role="separator" aria-orientation="vertical" />
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label="Remove image"
            data-tooltip="Remove image"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(removeNodeAt(selected.pos, selected.node.nodeSize))}
          >
            <TrashIcon />
          </button>
        </div>
      </FloatingPanel>
      {source && (
        <dialog ref={dialogRef} class="file-dialog image-picker-dialog" aria-label="Replace image">
          {open && (
            <>
              <header>
                <h3>Replace image</h3>
              </header>
              <div class="image-picker-body" ref={pickerBody}>
                <FileManager
                  source={source}
                  value={pending}
                  onChange={(next) => setPending(next as string)}
                  multiple={false}
                  accept={IMAGE_EXTENSIONS}
                  syncUrl={false}
                />
              </div>
              <footer>
                <button type="button" class="outline" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="button" disabled={!pending} onClick={confirmReplace}>
                  Replace
                </button>
              </footer>
            </>
          )}
        </dialog>
      )}
      <dialog ref={editDialogRef} class="file-dialog md" aria-label="Edit image">
        {editOpen && (
          <>
            <header>
              <h3>Edit image</h3>
            </header>
            <div class="stack">
              <TextField
                label="Alt text"
                value={editAlt}
                onChange={setEditAlt}
                placeholder="e.g. A mountain landscape at sunset"
              />
              <TextField
                label="Caption"
                value={editCaption}
                onChange={setEditCaption}
                placeholder="e.g. Sunset over the mountains, taken in July"
              />
              <div class="row" style={{ alignItems: "flex-end" }}>
                <NumberField
                  label="Width"
                  value={editWidth}
                  onChange={onEditWidth}
                  min={MIN_IMAGE_SIZE}
                  placeholder="e.g. 480"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <NumberField
                  label="Height"
                  value={editHeight}
                  onChange={onEditHeight}
                  min={MIN_IMAGE_SIZE}
                  placeholder="e.g. 320"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  class={`outline icon lg`}
                  aria-label={editLock ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  data-tooltip={editLock ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  aria-pressed={editLock}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onEditLockToggle}
                >
                  <LockIcon />
                </button>
              </div>
              <div class="row" style={{ alignItems: "flex-end" }}>
                <div class="field" style={{ flex: 1, minWidth: 0 }}>
                  <label>Fit</label>
                  {/* Only visibly differs from cover/contain once the box is
                   * a different ratio than the image - impossible while
                   * locked (width/height always move together, in ratio). */}
                  <Select
                    options={OBJECT_FIT_OPTIONS}
                    value={editObjectFit}
                    onChange={(value) => setEditObjectFit(value as ImageObjectFit)}
                    disabled={editLock}
                  />
                </div>
                {source && (
                  <button
                    type="button"
                    class="outline lg"
                    aria-haspopup="dialog"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setEditOpen(false);
                      openReplace();
                    }}
                  >
                    <ReplaceIcon /> Replace image
                  </button>
                )}
              </div>
            </div>
            <footer>
              <button type="button" class="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={confirmEdit}>
                Save
              </button>
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
