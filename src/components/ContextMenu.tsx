import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useNativePopover } from "../hooks/list-nav.js";
import type { PopoverMenuEntry } from "./Popover.js";

export interface ContextMenuProps {
  /** Accessible label for the menu itself (not shown), e.g. "Actions for readme.md". */
  label: string;
  /** Same shape as `Popover`'s own `items` - mix `{ type: "item", ... }` and `{ type: "separator" }`. */
  items: PopoverMenuEntry[];
  /** The right-clickable region - wrapped in a `display: contents` `div`, so
   * it doesn't affect layout (but also can't itself be, say, a `<tr>` -
   * wrap a cell's content instead, or attach `onContextMenu` directly for
   * table rows). */
  children: ComponentChildren;
}

/**
 * The right-click counterpart to `Popover`: instead of a trigger button,
 * `children` itself is the trigger - right-clicking anywhere on it opens
 * `items` as a floating menu at the cursor. Shares `Popover`'s menu markup/
 * CSS (`popover-menu`) and its `popover="auto"` top-layer approach (free
 * outside-click/Escape dismissal, floats above scroll-clipped ancestors and
 * open `<dialog>`s), so the two menus look identical - only the trigger and
 * positioning differ.
 */
export default function ContextMenu({ label, items, children }: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useNativePopover(open, menuRef, () => setOpen(false));

  // Clamps the cursor-anchored position back into the viewport once the
  // menu's real size is known (its item count/labels vary by caller) -
  // otherwise a right-click near the right/bottom edge opens a menu that's
  // partly unreachable.
  useLayoutEffect(() => {
    if (!open || !position) return;
    const menu = menuRef.current;
    if (!menu) return;
    // `useNativePopover`'s own effect (also triggered by `open`) shows it
    // too, but as a later, non-layout `useEffect` - measuring first would
    // hit the popover API's `display: none` default and always read 0x0.
    menu.showPopover?.();
    const rect = menu.getBoundingClientRect();
    const left = Math.min(position.left, Math.max(8, window.innerWidth - rect.width - 8));
    const top = Math.min(position.top, Math.max(8, window.innerHeight - rect.height - 8));
    if (left !== position.left) menu.style.left = `${left}px`;
    if (top !== position.top) menu.style.top = `${top}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-clamp when the menu (re)opens, not on every position change.
  }, [open]);

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    setPosition({ left: event.clientX, top: event.clientY });
    // Right-click dispatches mousedown -> contextmenu -> mouseup as
    // separate tasks (not one synchronous call stack) - a plain
    // `setTimeout(fn, 0)` here can fire and open the popover *before* that
    // trailing mouseup, which the native `popover="auto"` light-dismiss
    // then reads as an outside click and closes it again (opens and
    // instantly flickers shut). Waiting for the real mouseup first
    // guarantees this same gesture has fully ended before we open - with a
    // short fallback timeout for a keyboard/long-press `contextmenu` that
    // has no mouseup to wait for at all.
    let opened = false;
    const openOnce = () => {
      if (opened) return;
      opened = true;
      document.removeEventListener("mouseup", openOnce);
      setOpen(true);
    };
    document.addEventListener("mouseup", openOnce, { once: true });
    setTimeout(openOnce, 150);
  };

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <>
      <div style={{ display: "contents" }} onContextMenu={handleContextMenu}>
        {children}
      </div>
      <ul
        ref={menuRef}
        popover="auto"
        class="popover-menu"
        role="menu"
        aria-label={label}
        style={
          position
            ? { position: "fixed", left: `${position.left}px`, top: `${position.top}px` }
            : undefined
        }
      >
        {items.map((entry, index) =>
          entry.type === "separator" ? (
            <li key={`separator-${index}`} class="popover-menu-separator" role="separator" />
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
    </>
  );
}
