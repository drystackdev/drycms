/**
 * Hand-rolled allowlist sanitizer for SVG markup, used before every disk
 * write in the Icon Management feature (manual paste and Iconify import
 * alike) - both flows persist arbitrary/third-party SVG that later gets
 * served back and displayed, so this is the one gate standing between
 * attacker-controlled markup and a stored-XSS vector (`<script>`,
 * `on*` handlers, `<foreignObject>`, external `href`/`xlink:href`).
 *
 * This is a single-pass, quote-aware tag scanner over the raw string, not a
 * real XML/DOM parser - deliberately, so no extra runtime dependency is
 * needed (a real DOM implementation was tried and rejected: linkedom doesn't
 * implement enough of `Document` for DOMPurify to actually run, and
 * happy-dom's SVG-namespace handling stripped legitimate content instead of
 * just the malicious parts - only jsdom worked correctly, and was judged not
 * worth the ~70 transitive packages for this feature). Known simplification:
 * malformed/adversarial nesting is handled failsafe (over-suppress rather
 * than under-suppress - see `scan()`'s `suppressDepth` accounting) rather
 * than spec-perfectly recovered the way a real parser would.
 */

export class IconValidationError extends Error {}

/** Lowercase tag name -> canonical markup case. Only tags in this map survive
 * sanitization; everything else (including their entire subtree - `script`,
 * `style`, `foreignObject`, `image`, `a`, any SMIL `animate*`/`set`,
 * `iframe`/`object`/`embed`/`video`/`audio`, filter primitives, unknown/custom
 * tags) is dropped along with its content. No scripting, no animation, no
 * filters, no embedding/foreign content, no external raster - just the
 * static vector-shape primitives an Iconify icon body or a hand-drawn icon
 * actually needs. */
const ALLOWED_TAGS: ReadonlyMap<string, string> = new Map(
  [
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "textPath", "defs", "symbol", "use", "clipPath", "mask",
    "pattern", "linearGradient", "radialGradient", "stop", "marker", "title", "desc",
  ].map((name) => [name.toLowerCase(), name]),
);

/** Lowercase attribute name -> canonical markup case. `style` is deliberately
 * excluded even though DOMPurify's default SVG profile allows it - inline CSS
 * is extra attack surface (`url(javascript:...)`-style tricks in older
 * engines) that no Iconify icon body or hand-drawn icon actually needs;
 * presentation attributes cover the same ground. `href`/`xlink:href` are
 * handled separately below (kept only when the value is a local `#fragment`
 * reference) rather than being unconditionally allowed here. */
const ALLOWED_ATTRS: ReadonlyMap<string, string> = new Map(
  [
    "id", "class",
    "d", "fill", "fill-rule", "fill-opacity",
    "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "stroke-miterlimit",
    "opacity", "transform",
    "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2",
    "cx", "cy", "r", "rx", "ry", "points",
    "offset", "stop-color", "stop-opacity",
    "gradientUnits", "gradientTransform", "patternUnits", "patternTransform", "patternContentUnits",
    "clip-path", "clip-rule", "mask",
    "xmlns", "xmlns:xlink", "version", "preserveAspectRatio",
    "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline",
    "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "spreadMethod",
    "role", "aria-hidden", "aria-label", "focusable",
  ].map((name) => [name.toLowerCase(), name]),
);

/** Kept separate from `ALLOWED_ATTRS`: the only attributes allowed to carry a
 * URL-shaped value, and only when that value is a same-document `#fragment`
 * reference - the exact `<use href="#localId">` pattern real Iconify icon
 * bodies use for shared `<defs>` shapes (confirmed on `solar:home-bold`).
 * Anything else (`http(s):`, `data:`, `javascript:`, a bare relative path)
 * is dropped, not rewritten - there's no legitimate reason a static icon
 * needs to reference an external resource. */
const HREF_ATTRS = new Set(["href", "xlink:href"]);

interface StackEntry {
  /** Whether this tag itself is in `ALLOWED_TAGS` - decides whether its own
   * open/close tags are emitted, and (independently of any ancestor's state)
   * increments/decrements `suppressDepth` while it's open. */
  allowed: boolean;
  /** Whether the opening tag was actually written to the output - `false`
   * either because the tag itself isn't allowed, or an ancestor is being
   * suppressed. The matching close tag must make the same decision, which is
   * why it's captured here instead of recomputed at close time (`suppressDepth`
   * may have changed by then). */
  emitted: boolean;
}

function findTagEnd(source: string, ltIndex: number): number {
  let i = ltIndex + 1;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
    i++;
  }
  return -1;
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;

/** Parses `attrsSource` (the raw text between a tag's name and its closing
 * `>`/`/>`) into a filtered, re-serialized attribute string - unknown
 * attributes silently dropped, `href`/`xlink:href` kept only for local
 * `#fragment` values, everything else canonical-cased per `ALLOWED_ATTRS`. */
function filterAttrs(attrsSource: string): string {
  let out = "";
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(attrsSource))) {
    const rawName = match[1]!;
    const rawValue = match[2]!;
    const lowerName = rawName.toLowerCase();
    const quoted = rawValue.startsWith('"') || rawValue.startsWith("'");
    const value = quoted ? rawValue.slice(1, -1) : rawValue;

    if (HREF_ATTRS.has(lowerName)) {
      if (value.trim().startsWith("#")) out += ` ${rawName}="${value}"`;
      continue;
    }

    // Belt-and-suspenders: `on*` handlers are never in `ALLOWED_ATTRS`
    // anyway, but reject them explicitly rather than relying solely on
    // allowlist absence.
    if (lowerName.startsWith("on")) continue;

    const canonical = ALLOWED_ATTRS.get(lowerName);
    if (!canonical) continue;
    out += ` ${canonical}="${value}"`;
  }
  return out;
}

/**
 * Sanitizes raw SVG markup down to a safe, allowlisted subset. Throws
 * `IconValidationError` if the input doesn't contain a recognizable `<svg`
 * root to begin with, or if nothing survives sanitization (e.g. the input was
 * entirely `<script>`/junk) - callers should surface that as a 400, never
 * write an empty/garbage file.
 */
export function sanitizeSvg(raw: string): string {
  if (!/<svg[\s>]/i.test(raw)) {
    throw new IconValidationError("Input does not contain an <svg> root element.");
  }

  let out = "";
  let sawAllowedRoot = false;
  let suppressDepth = 0;
  const stack: StackEntry[] = [];

  let i = 0;
  while (i < raw.length) {
    const lt = raw.indexOf("<", i);
    if (lt === -1) {
      if (suppressDepth === 0) out += raw.slice(i);
      break;
    }
    if (suppressDepth === 0 && lt > i) out += raw.slice(i, lt);

    // Comments, CDATA, doctype and processing instructions are all dropped
    // outright (never emitted) - none of them carry anything a static icon
    // needs, and stripping them removes a class of parser-confusion tricks
    // for free.
    if (raw.startsWith("<!--", lt)) {
      const end = raw.indexOf("-->", lt + 4);
      i = end === -1 ? raw.length : end + 3;
      continue;
    }
    if (raw.startsWith("<![CDATA[", lt)) {
      const end = raw.indexOf("]]>", lt + 9);
      i = end === -1 ? raw.length : end + 3;
      continue;
    }
    if (raw.startsWith("<!", lt) || raw.startsWith("<?", lt)) {
      const end = raw.indexOf(">", lt);
      i = end === -1 ? raw.length : end + 1;
      continue;
    }

    const tagEnd = findTagEnd(raw, lt);
    if (tagEnd === -1) {
      // Unterminated tag - nothing safe to do with the remainder.
      break;
    }
    const tagBody = raw.slice(lt + 1, tagEnd); // between `<` and `>`, exclusive
    i = tagEnd + 1;

    const closing = tagBody.startsWith("/");
    const selfClosing = tagBody.endsWith("/");
    const nameMatch = /^\/?\s*([a-zA-Z][-a-zA-Z0-9:._]*)/.exec(tagBody);
    if (!nameMatch) continue; // malformed `<>`/`</>` - ignore
    const lowerName = nameMatch[1]!.toLowerCase();

    if (closing) {
      const entry = stack.pop();
      if (!entry) continue;
      if (entry.emitted) out += `</${ALLOWED_TAGS.get(lowerName) ?? lowerName}>`;
      if (!entry.allowed) suppressDepth--;
      continue;
    }

    const allowed = ALLOWED_TAGS.has(lowerName);
    const emit = allowed && suppressDepth === 0;
    if (emit) {
      const canonicalName = ALLOWED_TAGS.get(lowerName)!;
      const attrsSource = tagBody.slice(nameMatch[0].length, selfClosing ? -1 : undefined);
      out += `<${canonicalName}${filterAttrs(attrsSource)}${selfClosing ? " />" : ">"}`;
      if (canonicalName === "svg" && stack.length === 0) sawAllowedRoot = true;
    }

    if (!selfClosing) {
      stack.push({ allowed, emitted: emit });
      if (!allowed) suppressDepth++;
    }
  }

  if (!sawAllowedRoot) {
    throw new IconValidationError("Nothing safe survived sanitization - input was not a valid icon SVG.");
  }
  return out;
}
