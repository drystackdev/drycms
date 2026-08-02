import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { CheckIcon, MoreVerticalIcon } from "./icons.js";
import { useCloseOnResize, usePopupFlip, useTrackRect } from "./list-nav.js";

/** Matches `.popover-menu`'s `width: 11rem` in components.css. */
const MENU_WIDTH = 176;
const EDGE_MARGIN = 8;

export type PopoverMenuEntry =
  | { type: "separator" }
  | {
      type: "item";
      label: string;
      icon?: ComponentChildren;
      onClick: () => void;
      danger?: boolean;
      /** Marks this item as the currently active choice in a one-of-many
       * menu (e.g. text align, block type) - renders a trailing checkmark
       * and swaps the item's role to `menuitemradio`. Omit entirely for
       * plain action menus, where no item is ever "current". */
      checked?: boolean;
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
  /** Opens the menu immediately to the right of the trigger. Used by the
   * collapsed sidebar, where the trigger sits inside the icon-only rail. */
  placement?: "right";
  /** Closes custom `<ul>` content when a link/menu item is clicked. */
  closeOnItemClick?: boolean;
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
 * Flips upward when there isn't room below (see `usePopupFlip`). Background
 * scroll is left free rather than locked - the menu tracks the trigger's
 * live position instead (`useTrackRect`), same mechanism as FloatingPanel.tsx.
 */
export default function Popover({
  items,
  children,
  label,
  trigger,
  tooltip = "More actions",
  placement,
  closeOnItemClick = false,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const openUp = usePopupFlip(open, wrapRef, 220);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    alignRight: boolean;
  } | null>(null);
  useCloseOnResize(open, () => setOpen(false));

  useTrackRect(open, wrapRef.current, () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Right-aligned by default (menu's right edge under the trigger's), but
    // shifted to left-aligned instead when that would run the menu off the
    // left edge of the viewport - a trigger near the left side of a narrow
    // (mobile) screen, now that this no longer becomes a full-width bottom
    // drawer there. `MENU_WIDTH` is a stand-in for the menu's own rendered
    // width (not yet knowable here - the `popover="auto"` element is still
    // closed at this point in the commit, so measuring it would read 0),
    // same role as `usePopupFlip`'s `estimatedHeight` above.
    const alignRight = placement !== "right" && rect.right - MENU_WIDTH >= EDGE_MARGIN;
    setPosition({
      left: placement === "right" ? rect.right : alignRight ? rect.right : rect.left,
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      alignRight,
    });
  });

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
    setOpen((current) => {
      const next = !current;
      if (!next) menuRef.current?.hidePopover?.();
      return next;
    });
  };

  const handleMenuClick = (event: MouseEvent) => {
    if (!closeOnItemClick) return;
    const target = event.target as Element | null;
    if (!target?.closest("a, [role='menuitem'], [role='menuitemradio']")) return;
    setOpen(false);
    menuRef.current?.hidePopover?.();
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
        onClick={handleMenuClick}
        style={
          position
            ? {
                position: "fixed",
                left: `${position.left}px`,
                top: `${position.top}px`,
                transform: `translate(${position.alignRight ? "-100%" : "0"}, ${openUp ? "-100%" : "0"})`,
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
                role={entry.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={entry.checked}
                class={entry.danger ? "popover-menu-danger" : undefined}
                onClick={() => run(entry.onClick)}
              >
                {entry.icon} {entry.label}
                {entry.checked && <CheckIcon class="popover-menu-check" />}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
