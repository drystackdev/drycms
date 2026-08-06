import { useEffect, useRef } from "preact/hooks";
// `?inline` (a Vite built-in, see `vite/client`'s ambient types) resolves
// every `@import` in `index.css` (tokens/base/scrollbar/forms/components/
// utilities/code) into one self-contained string at build time, rather than
// injecting it into the page - exactly what a shadow root needs to render
// real, pixel-accurate components without hand-duplicating any of it (the
// approach `content-shadow-styles.ts` uses for RichText's editable surface,
// but that one's CSS is a small, hand-written subset; this needs the WHOLE
// admin stylesheet, so generating it from the real source beats copying).
import adminCss from "../../styles/index.css?inline";
import { theme as themeSignal } from "../../store/theme.js";
import type { DryTheme } from "../../lib/native/theme.js";
import { systemSettingsThemeVars, type SystemSettingsThemeInput } from "../../lib/system-settings-theme.js";

function resolveEffectiveTheme(theme: DryTheme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Static markup, not a live Preact tree - this is a non-interactive
 * showcase (clicking "Save" here shouldn't do anything), so plain HTML
 * sidesteps rendering a whole second component tree into a shadow root for
 * no behavioral benefit. One instance of every element whose color actually
 * depends on a `systemSettings` token - button variants (including `.soft`,
 * which itself blends `--dry-primary` via `color-mix()` - see
 * `components.css`), badges, alerts, and a card with a form field, so every
 * `color-mix()`/`var()` chain in `tokens.css` gets exercised somewhere. */
const SHOWCASE_HTML = `
  <div class="stack" style="gap:1.25rem;padding:1.25rem;">
    <div class="row" style="gap:0.5rem;flex-wrap:wrap;">
      <button type="button">Primary</button>
      <button type="button" class="secondary">Secondary</button>
      <button type="button" class="outline">Outline</button>
      <button type="button" class="ghost">Ghost</button>
      <button type="button" class="soft">Soft</button>
      <button type="button" class="destructive">Destructive</button>
      <button type="button" class="info">Info</button>
      <button type="button" class="success">Success</button>
      <button type="button" class="warning">Warning</button>
    </div>
    <div class="row" style="gap:0.5rem;flex-wrap:wrap;align-items:center;">
      <span class="badge">Default</span>
      <span class="badge secondary">Secondary</span>
      <span class="badge outline">Outline</span>
      <span class="badge filled">Filled</span>
      <span class="badge destructive">Destructive</span>
      <span class="badge info">Info</span>
      <span class="badge success">Success</span>
      <span class="badge warning">Warning</span>
    </div>
    <div class="stack" style="gap:0.5rem;">
      <div class="alert">
        <h4>Heads up</h4>
        <p>An info alert, tinted from the current Info color.</p>
      </div>
      <div class="alert destructive">
        <h4>Something went wrong</h4>
        <p>A destructive alert, tinted from the current Error color.</p>
      </div>
      <div class="alert success">
        <h4>Saved</h4>
        <p>A success alert, tinted from the current Success color.</p>
      </div>
    </div>
    <section class="card">
      <header>
        <h2>Card title</h2>
        <p>Uses the page background, card, and text colors.</p>
      </header>
      <div class="field">
        <label>Text field</label>
        <input type="text" value="Sample value" readonly />
      </div>
      <p>Body text with <a href="#" onclick="return false;">a link</a> and <strong>bold text</strong>.</p>
      <footer>
        <button type="button">Save</button>
        <button type="button" class="outline">Cancel</button>
      </footer>
    </section>
  </div>
`;

export interface ThemePreviewProps {
  /** The form's CURRENT, possibly-unsaved values - not `entriesApi`'s saved
   * copy. Fed through the same `systemSettingsThemeVars` the server route
   * uses (see that module's own doc comment), so a color typed into the
   * form appears here on every keystroke, before Save ever runs. */
  value: SystemSettingsThemeInput;
}

/**
 * Live showcase of common elements (buttons/badges/alerts/a card+field),
 * shadow-isolated so it renders with the REAL admin stylesheet (not a
 * hand-approximated subset) without leaking into, or being affected by, the
 * actual page around it - see `adminCss`'s own doc comment for why a whole-
 * stylesheet shadow root beats copying select rules. Mounts the stylesheet
 * and markup once; every `value`/theme change after that just updates CSS
 * custom properties on the shadow-internal `.dry` wrapper - `tokens.css`'s
 * own `color-mix()`/`var()` chains do the actual repainting, nothing here
 * re-renders or re-injects CSS text on every keystroke.
 */
export default function ThemePreview({ value }: ThemePreviewProps) {
  // Reads the shared signal directly (not `useStore`) so a change made
  // through `ThemeToggle` - a sibling component, its own instance of the
  // same signal - re-renders this one too. Accessing `.value` here, in the
  // component body, is what makes Preact's signals integration subscribe to
  // it in the first place, same as `collapsed.value` in `DryLayout.tsx`.
  const theme = themeSignal.value;
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.replaceChildren();
    const style = document.createElement("style");
    style.textContent = adminCss;
    const wrapper = document.createElement("div");
    wrapper.className = "dry";
    wrapper.innerHTML = SHOWCASE_HTML;
    shadow.append(style, wrapper);
    wrapperRef.current = wrapper;
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const effective = resolveEffectiveTheme(theme);
    wrapper.classList.toggle("light", effective === "light");
    wrapper.classList.toggle("dark", effective === "dark");
  }, [theme]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    for (const [token, cssValue] of Object.entries(systemSettingsThemeVars(value))) {
      wrapper.style.setProperty(token, cssValue);
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      style={{ border: "1px solid var(--dry-border)", borderRadius: "var(--dry-radius-lg)", overflow: "hidden" }}
    />
  );
}
