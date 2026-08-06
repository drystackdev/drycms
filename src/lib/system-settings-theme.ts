/**
 * Pure - builds the `--dry-*` custom property overrides a `systemSettings`
 * value (`content-types/seed.ts`) implies. Shared by `server/routes/
 * system-settings.ts` (the server-rendered `.dry {...}` stylesheet, built
 * from the SAVED row) and `pages/settings/ThemePreview.tsx` (the live
 * showcase, built from whatever's currently typed into the form - not yet
 * saved) so the two can never drift apart; either one hand-duplicating this
 * mapping was exactly how the earlier version's shadow tokens went stale
 * (see `status/system-memory-and-settings.md`).
 */

import { isValidHexColor, pickForeground } from "./color-shades.js";

export interface SystemSettingsThemeInput {
  primaryColor?: unknown;
  secondaryColor?: unknown;
  infoColor?: unknown;
  successColor?: unknown;
  warningColor?: unknown;
  errorColor?: unknown;
  backgroundColorLight?: unknown;
  backgroundColorDark?: unknown;
  cardColorLight?: unknown;
  cardColorDark?: unknown;
  textColorLight?: unknown;
  textColorDark?: unknown;
  fontFamily?: unknown;
  baseFontSize?: unknown;
  radius?: unknown;
}

/** `field` -> `tokens.css` BASE token. `-lighter`/`-light`/`-dark`/`-darker`
 * are never listed here - they're `color-mix()` formulas in `tokens.css`
 * itself, derived automatically from whichever base value lands here (see
 * that file's own doc comment). `secondary`'s base token is
 * `--dry-secondary-main` (`tokens.css` itself is inconsistent about the
 * `-main` suffix, this just mirrors it); it has no independent
 * `-foreground` token to set (`--dry-secondary-foreground` is a different,
 * unrelated neutral-button-variant token - overriding it here would change
 * that instead of anything colour-ramp-related). */
const COLOR_INTENTS: { field: keyof SystemSettingsThemeInput; baseToken: string; foregroundToken?: string }[] = [
  { field: "primaryColor", baseToken: "--dry-primary", foregroundToken: "--dry-primary-foreground" },
  { field: "secondaryColor", baseToken: "--dry-secondary-main" },
  { field: "infoColor", baseToken: "--dry-info", foregroundToken: "--dry-info-foreground" },
  { field: "successColor", baseToken: "--dry-success", foregroundToken: "--dry-success-foreground" },
  { field: "warningColor", baseToken: "--dry-warning", foregroundToken: "--dry-warning-foreground" },
  { field: "errorColor", baseToken: "--dry-error", foregroundToken: "--dry-error-foreground" },
];

/** Unlike the intents above, a surface color is meaningless without BOTH a
 * light and a dark value - `--dry-background` etc are `light-dark(...)`
 * pairs in `tokens.css` precisely because the same flat color can't work
 * for both modes (a light grey background reads fine in light mode, wrong
 * in dark). Emitting only ONE color here regardless of theme is exactly the
 * bug this replaced: it silently broke dark mode across the whole admin the
 * moment `Settings.tsx` was saved even once, since it always writes every
 * field (see `status/system-memory-and-settings.md`). Both fields must be
 * valid for either to apply - a lone valid one with its pair missing/invalid
 * would otherwise flatten `light-dark()` to a single color again by
 * accident. `-card-foreground`/`-popover`/`-popover-foreground`/`-sidebar`
 * are plain `var(--dry-card)`/`var(--dry-foreground)` aliases in
 * `tokens.css`, so overriding just these two covers all six surface
 * tokens. */
const SURFACE_TOKENS: { lightField: keyof SystemSettingsThemeInput; darkField: keyof SystemSettingsThemeInput; token: string }[] = [
  { lightField: "backgroundColorLight", darkField: "backgroundColorDark", token: "--dry-background" },
  { lightField: "cardColorLight", darkField: "cardColorDark", token: "--dry-card" },
  { lightField: "textColorLight", darkField: "textColorDark", token: "--dry-foreground" },
];

/** Guards against a `systemSettings` row edited directly through the
 * generic entries API bypassing the `select` field's `options` list (the
 * DB column itself has no CHECK constraint - see `field-registry.ts`) from
 * breaking out of the `--dry-font-sans:` declaration this gets interpolated
 * into wherever it's rendered as raw CSS text. Colors never need this check -
 * `isValidHexColor` already constrains them to a charset that can't contain
 * any of these characters. */
function isSafeCssValue(value: string): boolean {
  return !/[{}<>;]/.test(value);
}

export function systemSettingsThemeVars(value: SystemSettingsThemeInput): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const { field, baseToken, foregroundToken } of COLOR_INTENTS) {
    const raw = value[field];
    if (typeof raw !== "string" || !isValidHexColor(raw)) continue;
    vars[baseToken] = raw;
    if (foregroundToken) {
      const foreground = pickForeground(raw);
      if (foreground) vars[foregroundToken] = foreground;
    }
  }

  for (const { lightField, darkField, token } of SURFACE_TOKENS) {
    const light = value[lightField];
    const dark = value[darkField];
    if (typeof light === "string" && isValidHexColor(light) && typeof dark === "string" && isValidHexColor(dark)) {
      vars[token] = `light-dark(${light}, ${dark})`;
    }
  }

  const fontFamily = value.fontFamily;
  if (typeof fontFamily === "string" && fontFamily.trim() && isSafeCssValue(fontFamily)) {
    vars["--dry-font-sans"] = fontFamily;
  }

  const baseFontSize = Number(value.baseFontSize);
  if (Number.isFinite(baseFontSize) && baseFontSize > 0) {
    vars["--dry-text-base"] = `${baseFontSize}px`;
    vars["--dry-text-sm"] = `${(baseFontSize * 0.875).toFixed(2)}px`;
    vars["--dry-text-xs"] = `${(baseFontSize * 0.75).toFixed(2)}px`;
  }

  const radius = Number(value.radius);
  if (Number.isFinite(radius) && radius >= 0) {
    vars["--dry-radius"] = `${radius}px`;
    vars["--dry-radius-sm"] = `${(radius * 0.75).toFixed(2)}px`;
    vars["--dry-radius-md"] = `${radius}px`;
    vars["--dry-radius-lg"] = `${(radius * 1.5).toFixed(2)}px`;
    vars["--dry-radius-xl"] = `${(radius * 2).toFixed(2)}px`;
  }

  return vars;
}

/** `systemSettings.data` is one JSON-serialized blob (`content-types/
 * seed.ts` - no per-field columns, nothing here is ever queried/filtered),
 * so both the server route and the client form need to parse it before
 * calling `systemSettingsThemeVars`. `{}` for anything that isn't valid
 * JSON or isn't an object - same "just fall back to shipped defaults, don't
 * throw" spirit as `routes/memory.ts`'s own `parseData`. */
export function parseSystemSettingsData(raw: unknown): SystemSettingsThemeInput {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SystemSettingsThemeInput) : {};
  } catch {
    return {};
  }
}
