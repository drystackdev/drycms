import { useEffect, useMemo, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { createContentEntriesApi, ContentEntriesApiError } from "../content-types/entries-http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import TextField from "../components/fields/TextField.js";
import SelectField from "../components/fields/SelectField.js";
import SecretKeyField from "../components/fields/SecretKeyField.js";
import { toast } from "../components/Toast.js";
import { authState, canAccess } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";
import FullResetDialog from "../components/FullResetDialog.js";
import { DEFAULT_GITLAB_URL, parseGitRepositorySetting, serializeGitRepositorySetting, type GitProvider } from "../lib/git-provider.js";

interface GithubSyncValue extends Record<string, unknown> {
  provider: GitProvider;
  url: string;
  repo: string;
  branch: string;
  token: string;
}

/**
 * The `githubSync` singleton's admin page (`status/pages-source-github-versioning.md`) -
 * repo/branch/token for `routes/pages-source-github-sync.ts`'s snapshot
 * push, triggered from `PageBuild.tsx`'s Build actions.
 * `token` is `secretkey` (write-only, same "blank keeps the stored secret"
 * contract `AiKeyEditor.tsx` already established for its own `key` field) -
 * this page never receives the decrypted token back, only whether one is
 * already stored.
 */
export default function GithubSyncSettings({ setupOnly = false, onSaved, onSignOut }: { setupOnly?: boolean; onSaved?: () => void; onSignOut?: () => void } = {}) {
  useDocumentTitle("Git Sync");
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const entriesApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, "githubSync"), []);
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [value, setValue] = useState<GithubSyncValue | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const isSuperAdmin = authState.value.user?.isSuperAdmin === true;

  const canEdit = !!type && canAccess(type.id, "setting");
  const isDirty = initialSnapshot !== null && value !== null && JSON.stringify(value) !== initialSnapshot;

  useEffect(() => {
    void (async () => {
      try {
        // Cache-aware, not `typesApi.list()` - `value` below has no
        // autosave, so a background revalidation replaying this effect
        // mid-edit could silently discard unsaved changes.
        const definitions = await listCached(typesApi);
        const found = definitions.find((candidate) => candidate.name === "githubSync");
        if (!found) throw new Error('The system collection "githubSync" is not available.');
        setType(found);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load Git Sync settings.");
      }
    })();
  }, [typesApi]);

  useEffect(() => {
    if (!type) return;
    void (async () => {
      try {
        const entry = await entriesApi.getSingleton();
        const secret = entry?.value.token;
        const repository = parseGitRepositorySetting(typeof entry?.value.repo === "string" ? entry.value.repo : "");
        const loaded: GithubSyncValue = {
          provider: repository.provider,
          url: repository.url || DEFAULT_GITLAB_URL,
          repo: repository.repo,
          branch: typeof entry?.value.branch === "string" ? entry.value.branch : "",
          token: "",
        };
        setHasExistingToken(typeof secret === "object" && secret !== null && "hasExisting" in secret);
        setValue(loaded);
        setInitialSnapshot(JSON.stringify(loaded));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load Git Sync settings.");
      }
    })();
  }, [type, entriesApi]);

  function update<K extends keyof GithubSyncValue>(key: K, next: GithubSyncValue[K]) {
    setValue((current) => (current ? { ...current, [key]: next } : current));
    setFieldErrors((current) => key === "provider" ? {} : { ...current, [key]: "" });
  }

  async function save() {
    if (!value) return;
    setFieldErrors({});
    setSaving(true);
    try {
      if (setupOnly || value.token.trim()) {
        const response = await fetch(`${path}/api/git/validate`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: value.provider, url: value.url, repo: value.repo, token: value.token }) });
        const validation = await response.json().catch(() => ({})) as { valid?: boolean; fieldErrors?: Record<string, string> };
        if (!validation.valid) { setFieldErrors(validation.fieldErrors ?? {}); return; }
      }
      // Same "blank secretkey input on an existing entry keeps the stored
      // ciphertext" contract `AiKeyEditor.tsx`'s own save uses.
      const storedValue = { repo: serializeGitRepositorySetting(value), branch: value.branch, token: value.token };
      const payload = value.token.trim() || !hasExistingToken ? storedValue : { ...storedValue, token: { hasExisting: true } };
      await entriesApi.saveSingleton(payload);
      setValue({ ...value, token: "" });
      setInitialSnapshot(JSON.stringify({ ...value, token: "" }));
      setHasExistingToken(hasExistingToken || !!value.token.trim());
      toast.add({ type: "success", title: "Git Sync saved." });
      onSaved?.();
    } catch (error) {
      if (error instanceof ContentEntriesApiError && error.fieldErrors) setFieldErrors(error.fieldErrors);
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  if (!type || !value) return <span class="hint">Loading…</span>;
  if (!canEdit) return <span class="error">You don't have permission to manage Git Sync.</span>;

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Git Sync</h1>
          <p>Pushes a snapshot commit of your pages-source code to a GitHub or GitLab repository on every Build/Build all.</p>
        </div>
        <div class="row">
          {onSignOut && <button type="button" class="ghost sm" onClick={onSignOut}>Sign out</button>}
          {(setupOnly || isDirty) && (
            <button type="button" disabled={saving || !isDirty} aria-busy={saving || undefined} onClick={save}>
              Save
            </button>
          )}
        </div>
      </div>

      <section class={setupOnly ? "stack" : "card"}>
        <div class={setupOnly ? "stack" : "under stack"}>
          <SelectField
            label="Platform"
            required
            value={value.provider === "github" ? "GitHub" : "GitLab"}
            config={{ options: ["GitHub", "GitLab"], multiple: false }}
            onChange={(next) => update("provider", next === "GitLab" ? "gitlab" : "github")}
          />
          {value.provider === "gitlab" && <TextField
            label="GitLab URL"
            required
            placeholder={DEFAULT_GITLAB_URL}
            value={value.url}
            error={!!fieldErrors.url}
            helperText={fieldErrors.url}
            onChange={(next) => update("url", next)}
          />}
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

      {!setupOnly && isSuperAdmin && <section class="card">
        <header>
          <h2>Reset everything</h2>
          <p>
            Permanently resets the database to its built-in default content types (keeping only the account you're signed in as),
            deletes every uploaded media file, restores pages/build state to the mock starter, and clears this browser's cache/
            IndexedDB. Super Admin only.
          </p>
        </header>
        <div class="under">
          <button type="button" class="destructive" disabled={saving || isDirty} onClick={() => setResetOpen(true)}>
            Reset everything
          </button>
          {isDirty && <p class="hint">Save the Git Sync settings before resetting.</p>}
        </div>
      </section>}

      {!setupOnly && isSuperAdmin && (
        <FullResetDialog
          open={resetOpen}
          adminPath={path}
          onClose={() => setResetOpen(false)}
          onDone={() => {
            toast.add({ type: "success", title: "Reset complete", description: "Reloading…" });
            window.setTimeout(() => window.location.reload(), 1200);
          }}
        />
      )}
    </>
  );
}
