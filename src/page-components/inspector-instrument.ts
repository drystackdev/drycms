import ts from "typescript";

/**
 * Page Builder's "click/hover to jump between preview and code" feature
 * (`status/page-builder-code-preview-sync.md`). Injects a `data-dry-loc`
 * attribute onto every JSX HOST element's opening tag (`<div>`, not a
 * component like `<Card>` - a component doesn't reliably correspond to one
 * DOM node) recording where that element's own JSX node starts and ends in
 * the ORIGINAL, unmodified source text. The preview iframe's bridge script
 * reads that attribute back to answer "what source range does this DOM
 * node come from" (hover) and "which DOM node does this source range cover"
 * (cursor), both purely client-side - no server round trip.
 *
 * Splices the attribute text directly into the source STRING at each tag's
 * computed offset (descending order, so earlier offsets stay valid) rather
 * than going through `ts.createPrinter` - the rest of the file's formatting,
 * comments and whitespace come through completely untouched, which matters
 * because this instrumented text is what actually gets compiled and shown
 * running in the preview (`page-preview-engine.ts`'s `buildPreviewSrcdoc`).
 *
 * Only ever runs against a throwaway COPY of `sourceByPath` used for the
 * live preview build - never against the real file in `pagesSourceStorage`,
 * and never against `buildPage`'s real "Build & publish" path
 * (`initial-publish.ts`/`rebuild-affected-pages.ts` don't call this), so a
 * published page's HTML never carries `data-dry-loc`.
 */

const LOC_ATTR = "data-dry-loc";

interface Insertion {
  offset: number;
  text: string;
}

function lineCol(sourceFile: ts.SourceFile, pos: number): { line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
  return { line: line + 1, column: character + 1 };
}

/** Only intrinsic elements (`div`, `img`...) - a capitalized tag is a
 * component and a `Foo.Bar`/namespaced tag isn't a plain identifier either,
 * neither of which map to exactly one DOM node the way an intrinsic
 * element's own opening tag does. */
function isHostTagName(tagName: ts.JsxTagNameExpression): tagName is ts.Identifier {
  return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text);
}

function collectInsertions(sourceFile: ts.SourceFile, path: string, node: ts.Node, insertions: Insertion[]): void {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tagName = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
    if (isHostTagName(tagName)) {
      const start = lineCol(sourceFile, node.getStart(sourceFile));
      const end = lineCol(sourceFile, node.getEnd());
      const loc = `${path}:${start.line}:${start.column}:${end.line}:${end.column}`;
      insertions.push({ offset: tagName.getEnd(), text: ` ${LOC_ATTR}=${JSON.stringify(loc)}` });
    }
  }
  node.forEachChild((child) => collectInsertions(sourceFile, path, child, insertions));
}

/**
 * Returns `source` unchanged (never throws) if it doesn't parse - this runs
 * on every keystroke's debounced preview rebuild, including on source the
 * user is still actively typing mid-syntax-error. The real compile step
 * right after this (`compileEsmAsset`'s `sucrase` pass) is what surfaces
 * that error to the user; this function's only job is to not be the thing
 * that crashes the preview instead.
 */
export function instrumentJsxSource(path: string, source: string): string {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  } catch {
    return source;
  }
  const insertions: Insertion[] = [];
  try {
    collectInsertions(sourceFile, path, sourceFile, insertions);
  } catch {
    return source;
  }
  if (insertions.length === 0) return source;
  insertions.sort((a, b) => b.offset - a.offset);
  let result = source;
  for (const { offset, text } of insertions) {
    result = result.slice(0, offset) + text + result.slice(offset);
  }
  return result;
}

/** Batch form - only `.tsx` entries are parsed, everything else (styles,
 * `.ts` helper modules with no JSX) passes through untouched. */
export function instrumentJsxSources(sourceByPath: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, source] of Object.entries(sourceByPath)) {
    result[path] = path.endsWith(".tsx") ? instrumentJsxSource(path, source) : source;
  }
  return result;
}
