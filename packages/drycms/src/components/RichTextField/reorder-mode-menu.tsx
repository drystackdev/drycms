import { TrashIcon } from "../icons.js";
import { runCommand } from "./commands.js";
import { deleteSelectedBlocks, setReorderMode, type ReorderModeValue } from "./reorder-mode.js";
import type { ToolbarCustomProps } from "./types.js";

const MODES: { value: ReorderModeValue; label: string }[] = [
  { value: "block", label: "Block" },
  { value: "container", label: "Container" },
  { value: "nested-container", label: "Nested container" },
];

/** Secondary toolbar shown only while reorder mode (`reorder-mode.ts`) is
 * active - picks one of its 3 modes (`ReorderModeValue`). Rendered directly
 * in `toolbar.tsx` (not through `TOOLBAR_GROUPS`, same as `TableMenu`/
 * `GridMenu`/`DryComponentMenu`) since every other item there gets disabled
 * while reorder mode is on, but this one only makes sense then. */
export default function ReorderModeMenu({ viewRef, state, disabled = false, iconSize }: ToolbarCustomProps) {
  if (!state.reorderModeActive) return <></>;

  const select = (mode: ReorderModeValue) => {
    const view = viewRef.current;
    if (!view) return;
    runCommand(view, setReorderMode(mode));
  };

  const deleteSelected = () => {
    const view = viewRef.current;
    if (!view) return;
    runCommand(view, deleteSelectedBlocks());
  };

  return (
    <div class="richtext-toolbar-block" role="radiogroup" aria-label="Reorder mode">
      {MODES.map((item) => (
        <button
          key={item.value}
          type="button"
          class={`ghost ${iconSize}`}
          role="radio"
          aria-checked={state.reorderMode === item.value}
          aria-pressed={state.reorderMode === item.value}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => select(item.value)}
        >
          {item.label}
        </button>
      ))}
      <button
        type="button"
        class={`ghost icon ${iconSize}`}
        aria-label="Delete selected"
        data-tooltip="Delete selected"
        disabled={disabled || state.reorderSelectedCount === 0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={deleteSelected}
      >
        <TrashIcon />
      </button>
    </div>
  );
}
