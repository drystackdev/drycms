import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import IconGlyph from "../components/IconGlyph.js";
import TextField from "../components/TextField.js";
import { createIconsApi } from "../icons/icons-http-api.js";
import { useDocumentTitle } from "./page-common.js";

interface Props {
  /** The icon's current filename (e.g. "home-outline.svg") - present only
   * when editing an existing icon; absent for a brand-new one. Doubles as
   * both the "Add icon Manual" page and the edit page the preview dialog's
   * edit button links to, per the spec (same form either way). */
  name?: string;
}

export default function IconManualForm({ name }: Props) {
  const { route } = useLocation();
  const iconsApi = useMemo(() => createIconsApi(`${path}/api/icons`), []);
  const isEditing = !!name;
  useDocumentTitle(isEditing ? "Edit icon" : "Add icon");

  const [label, setLabel] = useState("");
  const [svg, setSvg] = useState("");
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [svgError, setSvgError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    iconsApi
      .get(name)
      .then((text) => {
        if (cancelled) return;
        setSvg(text);
        setLabel(name.replace(/\.svg$/, ""));
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load icon.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [iconsApi, name]);

  // A blob URL sidesteps every SVG-encoding pitfall a data: URI has, and -
  // same as everywhere else this feature displays a possibly-untrusted icon -
  // feeding it to a mask-image (via `IconGlyph`) means the browser never
  // executes anything inside it, regardless of what the textarea currently
  // contains.
  const previewUrl = useMemo(() => {
    if (!svg.trim()) return null;
    return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  }, [svg]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const handleSave = () => {
    setNameError(null);
    setSvgError(null);
    if (!label.trim()) {
      setNameError("Name is required.");
      return;
    }
    if (!svg.trim()) {
      setSvgError("SVG code is required.");
      return;
    }

    setSaving(true);
    const request = isEditing
      ? iconsApi.save({ originalName: name!, name: label, svg })
      : iconsApi.create({ name: label, svg });

    request
      .then(() => route(`${path}/icon-management`))
      .catch((error) => {
        setSaving(false);
        const message = error instanceof Error ? error.message : "Failed to save icon.";
        // Server-side collisions (already_exists) and content problems
        // (empty/invalid SVG after sanitization) surface on different fields
        // - inline on the field itself either way, never a toast, per the
        // dialog/form validation convention used throughout this admin UI.
        if (/already exists/i.test(message)) {
          setNameError(message);
        } else {
          setSvgError(message);
        }
      });
  };

  if (loading) return <span class="hint">Loading…</span>;

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>{isEditing ? "Edit icon" : "Add icon Manual"}</h1>
          <p>Paste raw SVG markup and give it a name.</p>
        </div>
      </div>

      {loadError && <span class="error">{loadError}</span>}

      <div class="row" style={{ alignItems: "flex-end", gap: "1rem" }}>
        <TextField
          label="Name"
          value={label}
          onChange={setLabel}
          placeholder="e.g. home-outline"
          error={!!nameError}
          helperText={nameError ?? undefined}
          style={{ flex: 1 }}
        />
        <div class="icon-cell" style={{ width: "3rem", padding: 0 }}>
          {previewUrl && <IconGlyph src={previewUrl} size={24} />}
        </div>
      </div>

      <TextField
        label="SVG code"
        value={svg}
        onChange={setSvg}
        multiline
        placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...</svg>'
        error={!!svgError}
        helperText={svgError ?? undefined}
      />

      <div class="row justify-end">
        <button type="button" class="outline" onClick={() => route(`${path}/icon-management`)}>
          Cancel
        </button>
        <button type="button" disabled={saving} onClick={handleSave}>
          Save
        </button>
      </div>
    </>
  );
}
