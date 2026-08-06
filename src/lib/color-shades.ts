/**
 * Derives the 5-step Minimals-style shade ramp (`lighter`/`light`/`dark`/
 * `darker`/`foreground`) `tokens.css` expects per color intent from a
 * single admin-picked base hex - the System Settings page only ever asks
 * for ONE hex per intent (`systemSettings.primaryColor` etc., see
 * `content-types/seed.ts`), matching `tokens.css`'s existing per-intent
 * shape without asking for 5 separate pickers (see
 * `status/system-memory-and-settings.md` Part B - "auto-derive" was the
 * chosen tradeoff over letting an admin hand-pick every shade).
 *
 * Simple linear RGB mix toward white/black rather than an HSL round-trip -
 * close enough for a generated override, and avoids the hue drift plain HSL
 * lightening can introduce at the extremes.
 */

export interface ColorShades {
  lighter: string;
  light: string;
  base: string;
  dark: string;
  darker: string;
  /** `#ffffff` or a near-black, whichever reads better as text on top of
   * `base` (WCAG relative luminance) - matches `tokens.css`'s own
   * `-foreground` tokens (e.g. `--dry-warning-foreground` is dark, not
   * white, because warning's base color is light). */
  foreground: string;
}

type Rgb = [number, number, number];

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

function parseHex(hex: string): Rgb | null {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  const value = match[1]!;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("")}`;
}

function mix(rgb: Rgb, target: Rgb, amount: number): Rgb {
  return [
    rgb[0] + (target[0] - rgb[0]) * amount,
    rgb[1] + (target[1] - rgb[1]) * amount,
    rgb[2] + (target[2] - rgb[2]) * amount,
  ];
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** WCAG relative luminance - decides whether white or near-black text reads
 * better on top of `rgb`. */
function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** `null` for an invalid hex - callers fall back to the shipped `tokens.css`
 * default for that intent rather than emitting a broken override. */
export function deriveColorShades(baseHex: string): ColorShades | null {
  const rgb = parseHex(baseHex);
  if (!rgb) return null;
  return {
    lighter: toHex(mix(rgb, WHITE, 0.82)),
    light: toHex(mix(rgb, WHITE, 0.45)),
    base: toHex(rgb),
    dark: toHex(mix(rgb, BLACK, 0.25)),
    darker: toHex(mix(rgb, BLACK, 0.45)),
    foreground: relativeLuminance(rgb) > 0.5 ? "#1c252e" : "#ffffff",
  };
}
