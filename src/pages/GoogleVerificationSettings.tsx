import { useEffect, useMemo, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { createContentEntriesApi, ContentEntriesApiError } from "../content-types/entries-http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import TextField from "../components/fields/TextField.js";
import { toast } from "../components/Toast.js";
import { canAccess } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

interface GoogleVerificationValue extends Record<string, unknown> {
  name: string;
  content: string;
}

/**
 * The `googleVerification` singleton's admin page - 2 plain text fields
 * (`name`/`content`), no file upload involved. `google-verification.ts`
 * root-serves `content` verbatim at `/<name>` on every request, so saving
 * here is the whole setup for Google's HTML site-verification method.
 */
export default function GoogleVerificationSettings() {
  useDocumentTitle("Google Verification");
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const entriesApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, "googleVerification"), []);
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [value, setValue] = useState<GoogleVerificationValue | null>(null);
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
        // mid-edit could silently discard unsaved changes.
        const definitions = await listCached(typesApi);
        const found = definitions.find((candidate) => candidate.name === "googleVerification");
        if (!found) throw new Error('The system collection "googleVerification" is not available.');
        setType(found);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load Google Verification settings.");
      }
    })();
  }, [typesApi]);

  useEffect(() => {
    if (!type) return;
    void (async () => {
      try {
        const entry = await entriesApi.getSingleton();
        const loaded: GoogleVerificationValue = {
          name: typeof entry?.value.name === "string" ? entry.value.name : "",
          content: typeof entry?.value.content === "string" ? entry.value.content : "",
        };
        setValue(loaded);
        setInitialSnapshot(JSON.stringify(loaded));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load Google Verification settings.");
      }
    })();
  }, [type, entriesApi]);

  function update<K extends keyof GoogleVerificationValue>(key: K, next: GoogleVerificationValue[K]) {
    setValue((current) => (current ? { ...current, [key]: next } : current));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }

  async function save() {
    if (!value) return;
    setSaving(true);
    try {
      await entriesApi.saveSingleton(value);
      setInitialSnapshot(JSON.stringify(value));
      toast.add({ type: "success", title: "Google Verification saved." });
    } catch (error) {
      if (error instanceof ContentEntriesApiError && error.fieldErrors) setFieldErrors(error.fieldErrors);
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  if (!type || !value) return <span class="hint">Loading…</span>;
  if (!canEdit) return <span class="error">You don't have permission to manage Google Verification.</span>;

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Google Verification</h1>
          <p>Serves Google's site-ownership verification content at your domain root - no file upload needed.</p>
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
          <h2>Verification</h2>
          <p>
            From Google Search Console's HTML tag verification method: copy the filename and content it gives you into the two fields below.
            {value.name && (
              <>
                {" "}
                Once saved, it's served at <code>{`https://yourdomain.com/${value.name}`}</code>.
              </>
            )}
          </p>
        </header>
        <div class="under stack">
          <TextField
            label="Name"
            required
            placeholder="google1234567890abcdef.html"
            value={value.name}
            error={!!fieldErrors.name}
            helperText={fieldErrors.name}
            onChange={(next) => update("name", next)}
          />
          <TextField
            label="Content"
            required
            multiline
            placeholder="google-site-verification: google1234567890abcdef.html"
            value={value.content}
            error={!!fieldErrors.content}
            helperText={fieldErrors.content}
            onChange={(next) => update("content", next)}
          />
        </div>
      </section>
    </>
  );
}
