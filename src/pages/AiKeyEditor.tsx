import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import MultiSelect from "../components/MultiSelect.js";
import ConfirmDialog from "../components/ConfirmDialog.js";
import SecretKeyField from "../components/fields/SecretKeyField.js";
import SelectField from "../components/fields/SelectField.js";
import TextField from "../components/fields/TextField.js";
import { ArrowLeftIcon, ReplaceIcon, TrashIcon } from "../components/icons/index.js";
import { toast } from "../components/Toast.js";
import { ContentEntriesApiError, createContentEntriesApi } from "../content-types/entries-http-api.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { canAccess } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

interface Props {
  id?: string;
}

interface AiKeyValue extends Record<string, unknown> {
  name: string;
  description: string;
  provider: string;
  model: string[];
  key: string;
  url: string;
}

const PROVIDERS = ["Google", "Anthropic", "ChatGPT", "Custom"];

/** `model` used to be a single-value `text` field (a bare string in the DB) -
 * a row saved before this field became multi-`select` still deserializes as
 * a plain string (`field-registry.ts`'s `selectFieldType.deserialize` only
 * JSON-parses a value that already looks like `[...]`). Wrapping it in a
 * one-element array here keeps that older key usable until the admin next
 * saves it (which re-serializes it as a real JSON array). */
function readModelList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((model): model is string => typeof model === "string" && model.length > 0);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

export default function AiKeyEditor({ id }: Props) {
  const { route } = useLocation();
  const isNew = id === "new";
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const entriesApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, "aiKey"), []);
  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [value, setValue] = useState<AiKeyValue | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const provider = value?.provider ?? "";
  const isCustom = provider === "Custom";
  const canEdit = !!type && canAccess(type.id, isNew ? "create" : "update");
  const canDelete = !!type && !isNew && canAccess(type.id, "delete");
  const isDirty = initialSnapshot !== null && value !== null && JSON.stringify(value) !== initialSnapshot;

  useDocumentTitle(isNew ? "New AI Key" : "AI Key");

  useEffect(() => {
    void (async () => {
      try {
        const definitions = await typesApi.list();
        const found = definitions.find((candidate) => candidate.name === "aiKey");
        if (!found) throw new Error('The system collection "aiKey" is not available.');
        setAllTypes(definitions);
        setType(found);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load AI Key.");
      }
    })();
  }, [typesApi]);

  useEffect(() => {
    if (!type || !allTypes || !canEdit) return;
    if (isNew) {
      const blank: AiKeyValue = { name: "", description: "", provider: "", model: [], key: "", url: "" };
      setValue(blank);
      setInitialSnapshot(JSON.stringify(blank));
      return;
    }
    void (async () => {
      try {
        const entry = await entriesApi.get(id!);
        const secret = entry.value.key;
        const loaded: AiKeyValue = {
          name: typeof entry.value.name === "string" ? entry.value.name : "",
          description: typeof entry.value.description === "string" ? entry.value.description : "",
          provider: typeof entry.value.provider === "string" ? entry.value.provider : "",
          model: readModelList(entry.value.model),
          key: "",
          url: typeof entry.value.url === "string" ? entry.value.url : "",
        };
        setHasExistingKey(typeof secret === "object" && secret !== null && "hasExisting" in secret);
        setValue(loaded);
        setEntryId(entry.id);
        setInitialSnapshot(JSON.stringify(loaded));
      } catch (error) {
        if (error instanceof ContentEntriesApiError && /not found/i.test(error.message)) {
          route(`${path}/content/aiKey`, true);
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Failed to load AI Key.");
      }
    })();
  }, [type, allTypes, id, isNew, canEdit, entriesApi, route]);

  const loadModels = useCallback(async () => {
    if (!value?.provider) return;
    const storedEntryId = entryId ?? (!isNew ? id : undefined);
    if (!value.key.trim() && !storedEntryId) {
      setModels([]);
      setModelError("Enter an API key to load models.");
      return;
    }
    if (isCustom && !value.url.trim()) {
      setModels([]);
      setModelError("URL is required for Custom provider.");
      setFieldErrors((current) => ({ ...current, url: "URL is required for Custom provider." }));
      return;
    }
    setLoadingModels(true);
    setModelError(undefined);
    try {
      const response = await fetch(`${path}/api/ai/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ provider: value.provider, url: value.url, key: value.key, entryId: storedEntryId, entryName: value.name }),
      });
      const body = await response.json() as { models?: unknown; message?: string };
      if (!response.ok) throw new Error(body.message ?? "Failed to load models.");
      const next = Array.isArray(body.models) ? body.models.filter((model): model is string => typeof model === "string" && model.length > 0) : [];
      setModels(next);
      if (next.length === 0) setModelError("No models were returned by this provider.");
    } catch (error) {
      setModels([]);
      setModelError(error instanceof Error ? error.message : "Failed to load models.");
    } finally {
      setLoadingModels(false);
    }
  }, [entryId, id, isCustom, isNew, value?.key, value?.provider, value?.url]);

  useEffect(() => {
    const storedEntryId = entryId ?? (!isNew ? id : undefined);
    if (!provider || (!value?.key.trim() && !storedEntryId) || (isCustom && !value?.url.trim())) return;
    const timer = window.setTimeout(() => void loadModels(), 500);
    return () => window.clearTimeout(timer);
  }, [entryId, id, isCustom, isNew, loadModels, provider, value?.key, value?.url]);

  function update(field: keyof AiKeyValue, next: string) {
    setValue((current) => current ? { ...current, [field]: next } : current);
    setFieldErrors((current) => ({ ...current, [field]: "" }));
    if (field === "provider") {
      setModels([]);
      setModelError(undefined);
      setValue((current) => current ? { ...current, model: [], [field]: next } : current);
    }
  }

  function updateModel(next: string[]) {
    setValue((current) => current ? { ...current, model: next } : current);
    setFieldErrors((current) => ({ ...current, model: "" }));
  }

  async function save() {
    if (!value || !type) return;
    const errors: Record<string, string> = {};
    if (!value.name.trim()) errors.name = "Name is required.";
    if (!value.provider) errors.provider = "Provider is required.";
    if (value.model.length === 0) errors.model = "At least one model is required.";
    if (isNew && !value.key.trim()) errors.key = "Key is required.";
    if (isCustom && !value.url.trim()) errors.url = "URL is required for Custom provider.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      // Secret fields are write-only. An empty input on an existing entry is
      // an explicit "keep the stored secret" marker, not a missing required
      // value; the engine will omit it from the UPDATE and preserve ciphertext.
      const payload = isNew || value.key.trim()
        ? value
        : { ...value, key: { hasExisting: hasExistingKey } };
      const entry = isNew ? await entriesApi.create(payload) : await entriesApi.update(entryId!, payload);
      setValue({ ...value, key: "" });
      setInitialSnapshot(JSON.stringify({ ...value, key: "" }));
      setHasExistingKey(true);
      toast.add({ type: "success", title: isNew ? "Created AI Key." : "Saved AI Key." });
      route(`${path}/content/aiKey/${entry.id}`);
    } catch (error) {
      if (error instanceof ContentEntriesApiError && error.fieldErrors) setFieldErrors(error.fieldErrors);
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const targetId = entryId ?? id;
    if (!targetId) return;
    setDeleting(true);
    try {
      await entriesApi.remove(targetId);
      toast.add({ type: "success", title: "Deleted AI Key." });
      route(`${path}/content/aiKey`, true);
    } catch (error) {
      toast.add({ type: "error", title: "Delete failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  if (!type || !allTypes || !value) return <span class="hint">Loading…</span>;
  if (!canEdit && !canAccess(type.id, "view")) return <span class="error">You don't have permission to manage AI Keys.</span>;

  const modelOptions = [...models, ...value.model.filter((model) => !models.includes(model))];
  return (
    <>
      <section class="card ai-key-editor-card">
        <header>
          <div class="row justify-between">
            <div class="row">
              <button type="button" class="icon ghost" onClick={() => route(`${path}/content/aiKey`)}><ArrowLeftIcon /></button>
              <div style={{ flex: 1 }}>
                <h2>{isNew ? "New AI Key" : value.name || "AI Key"}</h2>
                <p>Manage provider credentials and the model used by AI features.</p>
              </div>
            </div>
            <div class="row">
              {canDelete && <button type="button" class="destructive" disabled={deleting} onClick={() => setShowDeleteConfirm(true)}><TrashIcon /> Delete</button>}
              {isDirty && <button type="button" disabled={!canEdit || saving} aria-busy={saving || undefined} onClick={save}>Save</button>}
            </div>
          </div>
        </header>
        <div class="under stack">
          <fieldset disabled={!canEdit} class="ai-key-editor-form">
            <div class="content-entry-editor-grid">
          <div class="stack">
            <TextField label="Name" value={value.name} onChange={(next) => update("name", next)} required error={!!fieldErrors.name} helperText={fieldErrors.name} />
            <TextField label="Description" value={value.description} onChange={(next) => update("description", next)} multiline />
            <SelectField label="Provider" value={value.provider} onChange={(next) => update("provider", String(next))} config={{ options: PROVIDERS, multiple: false }} required error={!!fieldErrors.provider} helperText={fieldErrors.provider} />
            {isCustom && <TextField label="URL" value={value.url} onChange={(next) => update("url", next)} placeholder="https://api.example.com/v1/models" required error={!!fieldErrors.url} helperText={fieldErrors.url} />}
            <SecretKeyField label="Key" value={value.key} onChange={(next) => update("key", next)} hasExistingValue={hasExistingKey} required={!hasExistingKey} error={!!fieldErrors.key} helperText={fieldErrors.key} />
          </div>
          <div class="stack">
            <div class="field">
              <label for="ai-key-model">Model<span class="required-asterisk">*</span></label>
              <div class="row ai-key-model-row">
                <MultiSelect
                  id="ai-key-model"
                  value={value.model}
                  options={modelOptions.map((model) => ({ value: model, label: model }))}
                  placeholder={loadingModels ? "Loading models…" : "Search models…"}
                  noResultsLabel={modelError || "No models found."}
                  disabled={loadingModels || modelOptions.length === 0}
                  invalid={!!fieldErrors.model}
                  onChange={updateModel}
                />
                <button
                  type="button"
                  class="outline icon lg"
                  aria-label="Refresh models"
                  data-tooltip="Refresh models"
                  disabled={!value.provider || loadingModels}
                  aria-busy={loadingModels || undefined}
                  onClick={() => void loadModels()}
                >
                  <ReplaceIcon />
                </button>
              </div>
              {fieldErrors.model && <span class="error">{fieldErrors.model}</span>}
              {!fieldErrors.model && (loadingModels ? <span class="hint">Loading models from provider…</span> : modelError && <span class="error">{modelError}</span>)}
            </div>
          </div>
            </div>
          </fieldset>
        </div>
      </section>
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this AI Key?"
        message={<p>This permanently deletes the AI Key. This cannot be undone.</p>}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
