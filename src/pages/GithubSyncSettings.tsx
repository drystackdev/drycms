import { useEffect, useMemo, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { createContentEntriesApi, ContentEntriesApiError } from "../content-types/entries-http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import TextField from "../components/fields/TextField.js";
import SecretKeyField from "../components/fields/SecretKeyField.js";
import CheckField from "../components/fields/CheckField.js";
import { toast } from "../components/Toast.js";
import { canAccess } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

interface GithubSyncValue extends Record<string, unknown> {
  enabled: boolean;
  repo: string;
  branch: string;
  token: string;
}

/**
 * The `githubSync` singleton's admin page (`status/pages-source-github-versioning.md`) -
 * repo/branch/token for `routes/pages-source-github-sync.ts`'s snapshot
 * push, triggered from `PageEditor.tsx`/`PageBuild.tsx`'s Build actions.
 * `token` is `secretkey` (write-only, same "blank keeps the stored secret"
 * contract `AiKeyEditor.tsx` already established for its own `key` field) -
 * this page never receives the decrypted token back, only whether one is
 * already stored.
 */
export default function GithubSyncSettings() {
  useDocumentTitle("GitHub Sync");
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const entriesApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, "githubSync"), []);
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [value, setValue] = useState<GithubSyncValue | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canEdit = !!type && canAccess(type.id, "setting");
  const isDirty = initialSnapshot !== null && value !== null && JSON.stringify(value) !== initialSnapshot;

  useEffect(() => {
    void (async () => {
      try {
        // Cache-aware, not `typesApi.list()` - same reasoning as
        // `GoogleVerificationSettings.tsx`'s own load effect: `value` below
        // has no autosave, so a background revalidation replaying this
        // effect mid-edit could silently discard unsaved changes.
        const definitions = await listCached(typesApi);
        const found = definitions.find((candidate) => candidate.name === "githubSync");
        if (!found) throw new Error('The system collection "githubSync" is not available.');
        setType(found);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load GitHub Sync settings.");
      }
    })();
  }, [typesApi]);

  useEffect(() => {
    if (!type) return;
    void (async () => {
      try {
        const entry = await entriesApi.getSingleton();
        const secret = entry?.value.token;
        const loaded: GithubSyncValue = {
          enabled: entry?.value.enabled === true,
          repo: typeof entry?.value.repo === "string" ? entry.value.repo : "",
          branch: typeof entry?.value.branch === "string" ? entry.value.branch : "",
          token: "",
        };
        setHasExistingToken(typeof secret === "object" && secret !== null && "hasExisting" in secret);
        setValue(loaded);
        setInitialSnapshot(JSON.stringify(loaded));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load GitHub Sync settings.");
      }
    })();
  }, [type, entriesApi]);

  function update<K extends keyof GithubSyncValue>(key: K, next: GithubSyncValue[K]) {
    setValue((current) => (current ? { ...current, [key]: next } : current));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }

  async function save() {
    if (!value) return;
    setSaving(true);
    try {
      // Same "blank secretkey input on an existing entry keeps the stored
      // ciphertext" contract `AiKeyEditor.tsx`'s own save uses.
      const payload = value.token.trim() || !hasExistingToken ? value : { ...value, token: { hasExisting: true } };
      await entriesApi.saveSingleton(payload);
      setValue({ ...value, token: "" });
      setInitialSnapshot(JSON.stringify({ ...value, token: "" }));
      setHasExistingToken(hasExistingToken || !!value.token.trim());
      toast.add({ type: "success", title: "GitHub Sync saved." });
    } catch (error) {
      if (error instanceof ContentEntriesApiError && error.fieldErrors) setFieldErrors(error.fieldErrors);
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  if (!type || !value) return <span class="hint">Loading…</span>;
  if (!canEdit) return <span class="error">You don't have permission to manage GitHub Sync.</span>;

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>GitHub Sync</h1>
          <p>Pushes a snapshot commit of your pages-source code to a GitHub repo on every Build/Build all - local/R2 storage stays the working copy, GitHub keeps the version history.</p>
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
          <h2>Repository</h2>
          <p>A GitHub Personal Access Token with Contents: Read and write on the repo below.</p>
        </header>
        <div class="under stack">
          <CheckField
            label="Enabled"
            description="Off skips the GitHub push entirely - no error, no toast - until this is on and every field below is filled in."
            role="switch"
            value={value.enabled}
            onChange={(next) => update("enabled", next)}
          />
          <TextField
            label="Repository"
            required
            placeholder="your-org/your-site"
            value={value.repo}
            error={!!fieldErrors.repo}
            helperText={fieldErrors.repo}
            onChange={(next) => update("repo", next)}
          />
          <TextField
            label="Branch"
            required
            placeholder="main"
            value={value.branch}
            error={!!fieldErrors.branch}
            helperText={fieldErrors.branch}
            onChange={(next) => update("branch", next)}
          />
          <SecretKeyField
            label="Access Token"
            required={!hasExistingToken}
            value={value.token}
            hasExistingValue={hasExistingToken}
            error={!!fieldErrors.token}
            helperText={fieldErrors.token}
            onChange={(next) => update("token", next)}
          />
        </div>
      </section>
    </>
  );
}
