import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { createContentEntriesApi, ContentEntriesApiError } from "../content-types/entries-http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import TextField from "../components/fields/TextField.js";
import CheckField from "../components/fields/CheckField.js";
import SecretKeyField from "../components/fields/SecretKeyField.js";
import Combobox from "../components/Combobox.js";
import { toast } from "../components/Toast.js";
import { authState, canAccess } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";
import FullResetDialog from "../components/FullResetDialog.js";
import { GIT_URL_PLACEHOLDER, gitRemoteUrl, parseGitRemoteUrl, parseGitRepositorySetting, serializeGitRepositorySetting, type GitProvider } from "../lib/git-provider.js";

/** What the admin actually types: ONE repository URL, a token, a branch.
 * The platform, origin, repo path and Basic-auth user are all derived from
 * `url` (`lib/git-provider.ts`), and confirmed by the server - a self-hosted
 * GitLab is only distinguishable from any other self-hosted host by asking
 * it (`routes/git.ts`'s `resolveGitRemote`). */
interface GitSyncValue extends Record<string, unknown> {
  url: string;
  branch: string;
  token: string;
}

interface BranchListState {
  status: "idle" | "loading" | "ready" | "error";
  branches: string[];
  message: string;
}

const IDLE_BRANCHES: BranchListState = { status: "idle", branches: [], message: "" };

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
  const [value, setValue] = useState<GitSyncValue | null>(null);
  /** The platform the SERVER resolved for the current URL (from a branch
   * lookup or a validate call). Preferred over the host-only guess below
   * when saving, because it is the only thing that can tell a self-hosted
   * GitLab from a plain git host. */
  const [resolvedProvider, setResolvedProvider] = useState<GitProvider | null>(null);
  const [branchList, setBranchList] = useState<BranchListState>(IDLE_BRANCHES);
  /** "New branch": type a name instead of picking one of the loaded ones.
   * Also turned on automatically when the branches can't be listed at all,
   * so a bad token or an unreachable host never leaves the field unusable. */
  const [newBranch, setNewBranch] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const isSuperAdmin = authState.value.user?.isSuperAdmin === true;
  const branchFieldId = useId();

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
        const loaded: GitSyncValue = {
          url: gitRemoteUrl(repository),
          branch: typeof entry?.value.branch === "string" ? entry.value.branch : "",
          token: "",
        };
        setHasExistingToken(typeof secret === "object" && secret !== null && "hasExisting" in secret);
        setResolvedProvider(repository.repo ? repository.provider : null);
        setValue(loaded);
        setInitialSnapshot(JSON.stringify(loaded));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load Git Sync settings.");
      }
    })();
  }, [type, entriesApi]);

  function update<K extends keyof GitSyncValue>(key: K, next: GitSyncValue[K]) {
    setValue((current) => (current ? { ...current, [key]: next } : current));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
    // The URL decides the platform, so a typed URL invalidates whatever the
    // server last resolved until the next lookup confirms it.
    if (key === "url") setResolvedProvider(null);
  }

  /**
   * Loads the remote's branches for the Branch combobox as soon as there is
   * a parseable URL and a usable token - the one typed here, or (blank input,
   * unchanged URL) the stored one the server still holds. Debounced because
   * it runs on every keystroke in two fields, and sequenced because a slow
   * lookup for an older URL must never overwrite a newer one's result.
   */
  const lookupSeq = useRef(0);
  const remoteUrl = value?.url ?? "";
  const typedToken = value?.token ?? "";
  useEffect(() => {
    if (!value) return;
    // No token needed to ASK: a public repository advertises its branches to
    // anyone, and the server falls back to the stored token when the URL is
    // still the saved one.
    if (!parseGitRemoteUrl(remoteUrl).ok) {
      setBranchList(IDLE_BRANCHES);
      return;
    }
    const seq = ++lookupSeq.current;
    setBranchList({ status: "loading", branches: [], message: "" });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`${path}/api/git/branches`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: remoteUrl, token: typedToken }),
          });
          const body = await response.json().catch(() => ({})) as { branches?: string[]; defaultBranch?: string; provider?: GitProvider; error?: string };
          if (seq !== lookupSeq.current) return;
          if (!response.ok || !body.branches) {
            setBranchList({ status: "error", branches: [], message: body.error ?? "Branches could not be loaded." });
            setNewBranch(true);
            return;
          }
          setBranchList({ status: "ready", branches: body.branches, message: "" });
          if (body.provider) setResolvedProvider(body.provider);
          setNewBranch(false);
          // Only fills a branch in when there is none yet - never overwrites
          // what the admin (or the saved setting) already chose.
          setValue((current) => (current && !current.branch && body.defaultBranch ? { ...current, branch: body.defaultBranch } : current));
        } catch {
          if (seq !== lookupSeq.current) return;
          setBranchList({ status: "error", branches: [], message: "Branches could not be loaded." });
          setNewBranch(true);
        }
      })();
    }, 500);
    return () => window.clearTimeout(timer);
    // `value` itself is deliberately not a dependency - only these three
    // inputs decide the lookup, and `branch` changes on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteUrl, typedToken, hasExistingToken, !!value]);

  async function save() {
    if (!value) return;
    setFieldErrors({});
    const parsed = parseGitRemoteUrl(value.url);
    if (!parsed.ok) { setFieldErrors({ url: parsed.error }); return; }
    if (!value.branch.trim()) { setFieldErrors({ branch: "Pick a branch, or name a new one." }); return; }
    setSaving(true);
    try {
      // The URL alone can't tell a self-hosted GitLab from any other git
      // host, so the server's answer wins over the host-based guess whenever
      // there is one: `validate` resolves it live, and a branch lookup for
      // this same URL already did.
      let setting = { ...parsed.setting, provider: resolvedProvider ?? parsed.setting.provider };
      if (setupOnly || value.token.trim()) {
        const response = await fetch(`${path}/api/git/validate`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value.url, token: value.token }) });
        const validation = await response.json().catch(() => ({})) as { valid?: boolean; fieldErrors?: Record<string, string>; provider?: GitProvider; url?: string; repo?: string; user?: string };
        if (!validation.valid) { setFieldErrors(validation.fieldErrors ?? {}); return; }
        if (validation.provider && validation.url && validation.repo) {
          setting = { provider: validation.provider, url: validation.url, repo: validation.repo, user: validation.user ?? "" };
          setResolvedProvider(validation.provider);
        }
      }
      // Same "blank secretkey input on an existing entry keeps the stored
      // ciphertext" contract `AiKeyEditor.tsx`'s own save uses.
      const storedValue = { repo: serializeGitRepositorySetting(setting), branch: value.branch.trim(), token: value.token };
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

  const parsedUrl = value ? parseGitRemoteUrl(value.url) : null;
  const detectedProvider = resolvedProvider ?? (parsedUrl?.ok ? parsedUrl.setting.provider : null);
  const providerHint = !parsedUrl?.ok
    ? ""
    : detectedProvider === "github"
      ? `GitHub · ${parsedUrl.setting.repo}`
      : detectedProvider === "gitlab"
        ? `GitLab · ${parsedUrl.setting.repo}`
        : `Self-hosted git · ${parsedUrl.setting.repo}${parsedUrl.setting.user ? ` (as ${parsedUrl.setting.user})` : ""}`;
  // A branch that is already saved but no longer on the remote (or one typed
  // as "new" before the list arrived) still has to be visible and selected -
  // a combobox with no matching option would render blank while the value
  // silently stayed behind it.
  const knownBranches = value?.branch && !branchList.branches.includes(value.branch)
    ? [value.branch, ...branchList.branches]
    : branchList.branches;
  const branchOptions = knownBranches.map((name) => ({ value: name, label: name }));
  // One line under Branch, in priority order: a save error, why the list is
  // empty, or what was loaded.
  const branchHelpIsError = !!fieldErrors.branch || branchList.status === "error";
  const branchHelp = fieldErrors.branch
    || (branchList.status === "error" ? branchList.message : "")
    || (newBranch ? "" : branchList.status === "idle"
      ? "Add the repository URL and an access token to list branches."
      : branchList.status === "loading"
        ? "Loading branches…"
        : `${branchList.branches.length} ${branchList.branches.length === 1 ? "branch" : "branches"} on this repository.`);

  if (loadError) return <span class="error">{loadError}</span>;
  if (!type || !value) return <span class="hint">Loading…</span>;
  if (!canEdit) return <span class="error">You don't have permission to manage Git Sync.</span>;

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Git Sync</h1>
          <p>Pushes a snapshot commit of your pages-source code to a git repository on every Build/Build all. Paste the repository URL - GitHub, GitLab and self-hosted git servers are recognised automatically.</p>
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
          <TextField
            label="Repository URL"
            required
            type="url"
            placeholder={GIT_URL_PLACEHOLDER}
            value={value.url}
            error={!!fieldErrors.url}
            helperText={fieldErrors.url || providerHint}
            onChange={(next) => update("url", next)}
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
          <div class="field">
            <label for={branchFieldId}>Branch<span class="required-asterisk">*</span></label>
            {newBranch ? (
              <input
                id={branchFieldId}
                type="text"
                placeholder="main"
                value={value.branch}
                aria-invalid={!!fieldErrors.branch || undefined}
                onInput={(event) => update("branch", (event.target as HTMLInputElement).value)}
              />
            ) : (
              <Combobox
                id={branchFieldId}
                options={branchOptions}
                value={value.branch}
                invalid={!!fieldErrors.branch}
                disabled={branchList.status !== "ready"}
                placeholder={branchList.status === "loading" ? "Loading branches…" : "Select a branch…"}
                noResultsLabel="No branch matches."
                onChange={(next) => update("branch", next)}
              />
            )}
            {branchHelp && <span class={branchHelpIsError ? "error" : "hint"}>{branchHelp}</span>}
          </div>
          <CheckField
            label="New branch"
            description="Type a branch name instead of picking an existing one - it is created on the first push."
            value={newBranch}
            onChange={(next) => {
              setNewBranch(next);
              setFieldErrors((current) => ({ ...current, branch: "" }));
            }}
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
