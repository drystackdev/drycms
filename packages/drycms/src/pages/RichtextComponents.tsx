import { useEffect, useState } from "preact/hooks";
import { path } from "virtual:drycms/config";
import { components as componentModules } from "virtual:drycms/richtext-components";
import CheckField from "../components/CheckField.js";
import ComponentPreview from "../components/RichTextField/ComponentPreview.js";
import type { DryComponentRecord } from "../components/RichTextField/component-registry-types.js";
import { isDryComponentDefinition, type DryComponentDefinition } from "../components/RichTextField/register-component.js";
import { EyeIcon } from "../components/icons.js";
import { useDialogSync } from "../components/list-nav.js";
import { useDocumentTitle } from "./page-common.js";

interface Discovered {
  sourcePath: string;
  def: DryComponentDefinition;
}

async function fetchRecords(): Promise<DryComponentRecord[]> {
  const res = await fetch(`${path}/api/richtext-components`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.records) ? data.records : [];
}

/**
 * "Trang quản trị component" (mục 3, `status/register-compoennt.md`) -
 * scans every file discovered under `richtext.componentsDir`
 * (`virtual:drycms/richtext-components`'s glob map) for a valid
 * `DryEditerComponent(...)` marker, previews it with its own `defaults`,
 * and lets an admin "confirm" it for use in `RichTextField`'s insert
 * dialog - which just persists the already-resolved `{schema, defaults}`
 * (mục 3), it never re-runs any bundler/build step (mục 2's whole point:
 * build-time discovery, not a request-time compile).
 */
export default function RichtextComponents() {
  useDocumentTitle("Custom components");
  const [discovered, setDiscovered] = useState<Discovered[] | null>(null);
  const [records, setRecords] = useState<DryComponentRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Discovered | null>(null);
  const previewDialogRef = useDialogSync(!!previewing, () => setPreviewing(null));

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
          return { sourcePath, def: mod.default };
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
    try {
      if (use) {
        await fetch(`${path}/api/richtext-components`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: item.def.name,
            label: item.def.label,
            description: item.def.description,
            type: item.def.type,
            shadow: item.def.shadow,
            props: item.def.schema,
            defaults: item.def.defaults,
            sourcePath: item.sourcePath,
          }),
        });
      } else {
        await fetch(`${path}/api/richtext-components/${encodeURIComponent(item.def.name)}`, { method: "DELETE" });
      }
      reloadRecords();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="card">
      <div class="page-header">
        <div>
          <h1>Custom components</h1>
          <p>
            Components discovered under <code>richtext.componentsDir</code> - "Use in editor" makes one available in every{" "}
            <code>RichTextField</code>'s insert dialog.
          </p>
        </div>
      </div>

      {discovered === null && <p>Scanning components…</p>}
      {discovered !== null && discovered.length === 0 && (
        <p>No components found. Add a <code>DryEditerComponent(...)</code>-exporting <code>index.tsx</code> under your configured directory.</p>
      )}

      <div class="dry-component-admin-grid">
        {discovered?.map((item) => {
          const record = records.find((r) => r.name === item.def.name);
          const load = componentModules[item.sourcePath]!;
          return (
            <div
              class={`dry-component-admin-card dry-component-admin-card-${item.def.type}`}
              key={item.sourcePath}
            >
              <div class="dry-component-admin-preview-wrap">
                <ComponentPreview name={item.def.name} label={item.def.label} defaults={item.def.defaults} load={load} />
                <button
                  type="button"
                  class="ghost icon sm dry-component-admin-view-btn"
                  aria-label={`Preview ${item.def.label}`}
                  data-tooltip="Preview"
                  onClick={() => setPreviewing(item)}
                >
                  <EyeIcon />
                </button>
              </div>
              <div class="dry-component-admin-card-body">
                <strong>{item.def.label}</strong>
                {item.def.description && <p class="dry-component-admin-card-description">{item.def.description}</p>}
                <span class="dry-component-admin-card-meta">
                  <code>{`<dry-${item.def.name}>`}</code> · {item.def.type}
                  {item.def.shadow ? " · shadow" : ""}
                </span>
                <CheckField
                  label="Use in editor"
                  role="switch"
                  value={!!record}
                  disabled={busy === item.def.name}
                  onChange={(next) => toggleUse(item, next)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <dialog ref={previewDialogRef} class="dry-component-preview-dialog" aria-label={previewing ? `${previewing.def.label} preview` : "Component preview"}>
        {previewing && (
          <>
            <header>
              <h3>{previewing.def.label}</h3>
              {previewing.def.description && <p class="hint">{previewing.def.description}</p>}
            </header>
            <div class="dry-component-preview-large">
              <ComponentPreview
                name={previewing.def.name}
                label={previewing.def.label}
                defaults={previewing.def.defaults}
                load={componentModules[previewing.sourcePath]!}
              />
            </div>
            <footer>
              <button type="button" onClick={() => setPreviewing(null)}>
                Close
              </button>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
