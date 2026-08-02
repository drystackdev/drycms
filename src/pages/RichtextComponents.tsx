import { useEffect, useMemo, useState } from "preact/hooks";
import { path } from "virtual:drycms/config";
// A component is a default export from a file named `dry.<name>.<ext>`.
const componentModules = import.meta.glob<{ default?: unknown }>("/src/**/dry.*.{ts,tsx,js,jsx}");
import CheckField from "../components/CheckField.js";
import { createHttpFileSource } from "../components/file-manager-http-source.js";
import ComponentPreview from "../components/RichTextField/ComponentPreview.js";
import type { DryComponentRecord, PlainFieldDef } from "../components/RichTextField/component-registry-types.js";
import DryComponentPropsForm from "../components/RichTextField/dry-component-props-form.js";
import { invalidateRichtextComponents } from "../components/RichTextField/component-registry.js";
import {
  dryComponentNameFromSourcePath,
  isDryComponentDefinition,
  type DryComponentDefinition,
} from "../components/RichTextField/register-component.js";
import { useDialogSync } from "../components/list-nav.js";
import { ReplaceIcon, SettingsIcon } from "../components/icons.js";
import DryComponentIcon from "../components/RichTextField/dry-component-icon.js";
import { useDocumentTitle } from "./page-common.js";

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string };
    return data.message ?? "Build failed.";
  } catch {
    return "Build failed.";
  }
}

interface Discovered {
  sourcePath: string;
  def: DryComponentDefinition;
}

function definitionToRefRecord(def: DryComponentDefinition, trail = new Set<string>()): DryComponentRecord {
  const nextTrail = new Set(trail).add(def.name);
  const refs = def.refs.filter((ref) => !nextTrail.has(ref.name));
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    requiredInput: def.requiredInput ?? false,
    type: def.type,
    shadow: def.shadow,
    children: def.children,
    ...(def.childrenDefaultHtml !== undefined ? { childrenDefaultHtml: def.childrenDefaultHtml } : {}),
    ...(refs.length > 0 ? { refs: refs.map((ref) => ref.name), refRecords: refs.map((ref) => definitionToRefRecord(ref, nextTrail)) } : {}),
    props: def.schema as unknown as Record<string, PlainFieldDef>,
    defaults: def.defaults as Record<string, unknown>,
    sourcePath: "",
    enabled: true,
  };
}

async function fetchRecords(): Promise<DryComponentRecord[]> {
  const res = await fetch(`${path}/api/richtext-components`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.records) ? data.records : [];
}

/**
 * "Trang quản trị component" (mục 3, `status/register-compoennt.md`) -
 * scans every `dry.<name>.<ext>` file under `src/`
 * (this file's own `import.meta.glob` map) for a valid
 * `DryComponent(...)` marker, previews it with its own `defaults`,
 * and lets an admin "confirm" it for use in `RichTextField`'s insert
 * dialog - which just persists the already-resolved `{schema, defaults}`
 * (mục 3), it never re-runs any bundler/build step (mục 2's whole point:
 * build-time discovery, not a request-time compile).
 */
export default function RichtextComponents() {
  useDocumentTitle("Custom components");
  const source = useMemo(() => createHttpFileSource(`${path}/api/storage`), []);
  const [discovered, setDiscovered] = useState<Discovered[] | null>(null);
  const [records, setRecords] = useState<DryComponentRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [buildErrors, setBuildErrors] = useState<Record<string, string>>({});
  // Per-component preview overrides - client-only, never persisted; lets an
  // admin try different prop values in `ComponentPreview` above without
  // touching the confirmed record's own `defaults`.
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [configuring, setConfiguring] = useState<Discovered | null>(null);
  const [propsDraft, setPropsDraft] = useState<Record<string, unknown>>({});
  const configureDialogRef = useDialogSync(!!configuring, () => setConfiguring(null));

  const reloadRecords = () => {
    fetchRecords().then(setRecords);
  };

  useEffect(() => {
    reloadRecords();
    Promise.all(
      Object.keys(componentModules).map(async (sourcePath) => {
        try {
          const mod = await componentModules[sourcePath]!();
          if (!isDryComponentDefinition(mod.default)) return null;
          const filenameName = dryComponentNameFromSourcePath(sourcePath);
          if (!filenameName) return null;
          // Mutate the shared module definition so a parent module's `refs`
          // pointer observes the same filename fallback assigned when the
          // child module is discovered. An explicit config `name` wins.
          if (!mod.default.name) mod.default.name = filenameName;
          return { sourcePath, def: { ...mod.default } };
        } catch {
          return null;
        }
      }),
    ).then((results) => setDiscovered(results.filter((r): r is Discovered => r !== null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- glob map is static per build
  }, []);

  const toggleUse = async (item: Discovered, use: boolean) => {
    const busyKey = item.def.name;
    setBusy(busyKey);
    setBuildErrors((prev) => ({ ...prev, [busyKey]: "" }));
    try {
      if (use) {
        // Confirming builds the bundle server-side first - a build failure
        // aborts the whole confirm (no `.json`/`.js` written), surfaced here
        // rather than silently leaving the toggle looking like it worked.
        const res = await fetch(`${path}/api/richtext-components`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: item.def.name,
            label: item.def.label,
            description: item.def.description,
            type: item.def.type,
            shadow: item.def.shadow,
            children: item.def.children,
            childrenDefaultHtml: item.def.childrenDefaultHtml,
            requiredInput: item.def.requiredInput ?? true,
            refs: item.def.refs.map((ref) => ref.name),
            refRecords: item.def.refs.map((ref) => definitionToRefRecord(ref)),
            props: item.def.schema,
            defaults: item.def.defaults,
            sourcePath: item.sourcePath,
          }),
        });
        if (!res.ok) {
          const message = await readErrorMessage(res);
          setBuildErrors((prev) => ({ ...prev, [busyKey]: message }));
        } else {
          invalidateRichtextComponents();
        }
      } else {
        const res = await fetch(`${path}/api/richtext-components/${encodeURIComponent(item.def.name)}`, { method: "DELETE" });
        if (res.ok) invalidateRichtextComponents();
      }
      reloadRecords();
    } finally {
      setBusy(null);
    }
  };

  /** Rebuilds an already-confirmed component's bundle and refreshes its
   * stored JSON metadata from the rebuilt definition. */
  const rebuild = async (item: Discovered) => {
    const busyKey = item.def.name;
    setBusy(busyKey);
    setBuildErrors((prev) => ({ ...prev, [busyKey]: "" }));
    try {
      const res = await fetch(`${path}/api/richtext-components/${encodeURIComponent(item.def.name)}/build`, {
        method: "POST",
      });
      if (!res.ok) {
        const message = await readErrorMessage(res);
        setBuildErrors((prev) => ({ ...prev, [busyKey]: message }));
      } else {
        invalidateRichtextComponents();
        reloadRecords();
      }
    } finally {
      setBusy(null);
    }
  };

  const openConfigure = (item: Discovered) => {
    setConfiguring(item);
    setPropsDraft({ ...(previewOverrides[item.def.name] ?? item.def.defaults) });
  };

  const applyPreview = () => {
    if (!configuring) return;
    setPreviewOverrides((prev) => ({ ...prev, [configuring.def.name]: propsDraft }));
    setConfiguring(null);
  };

  return (
    <div class="card">
      <div class="page-header">
        <div>
          <h1>Custom components</h1>
          <p>
            Components discovered from <code>dry.&lt;name&gt;.&lt;ext&gt;</code> files - "Use in editor" makes one available in every{" "}
            <code>RichTextField</code>'s insert dialog.
          </p>
        </div>
      </div>

      {discovered === null && <p>Scanning components…</p>}
      {discovered !== null && discovered.length === 0 && (
        <p>No components found. Add a <code>DryComponent(...)</code>-exporting <code>dry.&lt;name&gt;.&lt;ext&gt;</code> file under <code>src/</code>.</p>
      )}

      <div class="dry-component-admin-grid under">
        {discovered?.map((item) => {
          const record = records.find((r) => r.name === item.def.name);
          const load = componentModules[item.sourcePath]!;
          const hasProps = Object.keys(item.def.schema).length > 0;
          return (
            <div
              class="card dry-component-admin-card"
              key={item.sourcePath}
            >
              <ComponentPreview
                name={item.def.name}
                label={item.def.label}
                defaults={previewOverrides[item.def.name] ?? item.def.defaults}
                load={load}
                shadow={item.def.shadow}
                childrenHtml={item.def.childrenDefaultHtml}
              />
              <div class="dry-component-admin-card-body">
                <h4><DryComponentIcon icon={item.def.icon} /> {item.def.label}</h4>
                <span class="dry-component-admin-card-meta">
                  <small class="badge outline">{item.def.version}</small>
                  <small class="badge outline">{item.def.auth || <em>None</em>}</small>
                </span>
                <p class="dry-component-admin-card-description" style={{marginBlock: '0.5rem'}}>
                  <em>{item.def.description}</em>
                </p>
                <span class="dry-component-admin-card-meta">
                  <small class="badge secondary">{`<dry-${item.def.name}>`}</small>
                  <small class="badge outline">{item.def.type}</small>
                  {item.def.shadow && <small class="badge outline">shadow</small>}
                  {item.def.children && <small class="badge outline">children</small>}
                </span>
                <div class="row">
                  <CheckField
                    label="Use in editor"
                    role="switch"
                    value={!!record}
                    disabled={busy === item.def.name}
                    onChange={(next) => toggleUse(item, next)}
                  />
                  {record && (
                    <button
                      type="button"
                      class="ghost icon sm"
                      aria-label={`Build ${item.def.label}`}
                      data-tooltip="Rebuild bundle"
                      disabled={busy === item.def.name}
                      onClick={() => rebuild(item)}
                    >
                      <ReplaceIcon />
                    </button>
                  )}
                  {hasProps && (
                    <button
                      type="button"
                      class="ghost icon sm"
                      aria-label={`Preview ${item.def.label} with different props`}
                      data-tooltip="Preview props"
                      onClick={() => openConfigure(item)}
                    >
                      <SettingsIcon />
                    </button>
                  )}
                </div>
                {buildErrors[item.def.name] && <span class="error">{buildErrors[item.def.name]}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <dialog
        ref={configureDialogRef}
        class="md"
        aria-label={configuring ? `${configuring.def.label} preview props` : "Preview props"}
      >
        {configuring && (
          <>
            <header>
              <h3>{configuring.def.label}</h3>
              <p class="hint">Try different prop values in the preview above - not saved anywhere.</p>
            </header>
            <div class="stack">
              <DryComponentPropsForm
                schema={configuring.def.schema as Record<string, PlainFieldDef>}
                value={propsDraft}
                onChange={setPropsDraft}
                source={source}
              />
            </div>
            <footer>
              <button type="button" class="outline" onClick={() => setConfiguring(null)}>
                Cancel
              </button>
              <button type="button" onClick={applyPreview}>
                Preview
              </button>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
