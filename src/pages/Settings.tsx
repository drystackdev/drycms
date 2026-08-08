import { useEffect, useMemo, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { createContentEntriesApi, ContentEntriesApiError } from "../content-types/entries-http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import TextField from "../components/fields/TextField.js";
import NumberField from "../components/fields/NumberField.js";
import SelectField from "../components/fields/SelectField.js";
import ThemeToggle from "../components/ThemeToggle.js";
import { toast } from "../components/Toast.js";
import { canAccess } from "../store/auth.js";
import { reapplySystemTheme } from "../lib/apply-system-theme.js";
import { parseSystemSettingsData } from "../lib/system-settings-theme.js";
import ThemePreview from "./settings/ThemePreview.js";
import { useDocumentTitle } from "./page-common.js";

interface SystemSettingsValue extends Record<string, unknown> {
  primaryColor: string;
  secondaryColor: string;
  infoColor: string;
  successColor: string;
  warningColor: string;
  errorColor: string;
  backgroundColorLight: string;
  backgroundColorDark: string;
  cardColorLight: string;
  cardColorDark: string;
  textColorLight: string;
  textColorDark: string;
  fontFamily: string;
  baseFontSize: number;
  radius: number;
}

// Mirrors `content-types/seed.ts`'s `systemSettings.fontFamily` select
// options - kept as a literal copy rather than fetched from `type.fields`
// so this form doesn't need to resolve them at render time; the schema
// itself stays the source of truth for what the server accepts.
const FONT_OPTIONS = [
  "DM Sans Variable, DM Sans, ui-sans-serif, system-ui, sans-serif",
  "Inter, ui-sans-serif, system-ui, sans-serif",
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  "ui-serif, Georgia, Cambria, Times New Roman, serif",
  "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace",
];

const INTENT_COLOR_FIELDS: { key: keyof SystemSettingsValue; label: string; fallback: string }[] = [
  { key: "primaryColor", label: "Primary", fallback: "#00a76f" },
  { key: "secondaryColor", label: "Secondary", fallback: "#8e33ff" },
  { key: "infoColor", label: "Info", fallback: "#00b8d9" },
  { key: "successColor", label: "Success", fallback: "#22c55e" },
  { key: "warningColor", label: "Warning", fallback: "#ffab00" },
  { key: "errorColor", label: "Error", fallback: "#ff5630" },
];

/** Unlike the 6 intents above, a surface color needs a light AND a dark
 * value - a single flat override broke dark mode across the whole admin the
 * moment this page was saved even once (`Settings.tsx` always writes every
 * field, so the moment ANY save happened, `--dry-background` etc got pinned
 * to their light-mode default forever - see `status/
 * system-memory-and-settings.md`'s "dark mode sai màu" entry). */
const SURFACE_COLOR_PAIRS: { label: string; lightKey: keyof SystemSettingsValue; darkKey: keyof SystemSettingsValue; lightFallback: string; darkFallback: string }[] = [
  { label: "Page background", lightKey: "backgroundColorLight", darkKey: "backgroundColorDark", lightFallback: "#f9fafb", darkFallback: "#141a21" },
  { label: "Card background", lightKey: "cardColorLight", darkKey: "cardColorDark", lightFallback: "#ffffff", darkFallback: "#1c252e" },
  { label: "Text", lightKey: "textColorLight", darkKey: "textColorDark", lightFallback: "#1c252e", darkFallback: "#ffffff" },
];

const ALL_COLOR_KEYS: (keyof SystemSettingsValue)[] = [
  ...INTENT_COLOR_FIELDS.map((f) => f.key),
  ...SURFACE_COLOR_PAIRS.flatMap((p) => [p.lightKey, p.darkKey]),
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function readColor(raw: unknown, fallback: string): string {
  return typeof raw === "string" && HEX_RE.test(raw) ? raw : fallback;
}

function ColorField({
  label,
  fallback,
  value,
  error,
  onChange,
}: {
  label: string;
  fallback: string;
  value: string;
  error?: string;
  onChange: (next: string) => void;
}) {
  return (
    <div class="row align-center" style={{ gap: "0.75rem" }}>
      <input
        type="color"
        value={HEX_RE.test(value) ? value : fallback}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
        aria-label={`${label} color swatch`}
        style={{ width: "2.5rem", height: "2.5rem", padding: 0, border: "none", background: "none", flexShrink: 0 }}
      />
      <TextField
        label={label}
        value={value}
        onChange={onChange}
        placeholder={fallback}
        error={!!error}
        helperText={error}
        style={{ flex: 1 }}
      />
    </div>
  );
}

function SurfaceColorPairField({
  pair,
  value,
  fieldErrors,
  onChange,
}: {
  pair: (typeof SURFACE_COLOR_PAIRS)[number];
  value: SystemSettingsValue;
  fieldErrors: Record<string, string>;
  onChange: <K extends keyof SystemSettingsValue>(key: K, next: SystemSettingsValue[K]) => void;
}) {
  return (
    <div class="stack" style={{ gap: "0.5rem" }}>
      <strong>{pair.label}</strong>
      <ColorField
        label="Light"
        fallback={pair.lightFallback}
        value={value[pair.lightKey] as string}
        error={fieldErrors[pair.lightKey]}
        onChange={(next) => onChange(pair.lightKey, next)}
      />
      <ColorField
        label="Dark"
        fallback={pair.darkFallback}
        value={value[pair.darkKey] as string}
        error={fieldErrors[pair.darkKey]}
        onChange={(next) => onChange(pair.darkKey, next)}
      />
    </div>
  );
}

/**
 * Super Admin-only admin UI theme editor - a custom color-picker/live-preview
 * form (not the generic singleton field-loop editor `seoDefaults`/`about`
 * use) over the `systemSettings` singleton (see `content-types/seed.ts`).
 * Reached via its own pinned "Settings" nav entry (`DryLayout.tsx`, System
 * section) since the type is `hidden`. Saving here writes through the
 * ordinary `systemSettings` entries API (`getSingleton`/`saveSingleton`) -
 * `routes/system-settings.ts`'s `GET .../theme.css` is what actually
 * applies it for every user, linked into every admin page by
 * `lib/apply-system-theme.ts`; `reapplySystemTheme()` below refreshes THIS
 * tab immediately after a successful save.
 *
 * `ThemePreview` (left column, `.settings-preview-sticky` - sticks below the
 * topbar on desktop, see `components.css`) reflects the CURRENT form
 * `value`, not the saved one - every keystroke here repaints it live,
 * before Save ever runs, via CSS custom properties alone (see that
 * component's own doc comment for why nothing here needs to touch the
 * network to preview a color).
 */
export default function Settings() {
  useDocumentTitle("Color schema");
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const entriesApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, "systemSettings"), []);
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [value, setValue] = useState<SystemSettingsValue | null>(null);
  // Everything else already in `data` (e.g. `PageBuild.tsx`'s
  // `scheduleFlipIntervalMinutes`) - `save()` below spreads `value` ONTO
  // this rather than replacing `data` outright, so saving a color can never
  // silently wipe a setting this page doesn't know about. Captured once at
  // load time, not re-read on every save, matching this page's existing
  // "no autosave, in-memory edits only until Save" contract.
  const [otherStoredData, setOtherStoredData] = useState<Record<string, unknown>>({});
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canEdit = !!type && canAccess(type.id, "setting");
  const isDirty = initialSnapshot !== null && value !== null && JSON.stringify(value) !== initialSnapshot;

  useEffect(() => {
    void (async () => {
      try {
        // Cache-aware, not `typesApi.list()` - shares the same IndexedDB
        // entry `DryLayout`/`BuilderContentType` keep warm via `useFetch`.
        // A plain `useFetch()` isn't used here since `value` below has no
        // autosave - a background revalidation re-running the load effect
        // mid-edit could silently discard unsaved color changes.
        const definitions = await listCached(typesApi);
        const found = definitions.find((candidate) => candidate.name === "systemSettings");
        if (!found) throw new Error('The system collection "systemSettings" is not available.');
        setType(found);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load settings.");
      }
    })();
  }, [typesApi]);

  useEffect(() => {
    if (!type) return;
    void (async () => {
      try {
        const entry = await entriesApi.getSingleton();
        // `systemSettings.data` is one JSON blob (`content-types/seed.ts`),
        // not per-field columns - nothing here is ever queried/filtered, so
        // splitting it into 12+ real columns would only have added
        // schema-editor noise for every new setting (same reasoning
        // `memory.data` already uses).
        const stored = parseSystemSettingsData(entry?.value.data);
        setOtherStoredData(stored as Record<string, unknown>);
        const loaded: SystemSettingsValue = {
          primaryColor: readColor(stored.primaryColor, "#00a76f"),
          secondaryColor: readColor(stored.secondaryColor, "#8e33ff"),
          infoColor: readColor(stored.infoColor, "#00b8d9"),
          successColor: readColor(stored.successColor, "#22c55e"),
          warningColor: readColor(stored.warningColor, "#ffab00"),
          errorColor: readColor(stored.errorColor, "#ff5630"),
          backgroundColorLight: readColor(stored.backgroundColorLight, "#f9fafb"),
          backgroundColorDark: readColor(stored.backgroundColorDark, "#141a21"),
          cardColorLight: readColor(stored.cardColorLight, "#ffffff"),
          cardColorDark: readColor(stored.cardColorDark, "#1c252e"),
          textColorLight: readColor(stored.textColorLight, "#1c252e"),
          textColorDark: readColor(stored.textColorDark, "#ffffff"),
          fontFamily: typeof stored.fontFamily === "string" && stored.fontFamily ? stored.fontFamily : FONT_OPTIONS[0]!,
          baseFontSize: typeof stored.baseFontSize === "number" ? stored.baseFontSize : 16,
          radius: typeof stored.radius === "number" ? stored.radius : 8,
        };
        setValue(loaded);
        setInitialSnapshot(JSON.stringify(loaded));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load settings.");
      }
    })();
  }, [type, entriesApi]);

  function update<K extends keyof SystemSettingsValue>(key: K, next: SystemSettingsValue[K]) {
    setValue((current) => (current ? { ...current, [key]: next } : current));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }

  async function save() {
    if (!value) return;
    const errors: Record<string, string> = {};
    for (const key of ALL_COLOR_KEYS) {
      if (!HEX_RE.test(value[key] as string)) errors[key] = "Must be a hex color like #00a76f.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      // Spread onto `otherStoredData`, not `value` alone - see that
      // state's own doc comment. `value`'s keys always win over whatever
      // was loaded, since this page IS the source of truth for each of
      // them.
      await entriesApi.saveSingleton({ data: JSON.stringify({ ...otherStoredData, ...value }) });
      setInitialSnapshot(JSON.stringify(value));
      // The rendered stylesheet (`routes/system-settings.ts`) only refetches
      // on its own at the next full page load - without this, THIS tab
      // would keep showing the old colors until manually reloaded, even
      // though the save itself succeeded (the bug reported after shipping
      // v1 - see `status/system-memory-and-settings.md`).
      reapplySystemTheme();
      toast.add({ type: "success", title: "Settings saved." });
    } catch (error) {
      if (error instanceof ContentEntriesApiError && error.fieldErrors) setFieldErrors(error.fieldErrors);
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  if (!type || !value) return <span class="hint">Loading…</span>;
  if (!canEdit) return <span class="error">You don't have permission to manage System Settings.</span>;

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Color schema</h1>
          <p>Admin UI theme - colors and typography, shared by every user.</p>
        </div>
        <div class="row">
          {isDirty && (
            <button type="button" disabled={saving} aria-busy={saving || undefined} onClick={save}>
              Save
            </button>
          )}
        </div>
      </div>

      <section class="card">
        <header>
          <h2>Theme</h2>
          <p>Light, dark, or follow the system - this is a per-device preference, not shared with other users. The preview below follows it too.</p>
        </header>
        <div class="under">
          <ThemeToggle />
        </div>
      </section>

      <div class="content-entry-editor-grid">
        <section class="card settings-preview-sticky">
          <header>
            <h2>Preview</h2>
            <p>Updates live as you edit - nothing here is saved until you click Save.</p>
          </header>
          <div>
            <ThemePreview value={value} />
          </div>
        </section>

        <div class="stack">
          <section class="card">
            <header>
              <h2>Brand colors</h2>
              <p>Each is a single base hex - lighter/dark shades are derived automatically. Shared with every user.</p>
            </header>
            <div class="under stack">
              {INTENT_COLOR_FIELDS.map(({ key, label, fallback }) => (
                <ColorField
                  key={key}
                  label={label}
                  fallback={fallback}
                  value={value[key] as string}
                  error={fieldErrors[key]}
                  onChange={(next) => update(key, next)}
                />
              ))}
            </div>
          </section>

          <section class="card">
            <header>
              <h2>Surface colors</h2>
              <p>Page background, card background, and body text - a light AND a dark value each, so dark mode stays correct.</p>
            </header>
            <div class="under stack">
              {SURFACE_COLOR_PAIRS.map((pair) => (
                <SurfaceColorPairField key={pair.label} pair={pair} value={value} fieldErrors={fieldErrors} onChange={update} />
              ))}
            </div>
          </section>

          <section class="card">
            <header>
              <h2>Typography &amp; shape</h2>
            </header>
            <div class="under stack">
              <SelectField
                label="Font family"
                config={{ options: FONT_OPTIONS, multiple: false }}
                value={value.fontFamily}
                onChange={(next) => update("fontFamily", String(next))}
              />
              <NumberField
                label="Base font size (px)"
                value={value.baseFontSize}
                min={12}
                max={20}
                onChange={(next) => update("baseFontSize", next)}
              />
              <NumberField
                label="Corner radius (px)"
                value={value.radius}
                min={0}
                max={24}
                onChange={(next) => update("radius", next)}
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
