import type { JSX } from "preact";
import { MonitorIcon, MoonIcon, SunIcon, type IconProps } from "./icons/index.js";
import { theme as themeSignal } from "../store/theme.js";
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

/** A `.file-view-toggle` segmented control (`components.css`) offering the
 * three theme options directly, rather than a dropdown - full icon+text
 * buttons now that this lives on its own "Theme" section of the Settings
 * page (`pages/Settings.tsx`), not squeezed into the sidebar's account
 * popover menu anymore (moved out - a per-device preference someone
 * changes occasionally didn't deserve a permanent slot in a menu opened
 * constantly for Profile/Logout). Selection is persisted via `useStore`
 * (`drycms:store.theme` in `localStorage`) and applied via `theme.ts`'s
 * `applyTheme` - the same DOM logic a framework-free `[data-theme-toggle]`
 * button uses, so a page mixing both stays in sync either way. The
 * pre-mount flash is avoided separately, by `index.html`'s own inline
 * script reading the same storage before first paint.
 *
 * Persisted via `store/theme.ts`'s shared signal, not a local `useStore` -
 * `pages/settings/ThemePreview.tsx` reads the same signal to follow this
 * toggle live; two independent `useStore("theme", ...)` instances would
 * never see each other's writes (see that store's own doc comment). */
export default function ThemeToggle() {
  const theme = themeSignal.value;

  const choose = (value: DryTheme) => {
    themeSignal.value = value;
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
            class="ghost"
            aria-pressed={theme === value}
            onClick={() => choose(value)}
          >
            <Icon />
            {LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
