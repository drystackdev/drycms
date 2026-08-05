import type { JSX } from "preact";
import { MonitorIcon, MoonIcon, SunIcon, type IconProps } from "./icons/index.js";
import { useStore } from "../hooks/useStore.js";
import { applyTheme, type DryTheme } from "../lib/native/theme.js";

const ORDER: DryTheme[] = ["system", "light", "dark"];

const LABELS: Record<DryTheme, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
};

const ICONS: Record<DryTheme, (props: IconProps) => JSX.Element> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};

/** A `.file-view-toggle` segmented control (`components.css`) offering the three
 * theme options directly, rather than a dropdown - it lives inside the
 * sidebar's own account popover (`DryLayout.tsx`), which is a menu already,
 * so nesting another one inside it would be a menu-in-a-menu. Selection is
 * persisted via `useStore` (`drycms:store.theme` in `localStorage`) and
 * applied via `theme.ts`'s `applyTheme` - the same DOM logic a
 * framework-free `[data-theme-toggle]` button uses, so a page mixing both
 * stays in sync either way. The pre-mount flash is avoided separately, by
 * `index.html`'s own inline script reading the same storage before first
 * paint. */
export default function ThemeToggle() {
  const [theme, setTheme] = useStore<DryTheme>("theme", "system");

  const choose = (value: DryTheme) => {
    setTheme(value);
    applyTheme(value);
  };

  return (
    <div class="file-view-toggle" role="group" aria-label="Theme">
      {ORDER.map((value) => {
        const Icon = ICONS[value];
        return (
          <button
            key={value}
            type="button"
            class="ghost sm"
            aria-pressed={theme === value}
            title={LABELS[value]}
            aria-label={LABELS[value]}
            onClick={() => choose(value)}
          >
            <Icon />
            <span>{value === "system" ? "System" : value === "light" ? "Light" : "Dark"}</span>
          </button>
        );
      })}
    </div>
  );
}
