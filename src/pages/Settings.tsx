import { useEffect, useMemo, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { createContentTypesApi } from "../content-types/http-api.js";
import { createContentEntriesApi, ContentEntriesApiError } from "../content-types/entries-http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import TextField from "../components/fields/TextField.js";
import NumberField from "../components/fields/NumberField.js";
import SelectField from "../components/fields/SelectField.js";
import ThemeToggle from "../components/ThemeToggle.js";
import { toast } from "../components/Toast.js";
import { canAccess } from "../store/auth.js";
import { reapplySystemTheme } from "../lib/apply-system-theme.js";
import ThemePreview from "./settings/ThemePreview.js";
import { useDocumentTitle } from "./page-common.js";

interface SystemSettingsValue extends Record<string, unknown> {
  primaryColor: string;
  secondaryColor: string;
  infoColor: string;
  successColor: string;
  warningColor: string;
  errorColor: string;
  backgroundColor: string;
  cardColor: string;
  textColor: string;
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

const SURFACE_COLOR_FIELDS: { key: keyof SystemSettingsValue; label: string; fallback: string }[] = [
  { key: "backgroundColor", label: "Page background", fallback: "#f9fafb" },
  { key: "cardColor", label: "Card background", fallback: "#ffffff" },
  { key: "textColor", label: "Text", fallback: "#1c252e" },
];

const ALL_COLOR_FIELDS = [...INTENT_COLOR_FIELDS, ...SURFACE_COLOR_FIELDS];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function readColor(raw: unknown, fallback: string): string {
  return typeof raw === "string" && HEX_RE.test(raw) ? raw : fallback;
}

function ColorField({
  colorKey,
  label,
  fallback,
  value,
  error,
  onChange,
}: {
  colorKey: keyof SystemSettingsValue;
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
 * `ThemePreview` (right column) reflects the CURRENT form `value`, not the
 * saved one - every keystroke here repaints it live, before Save ever runs,
 * via CSS custom properties alone (see that component's own doc comment for
 * why nothing here needs to touch the network to preview a color).
 */
export default function Settings() {
  useDocumentTitle("Settings");
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const entriesApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, "systemSettings"), []);
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [value, setValue] = useState<SystemSettingsValue | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canEdit = !!type && canAccess(type.id, "setting");
  const isDirty = initialSnapshot !== null && value !== null && JSON.stringify(value) !== initialSnapshot;

  useEffect(() => {
    void (async () => {
      try {
        const definitions = await typesApi.list();
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
        const loaded: SystemSettingsValue = {
          primaryColor: readColor(entry?.value.primaryColor, "#00a76f"),
          secondaryColor: readColor(entry?.value.secondaryColor, "#8e33ff"),
          infoColor: readColor(entry?.value.infoColor, "#00b8d9"),
          successColor: readColor(entry?.value.successColor, "#22c55e"),
          warningColor: readColor(entry?.value.warningColor, "#ffab00"),
          errorColor: readColor(entry?.value.errorColor, "#ff5630"),
          backgroundColor: readColor(entry?.value.backgroundColor, "#f9fafb"),
          cardColor: readColor(entry?.value.cardColor, "#ffffff"),
          textColor: readColor(entry?.value.textColor, "#1c252e"),
          fontFamily: typeof entry?.value.fontFamily === "string" && entry.value.fontFamily ? (entry.value.fontFamily as string) : FONT_OPTIONS[0]!,
          baseFontSize: typeof entry?.value.baseFontSize === "number" ? (entry.value.baseFontSize as number) : 16,
          radius: typeof entry?.value.radius === "number" ? (entry.value.radius as number) : 8,
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
    for (const { key, label } of ALL_COLOR_FIELDS) {
      if (!HEX_RE.test(value[key] as string)) errors[key] = `${label} must be a hex color like #00a76f.`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      await entriesApi.saveSingleton(value);
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
          <h1>Settings</h1>
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
        <section class="card">
          <header>
            <h2>Preview</h2>
            <p>Updates live as you edit - nothing here is saved until you click Save.</p>
          </header>
          <div class="under">
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
                  colorKey={key}
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
              <p>Page background, card background, and body text - applied the same in light and dark mode once set.</p>
            </header>
            <div class="under stack">
              {SURFACE_COLOR_FIELDS.map(({ key, label, fallback }) => (
                <ColorField
                  key={key}
                  colorKey={key}
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
