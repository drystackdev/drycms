import { buildPage, builtAssetUrlForJsPath, type PageBuildInput, type PageBuildResult } from "./page-build.js";
import { instrumentSourceLocations } from "./inspector-instrument-client.js";

/**
 * The part of `PageBuilder.tsx`'s live preview (`refreshPreview`) that has
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
 * the deleted public-site overlay's own `intercept` uses. */
export const PREVIEW_VEI_CLICK_MESSAGE = "dry-page-preview-vei-click";
export const PREVIEW_VEI_MODE_MESSAGE = "dry-page-preview-vei-mode";
export const PREVIEW_VEI_FOCUS_MESSAGE = "dry-page-preview-vei-focus";
export const PREVIEW_TITLE_MESSAGE = "dry-page-preview-title";

/** `postMessage` type the preview iframe's bridge script sends whenever the
 * hovered/marked-under-cursor `data-dry-loc` element changes -
 * `status/page-builder-code-preview-sync.md`'s "hover preview -> highlight
 * code" direction. `loc: null` means the pointer left every marked element
 * (or preview inspector mode found nothing under it), not "no change". */
export const PREVIEW_INSPECTOR_HOVER_MESSAGE = "dry-page-preview-inspector-hover";
/** `postMessage` type the PARENT sends INTO the iframe with the code
 * editor's current cursor position - the reverse direction, "code cursor ->
 * highlight preview". `loc: null` clears any standing highlight (e.g. the
 * code panel closed, or the cursor moved to a file with nothing rendered in
 * this preview). */
export const PREVIEW_INSPECTOR_CURSOR_MESSAGE = "dry-page-preview-inspector-cursor";
/** `postMessage` type the preview iframe's bridge script sends on a click
 * landing inside a `data-dry-loc`-marked element while inspector mode is on -
 * "click preview -> open that file", the click counterpart to
 * `PREVIEW_INSPECTOR_HOVER_MESSAGE`'s hover direction. The click is
 * `preventDefault`'d so it never also fires the page's own click handling or
 * the anchor-navigate branch below it. */
export const PREVIEW_INSPECTOR_CLICK_MESSAGE = "dry-page-preview-inspector-click";

export interface PreviewInspectorLoc {
  path: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

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
 * the deleted overlay's own `MARKER_STYLES` (no brand-color
 * `--dry-vei-highlight` fetch). The focused-field overlay below reuses the
 * same highlight box as hover rather than introducing another visual layer. */
const VEI_PREVIEW_MARKER_CSS = `
html.dry-vei-enabled [data-dry],
html.dry-vei-enabled [data-dry-src],
html.dry-vei-enabled [data-dry-html] {
  outline: 2px dashed color-mix(in srgb, #919eab 60%, transparent);
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

/** Separate box/class from `.dry-vei-preview-highlight` - code-inspector
 * hover/cursor sync (`status/page-builder-code-preview-sync.md`) is
 * independent of VEI content-edit mode (either can be on without the
 * other), and a visually distinct color keeps the two from being confused
 * when both happen to highlight the same element. */
const INSPECTOR_PREVIEW_MARKER_CSS = `
.dry-inspector-preview-highlight {
  position: fixed;
  z-index: 2147483000;
  display: none;
  pointer-events: none;
  outline: 2px solid #3b82f6;
  outline-offset: -1px;
  background: color-mix(in srgb, #3b82f6 10%, transparent);
  border-radius: 2px;
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
 * same precedence the deleted public-site overlay's own `intercept` gives a marked
 * click over the page's native behavior.
 */
export function buildPreviewBridgeScript(options?: { vei?: boolean; runtimeVeiToggle?: boolean; inspector?: boolean }): string {
  const veiEnabled = options?.vei === true;
  const inspectorEnabled = options?.inspector === true;
  const veiBranch = veiEnabled
    ? `if(veiMode&&!event.shiftKey){var marked=findMarked(event.target);if(marked){var parts=marked.raw.trim().split(/\\s+/)[0].split(":");if(parts.length===5){event.preventDefault();window.parent.postMessage({type:${JSON.stringify(
        PREVIEW_VEI_CLICK_MESSAGE,
      )},ref:{kind:parts[0]==="c"?"collection":"singleton",type:parts[1],id:Number(parts[2]),path:parts[3],fieldType:parts[4]}},"*");return;}}}`
    : "";
  const findMarked = veiEnabled
    ? `function findMarked(node){while(node){if(node.getAttributeNames){var names=node.getAttributeNames();for(var i=0;i<names.length;i++){var n=names[i];if(n==="data-dry"||n.indexOf("data-dry-")===0){var raw=node.getAttribute(n);if(raw)return{el:node,raw:raw};}}}node=node.parentElement;}return null;}`
    : "";
  const highlightSupport = veiEnabled
    ? `var highlight=document.createElement("div");highlight.className="dry-vei-preview-highlight";(document.body||document.documentElement).appendChild(highlight);function hideHighlight(){highlight.style.display="none";}function showHighlight(el){var rect=el.getBoundingClientRect();highlight.style.left=rect.left+"px";highlight.style.top=rect.top+"px";highlight.style.width=rect.width+"px";highlight.style.height=rect.height+"px";highlight.style.borderRadius=getComputedStyle(el).borderRadius;highlight.style.display="block";}document.addEventListener("mousemove",function(event){if(!veiMode){hideHighlight();return;}if(focusedEl){showHighlight(focusedEl);return;}var marked=findMarked(event.target);if(marked)showHighlight(marked.el);else hideHighlight();},true);document.addEventListener("mouseleave",function(){if(!focusedEl)hideHighlight();},true);document.addEventListener("scroll",function(){if(focusedEl)showHighlight(focusedEl);else hideHighlight();},true);`
    : "";
  const initialMode = veiEnabled && !options?.runtimeVeiToggle;
  const modeListener = options?.runtimeVeiToggle
    ? `window.addEventListener("message",function(event){if(event.data&&event.data.type===${JSON.stringify(PREVIEW_VEI_MODE_MESSAGE)}){veiMode=event.data.enabled===true;document.documentElement.classList.toggle("dry-vei-enabled",veiMode);if(!veiMode){${veiEnabled ? "focusedEl=null;" : ""}document.documentElement.classList.remove("dry-vei-shift");${veiEnabled ? "hideHighlight();" : ""}}}});`
    : "";
  const focusListener = veiEnabled
    ? `var focusedEl=null;function findFocusedMarker(detail){if(!detail||!detail.path)return null;var nodes=document.querySelectorAll("[data-dry],[data-dry-src],[data-dry-html]");for(var i=0;i<nodes.length;i++){var names=nodes[i].getAttributeNames();for(var j=0;j<names.length;j++){var name=names[j];if(name!=="data-dry"&&name.indexOf("data-dry-")!==0)continue;var refs=(nodes[i].getAttribute(name)||"").trim().split(/\\s+/);for(var k=0;k<refs.length;k++){var parts=refs[k].split(":");if(parts.length===5&&parts[1]===detail.typeSlug&&parts[3]===detail.path&&(detail.entryId===null||Number(parts[2])===detail.entryId))return nodes[i];}}}return null;}window.addEventListener("message",function(event){if(!event.data||event.data.type!==${JSON.stringify(PREVIEW_VEI_FOCUS_MESSAGE)})return;focusedEl=findFocusedMarker(event.data.detail);if(!focusedEl){hideHighlight();return;}focusedEl.scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"});showHighlight(focusedEl);});`
    : "";
  const shiftSupport = veiEnabled
    ? `function syncShift(event){document.documentElement.classList.toggle("dry-vei-shift",veiMode&&event.shiftKey===true);}window.addEventListener("keydown",syncShift,true);window.addEventListener("keyup",syncShift,true);window.addEventListener("blur",function(){document.documentElement.classList.remove("dry-vei-shift");hideHighlight();});`
    : "";

  // `data-dry-loc="path:startLine:startCol:endLine:endCol"` marks a JSX host
  // element's ORIGINAL source range (`inspector-instrument.ts`). Split from
  // the right (last 4 colon-separated parts are numbers) rather than the
  // left, so a path is never mistaken for part of the numeric suffix.
  const parseLoc = inspectorEnabled
    ? `function parseLoc(raw){var parts=raw.split(":");if(parts.length<5)return null;var nums=parts.slice(-4).map(Number);if(nums.some(isNaN))return null;return{path:parts.slice(0,-4).join(":"),startLine:nums[0],startCol:nums[1],endLine:nums[2],endCol:nums[3]};}function locContains(loc,line,column){if(line<loc.startLine||line>loc.endLine)return false;if(line===loc.startLine&&column<loc.startCol)return false;if(line===loc.endLine&&column>loc.endCol)return false;return true;}function findLocMarked(node){while(node){if(node.getAttribute){var raw=node.getAttribute("data-dry-loc");if(raw){var loc=parseLoc(raw);if(loc)return{el:node,loc:loc};}}node=node.parentElement;}return null;}function findLocContaining(path,line,column){var nodes=document.querySelectorAll("[data-dry-loc]");var best=null;var bestSize=Infinity;for(var i=0;i<nodes.length;i++){var loc=parseLoc(nodes[i].getAttribute("data-dry-loc"));if(!loc||loc.path!==path||!locContains(loc,line,column))continue;var size=(loc.endLine-loc.startLine)*100000+Math.abs(loc.endCol-loc.startCol);if(size<bestSize){bestSize=size;best=nodes[i];}}return best;}`
    : "";
  // Deliberately its own box/class, not `showHighlight`/`hideHighlight`
  // above - independent of VEI content-edit mode (either can be on
  // without the other), see `INSPECTOR_PREVIEW_MARKER_CSS`'s own comment.
  const inspectorHighlightSupport = inspectorEnabled
    ? `var inspectorHighlight=document.createElement("div");inspectorHighlight.className="dry-inspector-preview-highlight";(document.body||document.documentElement).appendChild(inspectorHighlight);function hideInspectorHighlight(){inspectorHighlight.style.display="none";}function showInspectorHighlight(el){var rect=el.getBoundingClientRect();inspectorHighlight.style.left=rect.left+"px";inspectorHighlight.style.top=rect.top+"px";inspectorHighlight.style.width=rect.width+"px";inspectorHighlight.style.height=rect.height+"px";inspectorHighlight.style.borderRadius=getComputedStyle(el).borderRadius;inspectorHighlight.style.display="block";}`
    : "";
  // Hover preview -> highlight code: reports only on CHANGE (not every
  // mousemove tick) - `PageBuilder.tsx` only cares about "what's under the
  // pointer now", and a message per pixel would be wasted work on both ends.
  // Shift is the escape hatch - held down, hovering (or a stray keydown with
  // the mouse already resting on a marked element) reports/shows nothing, so
  // the element's own native behavior (hover states, a link's title tooltip,
  // text selection) isn't fought by the highlight box sitting on top of it -
  // same convention `shiftSupport`'s `dry-vei-shift` already uses for VEI.
  const inspectorHoverSupport = inspectorEnabled
    ? `var lastHoverLocEl=null;function reportHover(marked){lastHoverLocEl=marked?marked.el:null;if(marked){showInspectorHighlight(marked.el);window.parent.postMessage({type:${JSON.stringify(PREVIEW_INSPECTOR_HOVER_MESSAGE)},loc:marked.loc},"*");}else{hideInspectorHighlight();window.parent.postMessage({type:${JSON.stringify(PREVIEW_INSPECTOR_HOVER_MESSAGE)},loc:null},"*");}}document.addEventListener("mousemove",function(event){if(event.shiftKey){if(lastHoverLocEl)reportHover(null);return;}var marked=findLocMarked(event.target);var el=marked?marked.el:null;if(el===lastHoverLocEl)return;reportHover(marked);},true);document.addEventListener("mouseleave",function(){if(lastHoverLocEl)reportHover(null);},true);document.addEventListener("scroll",function(){if(lastHoverLocEl)reportHover(null);},true);document.addEventListener("keydown",function(event){if(event.shiftKey&&lastHoverLocEl)reportHover(null);},true);`
    : "";
  // Code cursor -> highlight preview: the parent posts the editor's current
  // {path,line,column}; the smallest `data-dry-loc` range containing that
  // point is the most specific (deepest) element, the same "which element
  // is this" question hover answers in the other direction.
  const inspectorCursorSupport = inspectorEnabled
    ? `window.addEventListener("message",function(event){if(!event.data||event.data.type!==${JSON.stringify(PREVIEW_INSPECTOR_CURSOR_MESSAGE)})return;var loc=event.data.loc;if(!loc){hideInspectorHighlight();return;}var el=findLocContaining(loc.path,loc.line,loc.column);if(!el){hideInspectorHighlight();return;}el.scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"});showInspectorHighlight(el);});`
    : "";
  // Click preview -> open file: same shift-key escape hatch as hover, and
  // runs BEFORE the anchor-navigate branch below (same `veiBranch`
  // precedence/`return` pattern) since a marked element is very often
  // itself, or nested inside, an `<a href>`.
  const inspectorClickBranch = inspectorEnabled
    ? `if(!event.shiftKey){var marked=findLocMarked(event.target);if(marked){event.preventDefault();window.parent.postMessage({type:${JSON.stringify(PREVIEW_INSPECTOR_CLICK_MESSAGE)},loc:marked.loc},"*");return;}}`
    : "";

  return `<script>(function(){var veiMode=${JSON.stringify(initialMode)};if(veiMode)document.documentElement.classList.add("dry-vei-enabled");window.parent.postMessage({type:${JSON.stringify(PREVIEW_TITLE_MESSAGE)},title:document.title||""},"*");${findMarked}${highlightSupport}${modeListener}${focusListener}${shiftSupport}${parseLoc}${inspectorHighlightSupport}${inspectorHoverSupport}${inspectorCursorSupport}document.addEventListener("click",function(event){${veiBranch}${inspectorClickBranch}var anchor=event.target&&event.target.closest?event.target.closest("a[href]"):null;if(!anchor)return;event.preventDefault();var pathname;try{pathname=new URL(anchor.href,document.baseURI).pathname;}catch(e){return;}window.parent.postMessage({type:${JSON.stringify(PREVIEW_NAVIGATE_MESSAGE)},pathname:pathname},"*");},true);document.addEventListener("keydown",function(event){if(String(event.key).toLowerCase()!=="s"||event.altKey||event.shiftKey||!(event.ctrlKey||event.metaKey))return;event.preventDefault();window.parent.postMessage({type:${JSON.stringify(PREVIEW_SAVE_MESSAGE)}},"*");},true);})();</script>`;
}

export interface BuildPreviewSrcdocInput {
  buildInput: PageBuildInput;
  /** `assetHrefs.editLauncherHref` - stripped from the built HTML by exact
   * href match, same as `PageBuilder.tsx` always did: whoever is running
   * this preview is already signed in, so the public site's own
   * "Edit content" overlay script has nothing useful to do inside a
   * detached `srcdoc` render (no real route, no server round trip
   * possible). */
  editLauncherHref: string;
  /** Extends the injected bridge script with the `[data-dry]` click branch
   * and injects `VEI_PREVIEW_MARKER_CSS` - independent of
   * `buildInput.vei` (which controls whether `buildPage()` actually BOXES
   * any fields at all): a caller only ever sets both together, but this
   * function doesn't assume that. */
  veiEnabled?: boolean;
  runtimeVeiToggle?: boolean;
  /** Instruments every `.tsx` file with `data-dry-loc` markers before
   * building (`inspector-instrument.ts`) and injects the hover/cursor sync
   * bridge script - `status/page-builder-code-preview-sync.md`. Independent
   * of `veiEnabled`: `PageBuilder.tsx` sets this from "is the Code panel
   * open", not from VEI content-edit mode. Costs one off-main-thread parse
   * pass per `.tsx` file per rebuild - skip it (leave `false`) for any
   * preview where nothing will ever read `data-dry-loc` back
   * (`FileDialog.tsx`'s standalone file preview, for instance). */
  inspectorEnabled?: boolean;
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

function previewModuleDataUrl(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // Base64 is materially smaller than encodeURIComponent for ordinary JS
  // source and keeps DevTools from tokenizing a percent-escaped module URL
  // several times larger than the module itself.
  return `data:text/javascript;base64,${btoa(binary)}`;
}

/**
 * `buildPage()` + everything `PageBuilder.tsx`'s `refreshPreview` used to do
 * by hand to turn the result into a droppable `iframe.srcdoc` string:
 * interactive-hydration import map (each compiled asset's real
 * `/api/built-assets` URL remapped to a `Blob` object URL holding the exact
 * source just compiled - see `PageBuilder.tsx`'s own doc comment on this
 * for the full "why"), an origin-qualifying `<base href>` (a `srcdoc`
 * document has no origin of its own), and the navigate/save/vei bridge
 * script. Never calls `publishBuiltPage` - this is preview-only, same as
 * every caller before this was extracted.
 */
export async function buildPreviewSrcdoc(input: BuildPreviewSrcdocInput): Promise<BuildPreviewSrcdocResult> {
  // A throwaway COPY of `sourceByPath` for THIS build only - never written
  // back anywhere, so `data-dry-loc` markers never reach the real store
  // (`use-page-builder-source.ts`) or a published page's HTML.
  const buildInput = input.inspectorEnabled
    ? { ...input.buildInput, sourceByPath: await instrumentSourceLocations(input.buildInput.sourceByPath) }
    : input.buildInput;
  const result = await buildPage(buildInput);

  const importMap = { imports: {} as Record<string, string> };
  for (const asset of result.jsAssets) {
    // The preview iframe deliberately has an opaque sandbox origin. A Blob
    // URL created here belongs to the admin parent origin and cannot be
    // imported there; a data-module URL is self-contained and retains the
    // exact unsaved source without granting the frame `allow-same-origin`.
    const moduleUrl = previewModuleDataUrl(asset.source);
    const realUrl = builtAssetUrlForJsPath(input.buildInput.builtAssetsBaseUrl, asset.jsPath);
    importMap.imports[realUrl] = moduleUrl;
    // Vite dev's import-analysis pass appends `?import` to every dynamic
    // `import()` it instruments (`hydrate-built.ts`'s own entry/layout/
    // preact-runtime imports included) - see `PageBuilder.tsx`'s original
    // doc comment on this exact line for the full trace of why the plain
    // key alone would silently miss under `bun run dev`.
    importMap.imports[`${realUrl}?import`] = moduleUrl;
  }

  // Keep Vite's dev client in the preview: hydrate-built and its dependency
  // graph are not imported by the admin bundle, so this frame owns their HMR
  // subscription. HTTP caching is independent from that WebSocket channel.
  const withoutVei = result.html.replace(`<script type="module" src="${input.editLauncherHref}"></script>`, "");

  const veiStyle = input.veiEnabled ? `<style>${VEI_PREVIEW_MARKER_CSS}</style>` : "";
  const inspectorStyle = input.inspectorEnabled ? `<style>${INSPECTOR_PREVIEW_MARKER_CSS}</style>` : "";
  const headExtras =
    `<base href="${input.buildInput.origin}/">` +
    buildPreviewStorageShimScript() +
    (result.jsAssets.length > 0 ? `<script type="importmap">${JSON.stringify(importMap).replace(/</g, "\\u003c")}</script>` : "") +
    veiStyle +
    inspectorStyle;
  const withBase = withoutVei.replace("<head>", `<head>${headExtras}`);

  const bridgeScript = buildPreviewBridgeScript({ vei: input.veiEnabled, runtimeVeiToggle: input.runtimeVeiToggle, inspector: input.inspectorEnabled });
  const withBridgeScript = withBase.includes("</body>") ? withBase.replace("</body>", `${bridgeScript}</body>`) : withBase + bridgeScript;

  return { html: withBridgeScript, jsAssets: result.jsAssets, deps: result.deps, inSitemap: result.inSitemap, blobUrls: [] };
}
