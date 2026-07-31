import type { JSX } from "preact";
import { MonitorIcon, MoonIcon, SunIcon, type IconProps } from "./icons.js";
import Popover from "./Popover.js";
import { useStore } from "../hooks/useStore.js";
import { applyTheme, type DryTheme } from "./theme.js";

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

/** A popover offering the three theme options - like align-menu.tsx, the
 * trigger shows whichever option is currently active rather than a fixed
 * icon. Selection is persisted via `useStore` (`drycms:store.theme` in
 * `localStorage`) and applied via `theme.ts`'s `applyTheme` - the same DOM
 * logic a framework-free `[data-theme-toggle]` button uses, so a page mixing
 * both stays in sync either way. The pre-mount flash is avoided separately,
 * by `index.html`'s own inline script reading the same storage before first
 * paint. */
export default function ThemeToggle() {
  const [theme, setTheme] = useStore<DryTheme>("theme", "system");

  const choose = (value: DryTheme) => {
    setTheme(value);
    applyTheme(value);
  };

  const CurrentIcon = ICONS[theme];

  return (
    <Popover
      label="Theme"
      tooltip="Theme"
      items={ORDER.map((value) => {
        const Icon = ICONS[value];
        return {
          type: "item" as const,
          label: LABELS[value],
          icon: <Icon />,
          onClick: () => choose(value),
        };
      })}
      trigger={(onClick) => (
        <button
          type="button"
          class="ghost icon"
          onClick={onClick}
          title={LABELS[theme]}
          aria-label={LABELS[theme]}
        >
          <CurrentIcon />
        </button>
      )}
    />
  );
}
