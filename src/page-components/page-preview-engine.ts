import { buildPage, builtAssetUrlForJsPath, type PageBuildInput, type PageBuildResult } from "./page-build.js";

/**
 * The part of `PageEditor.tsx`'s live preview (`refreshPreview`) that has
 * real reuse value for a second caller (`PageBuilder.tsx`, `plans/
 * new-ui-page-builder.md` mục 10) - calling `buildPage()` against in-browser,
 * not-yet-saved source and turning the result into a self-contained
 * `srcdoc` string (interactive-hydration import map, `<base href>`, the
 * navigate/save bridge script). Neither caller's own tree/draft/save-reset
 * state lives here - that stays page-local (see the plan's own "tách được
 * nếu cần thời gian" cut).
 */

/** `postMessage` type a preview iframe's injected bridge script
 * (`buildPreviewBridgeScript`) sends for a link click - `srcdoc` has no real
 * route to navigate to (a detached, unpublished render), so every click is
 * intercepted and reported back here instead of being allowed to navigate
 * the iframe for real. */
export const PREVIEW_NAVIGATE_MESSAGE = "dry-page-preview-navigate";

/** `postMessage` type for `Cmd/Ctrl+S` pressed while focus sits INSIDE the
 * preview iframe - a key event never crosses a frame boundary, so the host
 * page's own window listener can't see it without this. */
export const PREVIEW_SAVE_MESSAGE = "dry-page-preview-save";

/** `postMessage` type for a click on a `[data-dry]`-marked element while VEI
 * mode is on (`buildPreviewBridgeScript({ vei: true })`) - `plans/
 * new-ui-page-builder.md` mục 3/8. Carries the FIRST ref decoded off the
 * clicked element's marker attribute, same "first ref wins" rule
 * `apps/vei/overlay.ts`'s own `intercept` uses. */
export const PREVIEW_VEI_CLICK_MESSAGE = "dry-page-preview-vei-click";
export const PREVIEW_VEI_MODE_MESSAGE = "dry-page-preview-vei-mode";
export const PREVIEW_TITLE_MESSAGE = "dry-page-preview-title";

export interface PreviewVeiClickRef {
  kind: "collection" | "singleton";
  type: string;
  id: number;
  path: string;
  fieldType: string;
}

/** Dashed-outline affordance for every markable element - the visual half of
 * VEI mode's "hiện các cái đánh mấu của data-dry" requirement. Injected only
 * when VEI is enabled (see `buildPreviewSrcdoc`), never unconditionally -
 * the plan's own "Không cần thêm css js thừa riêng cho chế độ VEI phục vụ
 * việc đã đăng nhập" requirement. Deliberately much smaller than
 * `apps/vei/overlay-styles.ts`'s own `MARKER_STYLES` (no brand-color
 * `--dry-vei-highlight` fetch, no separate focused-field state) - this is
 * the "tương đồng một vài chức năng", not a 1:1 port. */
const VEI_PREVIEW_MARKER_CSS = `
html.dry-vei-enabled [data-dry],
html.dry-vei-enabled [data-dry-src],
html.dry-vei-enabled [data-dry-html] {
  outline: 1px dashed color-mix(in srgb, #919eab 60%, transparent);
  cursor: pointer;
}
.dry-vei-preview-highlight {
  position: fixed;
  z-index: 2147482999;
  display: none;
  pointer-events: none;
  outline: 3px solid #919eab;
  outline-offset: -1px;
  background: color-mix(in srgb, #919eab 8%, transparent);
}
html.dry-vei-shift .dry-vei-preview-highlight {
  outline-color: #facc15;
  background: color-mix(in srgb, #facc15 10%, transparent);
}
`;

/** Opaque-origin sandbox frames are intentionally denied the browser's real
 * Storage objects. Tenant components still commonly use localStorage for
 * harmless UI state (theme toggles, dismissed banners), so give the preview
 * an in-memory Storage-compatible object scoped to this one frame document.
 * It neither exposes nor writes the admin origin's storage. */
export function buildPreviewStorageShimScript(): string {
  return `<script>(function(){function memoryStorage(){var values=new Map();return{get length(){return values.size;},clear:function(){values.clear();},getItem:function(key){key=String(key);return values.has(key)?values.get(key):null;},key:function(index){return Array.from(values.keys())[Number(index)]??null;},removeItem:function(key){values.delete(String(key));},setItem:function(key,value){values.set(String(key),String(value));}};}function install(name){try{void window[name].length;}catch(error){Object.defineProperty(window,name,{value:memoryStorage(),configurable:false,enumerable:true});}}install("localStorage");install("sessionStorage");})();</script>`;
}

/**
 * Runs INSIDE the preview iframe (injected as a literal `<script>` into the
 * built HTML, never sharing a JS realm with the caller) - capturing-phase so
 * it runs before any in-page handler the previewed code itself might attach.
 *
 * One combined `click` listener, not two independent ones: the VEI branch
 * must run (and `stopImmediatePropagation`) BEFORE the link-navigate branch
 * gets a chance to, since a marked field is very often nested inside an
 * `<a href>` (a card whose title is both a link and an editable field) and
 * VEI mode wants that click to open the field editor, not navigate away -
 * same precedence `apps/vei/overlay.ts`'s own `intercept` gives a marked
 * click over the page's native behavior.
 */
export function buildPreviewBridgeScript(options?: { vei?: boolean; runtimeVeiToggle?: boolean }): string {
  const veiEnabled = options?.vei === true;
  const veiBranch = veiEnabled
    ? `if(veiMode&&!event.shiftKey){var marked=findMarked(event.target);if(marked){var parts=marked.raw.trim().split(/\\s+/)[0].split(":");if(parts.length===5){event.preventDefault();window.parent.postMessage({type:${JSON.stringify(
        PREVIEW_VEI_CLICK_MESSAGE,
      )},ref:{kind:parts[0]==="c"?"collection":"singleton",type:parts[1],id:Number(parts[2]),path:parts[3],fieldType:parts[4]}},"*");return;}}}`
    : "";
  const findMarked = veiEnabled
    ? `function findMarked(node){while(node){if(node.getAttributeNames){var names=node.getAttributeNames();for(var i=0;i<names.length;i++){var n=names[i];if(n==="data-dry"||n.indexOf("data-dry-")===0){var raw=node.getAttribute(n);if(raw)return{el:node,raw:raw};}}}node=node.parentElement;}return null;}`
    : "";
  const highlightSupport = veiEnabled
    ? `var highlight=document.createElement("div");highlight.className="dry-vei-preview-highlight";(document.body||document.documentElement).appendChild(highlight);function hideHighlight(){highlight.style.display="none";}function showHighlight(el){var rect=el.getBoundingClientRect();highlight.style.left=rect.left+"px";highlight.style.top=rect.top+"px";highlight.style.width=rect.width+"px";highlight.style.height=rect.height+"px";highlight.style.borderRadius=getComputedStyle(el).borderRadius;highlight.style.display="block";}document.addEventListener("mousemove",function(event){if(!veiMode){hideHighlight();return;}var marked=findMarked(event.target);if(marked)showHighlight(marked.el);else hideHighlight();},true);document.addEventListener("mouseleave",hideHighlight,true);document.addEventListener("scroll",hideHighlight,true);`
    : "";
  const initialMode = veiEnabled && !options?.runtimeVeiToggle;
  const modeListener = options?.runtimeVeiToggle
    ? `window.addEventListener("message",function(event){if(event.data&&event.data.type===${JSON.stringify(PREVIEW_VEI_MODE_MESSAGE)}){veiMode=event.data.enabled===true;document.documentElement.classList.toggle("dry-vei-enabled",veiMode);if(!veiMode){document.documentElement.classList.remove("dry-vei-shift");${veiEnabled ? "hideHighlight();" : ""}}}});`
    : "";
  const shiftSupport = veiEnabled
    ? `function syncShift(event){document.documentElement.classList.toggle("dry-vei-shift",veiMode&&event.shiftKey===true);}window.addEventListener("keydown",syncShift,true);window.addEventListener("keyup",syncShift,true);window.addEventListener("blur",function(){document.documentElement.classList.remove("dry-vei-shift");hideHighlight();});`
    : "";
  return `<script>(function(){var veiMode=${JSON.stringify(initialMode)};if(veiMode)document.documentElement.classList.add("dry-vei-enabled");window.parent.postMessage({type:${JSON.stringify(PREVIEW_TITLE_MESSAGE)},title:document.title||""},"*");${findMarked}${highlightSupport}${modeListener}${shiftSupport}document.addEventListener("click",function(event){${veiBranch}var anchor=event.target&&event.target.closest?event.target.closest("a[href]"):null;if(!anchor)return;event.preventDefault();var pathname;try{pathname=new URL(anchor.href,document.baseURI).pathname;}catch(e){return;}window.parent.postMessage({type:${JSON.stringify(PREVIEW_NAVIGATE_MESSAGE)},pathname:pathname},"*");},true);document.addEventListener("keydown",function(event){if(String(event.key).toLowerCase()!=="s"||event.altKey||event.shiftKey||!(event.ctrlKey||event.metaKey))return;event.preventDefault();window.parent.postMessage({type:${JSON.stringify(PREVIEW_SAVE_MESSAGE)}},"*");},true);})();</script>`;
}

export interface BuildPreviewSrcdocInput {
  buildInput: PageBuildInput;
  /** `assetHrefs.veiOverlayHref` - stripped from the built HTML by exact
   * href match, same as `PageEditor.tsx` always did: whoever is running
   * this preview is already signed in, so the public site's own
   * "Edit content" overlay script has nothing useful to do inside a
   * detached `srcdoc` render (no real route, no server round trip
   * possible). */
  veiOverlayHref: string;
  /** Extends the injected bridge script with the `[data-dry]` click branch
   * and injects `VEI_PREVIEW_MARKER_CSS` - independent of
   * `buildInput.vei` (which controls whether `buildPage()` actually BOXES
   * any fields at all): a caller only ever sets both together, but this
   * function doesn't assume that. */
  veiEnabled?: boolean;
  runtimeVeiToggle?: boolean;
}

export interface BuildPreviewSrcdocResult {
  html: string;
  jsAssets: PageBuildResult["jsAssets"];
  deps: PageBuildResult["deps"];
  inSitemap: boolean;
  /** Kept for caller compatibility. Sandboxed previews use data-module URLs
   * now, so there are no parent-origin object URLs to revoke. */
  blobUrls: string[];
}

/**
 * `buildPage()` + everything `PageEditor.tsx`'s `refreshPreview` used to do
 * by hand to turn the result into a droppable `iframe.srcdoc` string:
 * interactive-hydration import map (each compiled asset's real
 * `/api/built-assets` URL remapped to a `Blob` object URL holding the exact
 * source just compiled - see `PageEditor.tsx`'s own doc comment on this
 * for the full "why"), an origin-qualifying `<base href>` (a `srcdoc`
 * document has no origin of its own), and the navigate/save/vei bridge
 * script. Never calls `publishBuiltPage` - this is preview-only, same as
 * every caller before this was extracted.
 */
export async function buildPreviewSrcdoc(input: BuildPreviewSrcdocInput): Promise<BuildPreviewSrcdocResult> {
  const result = await buildPage(input.buildInput);

  const importMap = { imports: {} as Record<string, string> };
  for (const asset of result.jsAssets) {
    // The preview iframe deliberately has an opaque sandbox origin. A Blob
    // URL created here belongs to the admin parent origin and cannot be
    // imported there; a data-module URL is self-contained and retains the
    // exact unsaved source without granting the frame `allow-same-origin`.
    const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(asset.source)}`;
    const realUrl = builtAssetUrlForJsPath(input.buildInput.builtAssetsBaseUrl, asset.jsPath);
    importMap.imports[realUrl] = moduleUrl;
    // Vite dev's import-analysis pass appends `?import` to every dynamic
    // `import()` it instruments (`hydrate-built.ts`'s own entry/layout/
    // preact-runtime imports included) - see `PageEditor.tsx`'s original
    // doc comment on this exact line for the full trace of why the plain
    // key alone would silently miss under `bun run dev`.
    importMap.imports[`${realUrl}?import`] = moduleUrl;
  }

  const withoutVei = result.html.replace(`<script type="module" src="${input.veiOverlayHref}"></script>`, "");

  const veiStyle = input.veiEnabled ? `<style>${VEI_PREVIEW_MARKER_CSS}</style>` : "";
  const headExtras =
    `<base href="${input.buildInput.origin}/">` +
    buildPreviewStorageShimScript() +
    (result.jsAssets.length > 0 ? `<script type="importmap">${JSON.stringify(importMap).replace(/</g, "\\u003c")}</script>` : "") +
    veiStyle;
  const withBase = withoutVei.replace("<head>", `<head>${headExtras}`);

  const bridgeScript = buildPreviewBridgeScript({ vei: input.veiEnabled, runtimeVeiToggle: input.runtimeVeiToggle });
  const withBridgeScript = withBase.includes("</body>") ? withBase.replace("</body>", `${bridgeScript}</body>`) : withBase + bridgeScript;

  return { html: withBridgeScript, jsAssets: result.jsAssets, deps: result.deps, inSitemap: result.inSitemap, blobUrls: [] };
}
