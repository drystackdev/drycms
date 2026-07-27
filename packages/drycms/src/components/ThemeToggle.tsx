import { MonitorIcon, MoonIcon, SunIcon } from "./icons.js";
import { useStore } from "../hooks/useStore.js";
import { applyTheme, type DryTheme } from "./theme.js";

const ORDER: DryTheme[] = ["system", "light", "dark"];

const LABELS: Record<DryTheme, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
};

/** Cycles system → light → dark, persisted via `useStore` (`drycms:store.theme`
 * in `localStorage`) and applied via `theme.ts`'s `applyTheme` - the same
 * DOM logic a framework-free `[data-theme-toggle]` button uses, so a page
 * mixing both stays in sync either way. The pre-mount flash is avoided
 * separately, by `app.astro`'s inline script reading the same storage
 * before first paint. */
export default function ThemeToggle() {
  const [theme, setTheme] = useStore<DryTheme>("theme", "system");

  const next = () => {
    const value = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] as DryTheme;
    setTheme(value);
    applyTheme(value);
  };

  return (
    <button
      type="button"
      class="ghost icon"
      onClick={next}
      title={LABELS[theme]}
      aria-label={LABELS[theme]}
    >
      {theme === "dark" ? (
        <MoonIcon />
      ) : theme === "light" ? (
        <SunIcon />
      ) : (
        <MonitorIcon />
      )}
    </button>
  );
}
