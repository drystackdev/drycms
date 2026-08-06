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
  backgroundColor?: unknown;
  cardColor?: unknown;
  textColor?: unknown;
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

/** `-card-foreground`/`-popover`/`-popover-foreground`/`-sidebar` are plain
 * `var(--dry-card)`/`var(--dry-foreground)` aliases in `tokens.css` now, so
 * overriding just these two covers all six surface tokens. */
const SURFACE_TOKENS: { field: keyof SystemSettingsThemeInput; token: string }[] = [
  { field: "backgroundColor", token: "--dry-background" },
  { field: "cardColor", token: "--dry-card" },
  { field: "textColor", token: "--dry-foreground" },
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

  for (const { field, token } of SURFACE_TOKENS) {
    const raw = value[field];
    if (typeof raw === "string" && isValidHexColor(raw)) vars[token] = raw;
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
