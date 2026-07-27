import { MonitorIcon, MoonIcon, SunIcon } from "./icons.js";
import { useStore } from "../hooks/useStore.js";

export type DryTheme = "system" | "light" | "dark";

const ORDER: DryTheme[] = ["system", "light", "dark"];

const LABELS: Record<DryTheme, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
};

function applyTheme(theme: DryTheme) {
  const root = document.querySelector<HTMLElement>(".dry") ?? document.body;
  root.classList.remove("light", "dark");
  if (theme !== "system") root.classList.add(theme);
}

/** Cycles system → light → dark, persisted via `useStore` (`drycms:store.theme`
 * in `localStorage`). The pre-mount flash is avoided separately, by
 * `app.astro`'s inline script reading the same storage before first paint. */
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
