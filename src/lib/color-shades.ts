/**
 * `-foreground` (which text color reads better on top of a base intent
 * color) is the one piece of `tokens.css`'s per-intent ramp `color-mix()`
 * can't derive on its own - it's a WCAG contrast decision, not a blend, so
 * it stays computed here and sent alongside the base color by
 * `routes/system-settings.ts`. Every OTHER shade (`-lighter`/`-light`/
 * `-dark`/`-darker`) is now a pure `color-mix(in srgb, var(--dry-primary)
 * ...)` formula living directly in `tokens.css` - overriding just the base
 * token is enough, nothing else to compute or keep in sync here (see
 * `status/system-memory-and-settings.md`).
 */

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

function parseHex(hex: string): [number, number, number] | null {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  const value = match[1]!;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/** WCAG relative luminance - decides whether white or near-black text reads
 * better on top of `hex`. `null` input (already-invalid hex) reads as dark
 * (`false`), same as `relativeLuminance([0,0,0])` would. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** `#ffffff` or a near-black (`tokens.css`'s own `--dry-warning-foreground`
 * default), whichever contrasts better against `hex`. `null` for an invalid
 * hex - callers fall back to the shipped `tokens.css` default instead of
 * emitting a broken override. */
export function pickForeground(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return relativeLuminance(rgb) > 0.5 ? "#1c252e" : "#ffffff";
}
