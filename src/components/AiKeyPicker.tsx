import { useEffect, useId, useState } from "preact/hooks";
import Combobox from "./Combobox.js";
import { createContentEntriesApi } from "../content-types/entries-http-api.js";

const { path, aiMode } = window.__DRY_CONFIG__;

const aiKeyApi = createContentEntriesApi(`${path}/api/content`, "aiKey");
const LAST_USED_STORAGE_KEY = "drycms.aiKeySelection";

/** `model` used to be a single-value `text` field (a bare string in the DB) -
 * see `AiKeyEditor.tsx`'s own `readModelList` doc comment for why an older
 * row can still deserialize as a plain string instead of an array. */
function readModelList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((model): model is string => typeof model === "string" && model.length > 0);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

interface AiKeyRow {
  name: string;
  provider: string;
  models: string[];
}

export interface AiKeySelection {
  keys: AiKeyRow[];
  loaded: boolean;
  keyName: string | undefined;
  model: string | undefined;
  /** False while the key list is still loading, when nothing is configured,
   * or when the admin cleared the selection - every AI action gates its own
   * run button on this, since the server no longer picks a key by itself. */
  ready: boolean;
  selectKey: (name: string) => void;
  selectModel: (model: string) => void;
}

function readLastUsed(): { keyName?: string; model?: string } {
  try {
    const raw = window.localStorage.getItem(LAST_USED_STORAGE_KEY);
    return raw ? JSON.parse(raw) as { keyName?: string; model?: string } : {};
  } catch {
    return {};
  }
}

/**
 * Loads the configured `aiKey` rows and holds the admin's explicit key/model
 * choice for one AI action (`status/ai-key-manual-selection.md`). The models
 * offered are exactly the ones saved on the chosen key's own `model` field -
 * no provider round-trip here; refreshing that list from the provider is the
 * AI Key editor's job.
 *
 * `active` gates the fetch to when the surrounding dialog/panel is actually
 * open. The last-used pair is remembered across dialogs so a repeat run
 * doesn't need two combobox trips every time; it's still a real, visible
 * selection the admin can change before running.
 */
export function useAiKeySelection(active: boolean): AiKeySelection {
  const [keys, setKeys] = useState<AiKeyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [keyName, setKeyName] = useState<string | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!active || aiMode !== "server") return;
    let cancelled = false;
    void aiKeyApi
      .list({ page: 0, pageSize: 100 })
      .then((result) => {
        if (cancelled) return;
        const rows = result.rows
          .map((row) => ({
            name: String(row.value.name ?? "").trim(),
            provider: String(row.value.provider ?? ""),
            models: readModelList(row.value.model),
          }))
          .filter((row) => row.name);
        const lastUsed = readLastUsed();
        const selected = rows.find((row) => row.name === lastUsed.keyName) ?? rows[0];
        setKeys(rows);
        setKeyName(selected?.name);
        setModel(selected?.models.includes(lastUsed.model ?? "") ? lastUsed.model : selected?.models[0]);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setKeys([]);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  function remember(nextKeyName: string | undefined, nextModel: string | undefined) {
    try {
      window.localStorage.setItem(LAST_USED_STORAGE_KEY, JSON.stringify({ keyName: nextKeyName, model: nextModel }));
    } catch {
      // A full/blocked localStorage only costs the convenience default.
    }
  }

  return {
    keys,
    loaded,
    keyName,
    model,
    ready: aiMode !== "server" || (loaded && !!keyName && !!model),
    selectKey(name: string) {
      const nextModel = keys.find((row) => row.name === name)?.models[0];
      setKeyName(name || undefined);
      setModel(nextModel);
      remember(name || undefined, nextModel);
    },
    selectModel(next: string) {
      setModel(next || undefined);
      remember(keyName, next || undefined);
    },
  };
}

/**
 * The AI Key + Model pickers every AI action shows before it runs. Always
 * rendered in server mode (even with a single configured key) so the admin
 * can always see which credentials a run is about to spend.
 */
export default function AiKeyPicker({ selection }: { selection: AiKeySelection }) {
  const fieldId = useId();
  if (aiMode !== "server") return <></>;
  if (selection.loaded && selection.keys.length === 0) {
    return (
      <div class="alert">
        No AI Key is configured yet. <a href={`${path}/content/aiKey/new`}>Add one</a> before using AI features.
      </div>
    );
  }
  const models = selection.keys.find((row) => row.name === selection.keyName)?.models ?? [];
  return (
    <div class="ai-key-picker">
      {/* Same `.field` > `<label>` > control wrapper `SelectField` owns - a
          bare `Combobox` renders no label of its own. */}
      <div class="field">
        <label for={`${fieldId}-key`}>AI Key<span class="required-asterisk">*</span></label>
        <Combobox
          id={`${fieldId}-key`}
          options={selection.keys.map((row) => ({ value: row.name, label: `${row.name} (${row.provider})` }))}
          value={selection.keyName ?? ""}
          onChange={selection.selectKey}
          placeholder={selection.loaded ? "Choose an AI Key…" : "Loading…"}
          disabled={!selection.loaded}
          invalid={selection.loaded && !selection.keyName}
        />
      </div>
      <div class="field">
        <label for={`${fieldId}-model`}>Model<span class="required-asterisk">*</span></label>
        <Combobox
          id={`${fieldId}-model`}
          options={models.map((name) => ({ value: name, label: name }))}
          value={selection.model ?? ""}
          onChange={selection.selectModel}
          placeholder={models.length ? "Choose a model…" : "No model on this key"}
          disabled={!selection.loaded || models.length === 0}
          invalid={selection.loaded && !selection.model}
          noResultsLabel="This AI Key has no model saved."
        />
      </div>
    </div>
  );
}
