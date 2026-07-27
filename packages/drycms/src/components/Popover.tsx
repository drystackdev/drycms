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
  /** Menu content, top to bottom - mix `{ type: "item", ... }` and `{ type: "separator" }`.
   * Omit and pass `children` instead (raw `<li>`s) for custom content that
   * shouldn't auto-close on click, e.g. a group of checkboxes. */
  items?: PopoverMenuEntry[];
  /** Custom menu content (`<li>` elements) instead of `items` - clicking
   * inside doesn't auto-close the popover, only outside-click/Escape does. */
  children?: ComponentChildren;
  /** Accessible label for the trigger button, e.g. `More actions for readme.md`. */
  label: string;
  /** Trigger content. Pass a callback to render a fully custom trigger
   * element instead of the default button - call the given `onClick` on it
   * to wire up open/close, and use `open` to react to the popover's own
   * state (e.g. flip a chevron). @default a kebab `MoreVerticalIcon` button */
  trigger?: ComponentChildren | ((onClick: (event: MouseEvent) => void, open: boolean) => ComponentChildren);
  /** Set to `""` to omit the trigger's tooltip - e.g. when `trigger` already
   * carries a visible label. @default "More actions" */
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
  children,
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

  const handleTriggerClick = (event: MouseEvent) => {
    event.stopPropagation();
    setOpen((current) => !current);
  };

  return (
    <div class="popover" ref={wrapRef}>
      {typeof trigger === "function" ? (
        trigger(handleTriggerClick, open)
      ) : (
        <button
          type="button"
          data-tooltip={tooltip || undefined}
          aria-label={label}
          aria-haspopup={children ? "true" : "menu"}
          aria-expanded={open}
          onClick={handleTriggerClick}
          class="icon ghost"
        >
          <MoreVerticalIcon />
        </button>
      )}
      <ul
        ref={menuRef}
        popover="auto"
        class={[
          "popover-menu",
          openUp && "up"
        ].filter(Boolean).join(" ")}
        role={children ? undefined : "menu"}
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
        {children ?? items?.map((entry, index) =>
          entry.type === "separator" ? (
            <li
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
