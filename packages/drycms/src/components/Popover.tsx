import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { MoreVerticalIcon } from "./icons.js";
import { usePopupFlip, useScrollLock } from "./list-nav.js";

export type PopoverMenuEntry =
  | { type: "separator" }
  | {
      type: "item";
      label: string;
      icon?: ComponentChildren;
      onClick: () => void;
      danger?: boolean;
    };

export interface PopoverProps {
  /** Menu content, top to bottom - mix `{ type: "item", ... }` and `{ type: "separator" }`. */
  items: PopoverMenuEntry[];
  /** Accessible label for the trigger button, e.g. `More actions for readme.md`. */
  label: string;
  /** Trigger button content. @default a kebab `MoreVerticalIcon` */
  trigger?: ComponentChildren;
  /** @default "More actions" */
  tooltip?: string;
}

/**
 * A trigger button that opens a menu of actions, right-aligned under the
 * button. Uses the Popover API (`popover="auto"`) rather than a portal, so
 * it puts the menu in the browser's top layer - floats free of any scroll/
 * overflow-clipped ancestor (a table's `.scroll` wrapper, a card, ...) *and*
 * above an open native `<dialog>` (e.g. the file preview's "more" menu),
 * which a `document.body` portal alone can't do: a `<dialog>` shown via
 * `showModal()` is *also* top-layer, and regular DOM content - portaled or
 * not - can never paint above the top layer regardless of z-index. `auto`
 * mode gets outside-click/Escape dismissal for free, unlike Toast.tsx's
 * `popover="manual"` (a toast stack needs custom show/hide timing instead).
 * Flips upward when there isn't room below (see `usePopupFlip`).
 */
export default function Popover({
  items,
  label,
  trigger,
  tooltip = "More actions",
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const openUp = usePopupFlip(open, wrapRef, 220);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  useScrollLock(open, wrapRef);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: rect.right,
      top: openUp ? rect.top - 4 : rect.bottom + 4,
    });
  }, [open, openUp]);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    if (open) el.showPopover?.();
    else el.hidePopover?.();
  }, [open]);

  // `auto` popovers can close themselves (outside click, Escape) - listen so
  // `open` (and the trigger's `aria-expanded`) don't go stale when that happens.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const handleToggle = (event: Event) => {
      if ((event as Event & { newState?: string }).newState === "closed") {
        setOpen(false);
      }
    };
    el.addEventListener("toggle", handleToggle);
    return () => el.removeEventListener("toggle", handleToggle);
  }, []);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div class="popover" ref={wrapRef}>
      <button
        type="button"
        class="ghost icon sm"
        data-tooltip={tooltip}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        {trigger ?? <MoreVerticalIcon />}
      </button>
      <ul
        ref={menuRef}
        popover="auto"
        class={openUp ? "popover-menu up" : "popover-menu"}
        role="menu"
        style={
          position
            ? {
                position: "fixed",
                left: `${position.left}px`,
                top: `${position.top}px`,
                transform: openUp
                  ? "translate(-100%, -100%)"
                  : "translate(-100%, 0)",
              }
            : undefined
        }
      >
        {items.map((entry, index) =>
          entry.type === "separator" ? (
            <li
              // eslint-disable-next-line react/no-array-index-key
              key={`separator-${index}`}
              class="popover-menu-separator"
              role="separator"
            />
          ) : (
            <li key={entry.label} role="none">
              <button
                type="button"
                role="menuitem"
                class={entry.danger ? "popover-menu-danger" : undefined}
                onClick={() => run(entry.onClick)}
              >
                {entry.icon} {entry.label}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
