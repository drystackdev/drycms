import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
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
 * button and portaled to `<body>` so it floats free of any scroll/overflow
 * clipped ancestor (a table's `.scroll` wrapper, a card, ...). Flips upward
 * when there isn't room below (see `usePopupFlip`).
 */
export default function Popover({
  items,
  label,
  trigger,
  tooltip = "More actions",
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const openUp = usePopupFlip(open, wrapRef, 220);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  useScrollLock(open, wrapRef);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: rect.right,
      top: openUp ? rect.top - 4 : rect.bottom + 4,
    });
  }, [open, openUp]);

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
      {open &&
        position &&
        createPortal(
          <>
            <div
              class="popover-backdrop"
              onClick={() => setOpen(false)}
            />
            <ul
              class={openUp ? "popover-menu up" : "popover-menu"}
              role="menu"
              style={{
                position: "fixed",
                left: `${position.left}px`,
                top: `${position.top}px`,
                transform: openUp
                  ? "translate(-100%, -100%)"
                  : "translate(-100%, 0)",
              }}
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
          </>,
          document.body,
        )}
    </div>
  );
}
