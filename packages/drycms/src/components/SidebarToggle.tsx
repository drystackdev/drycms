import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { CloseIcon, MenuIcon } from "./icons.js";
import { collapsed } from "../store/dashboard.js";

/**
 * Opens the off-canvas sidebar on small screens by toggling the `.open` class
 * on the shell element, which is all the CSS needs.
 */
export default function SidebarToggle() {
  const { url } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".shell");
    shell?.classList.toggle("open", open);
  }, [open]);

  /* Tapping a nav link navigates but is itself a click *inside* `.sidebar`,
   * which the outside-click handler below deliberately ignores (see its
   * comment) - so nothing else closes the drawer after navigating. Without
   * this, the drawer (and its backdrop) is left open over the new page. */
  useEffect(() => {
    setOpen(false);
  }, [url]);

  /* The off-canvas drawer only exists below the `48rem` breakpoint (see
   * `.shell.open` in components.css) - if the menu was left open there and
   * the viewport then grows into desktop width, close it so it doesn't pop
   * back up as a leftover overlay if the window later shrinks again. */
  useEffect(() => {
    const query = window.matchMedia("(width >= 48rem)");
    const onChange = (event: MediaQueryList | MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    onChange(query);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(".sidebar") ||
        target?.closest("[data-sidebar-toggle]")
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  return (
    <button
      type="button"
      class="ghost icon mobile-only"
      data-sidebar-toggle
      aria-expanded={open}
      aria-label={open ? "Close navigation" : "Open navigation"}
      onClick={() => {
        setOpen((value) => !value);
        collapsed.value = false;
      }}
    >
      <MenuIcon />
    </button>
  );
}
