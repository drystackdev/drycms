import { effect, signal } from "@preact/signals";
import { readStoreValue, writeStoreValue } from "../hooks/useStore.js";
import type { DryTheme } from "../lib/native/theme.js";

const THEME_KEY = "theme";

/** Shared across `ThemeToggle` and `pages/settings/ThemePreview.tsx`, so
 * it's a signal rather than a per-component `useStore` (same reasoning as
 * `dashboard.ts`'s `collapsed`) - two independent `useStore("theme", ...)`
 * instances never see each other's writes (each only reads `localStorage`
 * once, at its own mount), which is exactly why the live preview didn't
 * follow the Theme toggle until this existed: `ThemeToggle` writing through
 * its own instance left `ThemePreview`'s own copy stale. Persisted into the
 * same `drycms:store` entry a `useStore("theme", ...)` would use. */
export const theme = signal<DryTheme>(readStoreValue<DryTheme>(THEME_KEY) ?? "system");

effect(() => {
  writeStoreValue(THEME_KEY, theme.value);
});
