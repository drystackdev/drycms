import { useState } from "preact/hooks";
import CheckField from "./fields/CheckField.js";
import CodeBlock from "./CodeBlock.js";
import IconGlyph from "./IconGlyph.js";
import { XIcon } from "./icons/index.js";
import { useDialogSync } from "../hooks/list-nav.js";
import { useOverlayScrollbars } from "../hooks/overlayscrollbars.js";

interface Props {
  /** `"prefix:name"` pairs - the currently selected icons on the search grid. */
  ids: string[];
  /** Same preview map `IconSearchAdd` already fetched for the grid tiles -
   * reused here instead of re-fetching, since every selected id was on
   * screen (and so already had its preview loaded) to be selectable. */
  previews: Record<string, string>;
  onClose: () => void;
}

function splitId(id: string): [prefix: string, name: string] {
  const colon = id.indexOf(":");
  return [id.slice(0, colon), id.slice(colon + 1)];
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Embeds the already-fetched (and server-sanitized) SVG source directly -
 * no network request needed once copied, but the snippet is only as
 * portable as the page pasting it (works anywhere `<svg>` does). */
function inlineSnippet(svg: string): string {
  return `<i style="display:inline-flex;width:1em;height:1em;">${svg.trim()}</i>`;
}

/** Same CSS-mask technique as `IconPreviewDialog`'s copy snippet, but
 * pointing at Iconify's own hosted API instead of a locally-saved icon -
 * these icons haven't been imported yet, so there's no local URL to use. */
function iconifyApiSnippet(id: string): string {
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

/**
 * Opened from `IconSearchAdd`'s "Copy" button (next to "Add", once at least
 * one icon is selected) - lists every selected icon with a copy-pasteable
 * `<i>` snippet each, same `CodeBlock` + per-item copy button as
 * `IconPreviewDialog`. The switch at the top toggles every snippet at once
 * between inlining the fetched SVG and referencing Iconify's public API.
 */
export default function IconCopyDialog({ ids, previews, onClose }: Props) {
  const ref = useDialogSync(true, onClose);
  const [useIconifyApi, setUseIconifyApi] = useState(false);
  const { ref: body } = useOverlayScrollbars<HTMLDivElement>();

  return (
    <dialog
      ref={ref}
      class="lg icon-copy-dialog"
      aria-label="Copy icon snippets"
    >
      <header class="row justify-between">
        <div>
          <h3>Copy icons</h3>
          <p>
            {ids.length} icon{ids.length === 1 ? "" : "s"} selected.
          </p>
        </div>
        <button onClick={onClose} class="icon ghost">
          <XIcon />
        </button>
      </header>

      <CheckField
        role="switch"
        value={useIconifyApi}
        onChange={setUseIconifyApi}
        label="Use Iconify API"
        description="Reference api.iconify.design instead of embedding the SVG."
      />

      <div class="under" ref={body}>
        <div class="icon-copy-list">
          {ids.map((id) => {
            const svg = previews[id];
            const code = useIconifyApi
              ? iconifyApiSnippet(id)
              : svg
                ? inlineSnippet(svg)
                : "";
            return (
              <div
                class="row icon-copy-row"
                key={id}
                style={{ alignItems: "flex-start", gap: "1rem" }}
              >
                <div class="icon-preview-body sm center">
                  {svg ? (
                    <IconGlyph src={svgToDataUri(svg)} size={20} />
                  ) : (
                    <span
                      class="skeleton"
                      style="height: 1.25rem; width: 1.25rem; border-radius: 50%"
                    ></span>
                  )}
                </div>
                <div class="icon-copy-code">
                  <CodeBlock
                    code={code}
                    wrap
                    copyable
                    maxHeight="32rem"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </footer>
    </dialog>
  );
}
