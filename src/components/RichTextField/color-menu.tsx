import { runCommand, setTextColor } from "./commands.js";
import Popover from "../Popover.js";
import { BaselineIcon } from "../icons.js";
import type { ToolbarCustomProps } from "./types.js";

/** 6 base hues, picked around the wheel so adjacent columns stay visually
 * distinct at every lightness level below. */
const COLOR_HUES: { name: string; hue: number }[] = [
  { name: "Red", hue: 0 },
  { name: "Orange", hue: 28 },
  { name: "Yellow", hue: 48 },
  { name: "Green", hue: 142 },
  { name: "Blue", hue: 210 },
  { name: "Purple", hue: 280 },
];

/** 6 lightness stops, light to dark, shared by every hue above. */
const COLOR_LEVELS: number[] = [82, 68, 54, 42, 32, 20];

/** 6 opacity presets applied to whichever base color is active - see
 * `parseColorValue` for how a preset combines with a chosen hue. */
const OPACITY_STEPS: number[] = [100, 80, 60, 40, 20, 10];

/** Hex, not `hsl()`, so the exported `<span style="color: ...">` (and every
 * document that stores one) stays as small as possible - `#rrggbb` beats
 * `hsl(h s% l%)` and, combined with `alphaHex` below, `#rrggbbaa` beats
 * `color-mix(in srgb, ... , transparent)` by a much wider margin. Standard
 * CSS Color 4 hsl->rgb conversion. */
function hslToHex(hue: number, saturationPct: number, lightnessPct: number): string {
  const s = saturationPct / 100;
  const l = lightnessPct / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const toHex = (n: number) =>
    Math.round(f(n) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

function swatchValue(hue: number, lightness: number): string {
  return hslToHex(hue, 72, lightness);
}

/** 2-digit hex alpha suffix for `#rrggbb` + `alphaHex` = `#rrggbbaa`. */
function alphaHex(pct: number): string {
  return Math.round((pct / 100) * 255)
    .toString(16)
    .padStart(2, "0");
}

const HEX8_RE = /^#([0-9a-f]{6})([0-9a-f]{2})$/i;

/** The one base form `alphaHex` can legally be concatenated onto. Anything
 * else - `currentColor`, a named color, or an `rgb()`/`rgba()` string left
 * in a document saved before `html.ts` stopped letting CSSOM normalize the
 * imported `color` away (see `rawInlineColor` there) - would build a
 * nonsense value like `rgb(200, 30, 30)cc` that the browser drops outright,
 * silently losing the color instead of dimming it, so the opacity row stays
 * disabled for those and only the swatch grid applies. */
const HEX6_RE = /^#[0-9a-f]{6}$/i;

/** The inverse of the `#rrggbb`/`#rrggbbaa` strings `applyColor` below
 * writes - reconstructs "which hue + which opacity" from whatever
 * `ToolbarState.color` currently reports, so reopening the popover (or
 * switching only one of the two controls) reflects the live selection
 * instead of resetting. Unset/unrecognized values (including pre-existing
 * documents saved before this field wrote hex) fall back to `currentColor`
 * at full opacity, i.e. "no explicit color chosen yet" - opacity has
 * nothing concrete to combine with until a swatch is picked, see the
 * opacity row's `disabled` below. */
function parseColorValue(value: string): { base: string; alphaPct: number } {
  const trimmed = value.trim();
  if (!trimmed) return { base: "currentColor", alphaPct: 100 };
  const hex8 = HEX8_RE.exec(trimmed);
  if (hex8) return { base: `#${hex8[1]}`, alphaPct: Math.round((parseInt(hex8[2]!, 16) / 255) * 100) };
  return { base: trimmed, alphaPct: 100 };
}

/**
 * A popover offering a 6-hue x 6-level color grid plus a 6-step opacity row,
 * both writing into the selection via the `textColor` mark (`commands.ts`'s
 * `setTextColor`) rather than a plain toggle - `useRichTextEditor.ts` reads
 * it back with `getTextColorState` and `html.ts` round-trips it through an
 * exported `<span style="color: ...">`.
 */
export default function ColorMenu({ viewRef, state, disabled = false, iconSize }: ToolbarCustomProps) {
  const { base, alphaPct } = parseColorValue(state.color);

  const preserveSelection = (event: MouseEvent) => event.preventDefault();

  const applyColor = (nextBase: string, nextAlphaPct: number) => {
    const view = viewRef.current;
    if (!view) return;
    const value =
      nextAlphaPct >= 100 || !HEX6_RE.test(nextBase) ? nextBase : `${nextBase}${alphaHex(nextAlphaPct)}`;
    runCommand(view, setTextColor(value));
  };

  const clearColor = () => {
    const view = viewRef.current;
    if (!view) return;
    runCommand(view, setTextColor(null));
  };

  return (
    <Popover
      label="Text color"
      tooltip="Text color"
      trigger={(onClick) => (
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Text color"
          data-tooltip="Text color"
          disabled={disabled || !state.inlineEditable || !state.hasSelection}
          onMouseDown={preserveSelection}
          onClick={onClick}
          style={state.color ? `color: ${state.color}` : undefined}
        >
          <BaselineIcon />
        </button>
      )}
    >
      <li role="none">
        <div class="color-swatch-grid" role="group" aria-label="Colors">
          {COLOR_HUES.map((hue) => (
            <div class="color-swatch-column" key={hue.name}>
              {COLOR_LEVELS.map((level) => {
                const value = swatchValue(hue.hue, level);
                return (
                  <button
                    type="button"
                    key={level}
                    class="color-swatch"
                    style={`background: ${value}`}
                    aria-label={`${hue.name} ${level}`}
                    aria-pressed={base === value}
                    onMouseDown={preserveSelection}
                    onClick={() => applyColor(value, alphaPct)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </li>
      <li role="none">
        <div class="color-opacity-row" role="group" aria-label="Opacity">
          {OPACITY_STEPS.map((pct) => (
            <button
              type="button"
              key={pct}
              class="color-opacity-swatch"
              aria-label={`${pct}% opacity`}
              data-tooltip={HEX6_RE.test(base) ? `${pct}% opacity` : "Pick a color first"}
              aria-pressed={alphaPct === pct}
              disabled={!HEX6_RE.test(base)}
              onMouseDown={preserveSelection}
              onClick={() => applyColor(base, pct)}
            >
              <span style={`background: ${pct >= 100 || !HEX6_RE.test(base) ? base : `${base}${alphaHex(pct)}`}`} />
            </button>
          ))}
        </div>
      </li>
      <li class="popover-menu-separator" role="separator" />
      <li role="none">
        <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={clearColor}>
          Default color
        </button>
      </li>
    </Popover>
  );
}
