import { useMemo, useState } from "preact/hooks";
import IconGlyph from "./IconGlyph.js";
import { XIcon } from "./icons/index.js";
import { toast } from "./Toast.js";
import { useDialogSync } from "../hooks/list-nav.js";

interface Props {
  /** `"prefix:name"` - the Iconify search result this dialog previews. */
  id: string;
  /** Already-fetched (server-sanitized) SVG source - same preview map the
   * search grid uses, since every clickable tile already has its preview
   * loaded. */
  svg: string;
  adding: boolean;
  onAdd: () => void;
  onClose: () => void;
}

/** The app's default text color plus its 4 semantic tokens - swapped behind
 * the preview icon so it can be checked against each before importing it. */
const PREVIEW_COLORS = [
  { label: "Text", value: "var(--dry-foreground)" },
  { label: "Info", value: "var(--dry-info)" },
  { label: "Success", value: "var(--dry-success)" },
  { label: "Warning", value: "var(--dry-warning)" },
  { label: "Error", value: "var(--dry-error)" },
];

function splitId(id: string): [prefix: string, name: string] {
  const colon = id.indexOf(":");
  return [id.slice(0, colon), id.slice(colon + 1)];
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Same CSS-mask `<i>` technique used everywhere else this app copy-pastes
 * an icon, pointing at Iconify's own hosted API - this icon hasn't been
 * imported yet, so there's no local storage URL to reference instead. */
function maskSnippet(id: string): string {
  const [prefix, name] = splitId(id);
  const url = `https://api.iconify.design/${prefix}/${name}.svg`;
  return [
    "<i",
    ` style="display:inline-block;width:1em;height:1em;background-color:currentColor;`,
    `-webkit-mask:url('${url}') no-repeat center / contain;`,
    `mask:url('${url}') no-repeat center / contain;"`,
    "></i>",
  ].join("");
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.add({ type: "success", title: `${label} copied to clipboard.` }),
    () => toast.add({ type: "error", title: "Could not copy to clipboard." }),
  );
}

/**
 * Opened by clicking an icon on `IconSearchAdd`'s grid - a large preview
 * checkable against the app's semantic colors, plus copy-pasteable
 * SVG/HTML snippets and a one-click import into the local icon library.
 * Replaces the old multi-select "Copy"/"Add" toolbar: every action here
 * applies to just this one icon.
 */
export default function IconPreviewDialog({ id, svg, adding, onAdd, onClose }: Props) {
  const ref = useDialogSync(true, onClose);
  const [color, setColor] = useState(PREVIEW_COLORS[0]!.value);
  const name = splitId(id)[1];
  const dataUri = useMemo(() => svgToDataUri(svg), [svg]);

  return (
    <dialog ref={ref} class="sm icon-preview-dialog" aria-label={`Preview: ${name}`}>
      <header class="row justify-between">
        <h3>{name}</h3>
        <button onClick={onClose} class="icon ghost">
          <XIcon />
        </button>
      </header>

      <div class="icon-preview-stage">
        <div class="icon-preview-body lg center" style={{ color }}>
          <IconGlyph src={dataUri} size={92} />
        </div>
        <div class="color-swatch-grid" role="group" aria-label="Preview color">
          {PREVIEW_COLORS.map((swatch) => (
            <button
              type="button"
              key={swatch.value}
              class="color-swatch"
              style={`background: ${swatch.value}`}
              aria-label={swatch.label}
              aria-pressed={color === swatch.value}
              onClick={() => setColor(swatch.value)}
            />
          ))}
        </div>
      </div>

      <footer>
        <button
          type="button"
          class="outline"
          onClick={() => copyToClipboard(svg.trim(), "SVG")}
        >
          Copy SVG
        </button>
        <button
          type="button"
          class="outline"
          onClick={() => copyToClipboard(maskSnippet(id), "HTML")}
        >
          Copy HTML
        </button>
        <button type="button" disabled={adding} aria-busy={adding} onClick={onAdd}>
          Add
        </button>
      </footer>
    </dialog>
  );
}
