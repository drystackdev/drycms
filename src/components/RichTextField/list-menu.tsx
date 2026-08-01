import type { JSX } from "preact";
import { runCommand } from "./commands.js";
import Popover from "../Popover.js";
import { BulletListIcon, OrderedListIcon, type IconProps } from "../icons.js";
import { toggleList, type ListType } from "./lists.js";
import { schema } from "./schema.js";
import type { ToolbarCustomProps } from "./types.js";

const LIST_TYPE_OPTIONS: { value: Exclude<ListType, "none">; label: string; Icon: (props: IconProps) => JSX.Element }[] = [
  { value: "bullet", label: "Bulleted list", Icon: BulletListIcon },
  { value: "ordered", label: "Numbered list", Icon: OrderedListIcon },
];

/**
 * A popover instead of a plain toggle button - mirrors `BlockTypeMenu`,
 * since "which list (if any)" is one-of-many rather than a single bit, and
 * the trigger shows whichever type is currently active. Clicking the
 * already-active option again lifts back to plain paragraphs (see
 * `toggleList` in `lists.ts`, which both this and the click-through-to-the-
 * -other-type case rely on).
 */
export default function ListMenu({ viewRef, state, disabled = false, iconSize, shortcut }: ToolbarCustomProps) {
  const current = LIST_TYPE_OPTIONS.find((option) => option.value === state.listType) ?? LIST_TYPE_OPTIONS[0]!;

  const applyListType = (value: Exclude<ListType, "none">) => {
    const view = viewRef.current;
    if (!view) return;
    const listNodeType = value === "bullet" ? schema.nodes.bullet_list! : schema.nodes.ordered_list!;
    runCommand(view, toggleList(listNodeType));
  };

  return (
    <Popover
      label={shortcut ? `List (${shortcut})` : "List"}
      items={LIST_TYPE_OPTIONS.map((option) => ({
        type: "item" as const,
        label: option.label,
        icon: <option.Icon />,
        onClick: () => applyListType(option.value),
      }))}
      trigger={(onClick) => (
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="List"
          data-tooltip={`${state.listType === "none" ? "List" : `List: ${current.label}`}${shortcut ? ` (${shortcut})` : ""}`}
          aria-pressed={state.listType !== "none"}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
        >
          <current.Icon />
        </button>
      )}
    />
  );
}
