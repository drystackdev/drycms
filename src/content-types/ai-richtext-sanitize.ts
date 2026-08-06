/**
 * Regex allow-list sanitizer for AI-authored RichText HTML (Magic Write) -
 * matches the dialect `RichTextField`'s own `html.ts` `importCleanHtml`
 * understands (`p`/`h2`-`h6`/`blockquote`/`ul`/`ol`/`li`/`strong`/`b`/`em`/
 * `i`/`u`/`a`/`br`/`img`), deliberately narrower than that importer's own
 * tolerance (no color spans, tables, grids, or dry components - not
 * something a first pass of Magic Write needs to author, see
 * `status/magic-write.md`). Pure string/regex, no DOM - this module runs on
 * BOTH the server (`ai-magic-write.ts`'s schema-driven validation) and the
 * client (`MagicWriteDialog.tsx`, right before committing a streamed
 * richtext field), and a DOM parser isn't available on the server without a
 * new dependency (`feedback_prefer_api_over_library.md`).
 *
 * This is NOT a general-purpose untrusted-HTML sanitizer - the input only
 * ever comes from our own model call, using our own system prompt's exact
 * dialect instructions. Its job is defense-in-depth against a misbehaving
 * or adversarially-prompted model (a stray `<script>`, an `onclick=`, a
 * `javascript:` link), not surviving hostile hand-crafted HTML the way a
 * library like DOMPurify would.
 */

const ALLOWED_TAG_ATTRS: Record<string, ReadonlySet<string>> = {
  p: new Set(),
  h2: new Set(),
  h3: new Set(),
  h4: new Set(),
  h5: new Set(),
  h6: new Set(),
  blockquote: new Set(),
  ul: new Set(),
  ol: new Set(),
  li: new Set(),
  strong: new Set(),
  b: new Set(),
  em: new Set(),
  i: new Set(),
  u: new Set(),
  br: new Set(),
  a: new Set(["href", "target"]),
  img: new Set(["src", "alt"]),
};

/** Tags dropped along with everything between their open/close - never just
 * unwrapped, unlike an ordinary disallowed tag (see `sanitizeAiRichTextHtml`'s
 * main replace pass), since their CONTENT is the dangerous part. */
const STRIP_WITH_CONTENT_TAGS = ["script", "style", "iframe", "object", "embed", "svg", "form", "noscript", "template"];

const TAG_RE = /<\/?([a-zA-Z][\w-]*)((?:\s+[^<>]*)?)\s*\/?>/g;

function extractAttr(attrText: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrText);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? "";
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `href` allow-list: a real link scheme, or a same-site relative/hash path -
 * rejects `javascript:`, `data:`, `vbscript:`, and anything else unlisted. */
function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return true;
  return trimmed.startsWith("/") || trimmed.startsWith("#");
}

/**
 * `allowedImageSrcs` is the closed set of storage paths the request actually
 * offered the model as context (see `status/magic-write.md` decision #3) -
 * an `<img>` whose `src` isn't an exact match is dropped outright rather than
 * trusting whatever path the model wrote. Phase 1 (no images yet) always
 * passes an empty set, so every `<img>` is stripped.
 */
export function sanitizeAiRichTextHtml(html: string, allowedImageSrcs: ReadonlySet<string> = new Set()): string {
  let out = html;
  for (const tag of STRIP_WITH_CONTENT_TAGS) {
    out = out.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}[^>]*/?\\s*>`, "gi"), "");
  }

  out = out.replace(TAG_RE, (full, rawTag: string, attrText: string) => {
    const tag = rawTag.toLowerCase();
    const isClosing = full.startsWith("</");
    const allowedAttrs = ALLOWED_TAG_ATTRS[tag];
    if (!allowedAttrs) return ""; // Unwrap: drop the tag itself, keep its inner text (untouched by this per-tag replace).
    if (isClosing) return `</${tag}>`;
    if (tag === "br") return "<br>";
    if (tag === "img") {
      const src = extractAttr(attrText, "src");
      if (!src || !allowedImageSrcs.has(src)) return "";
      const alt = extractAttr(attrText, "alt") ?? "";
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}">`;
    }
    if (tag === "a") {
      const href = extractAttr(attrText, "href");
      if (!href || !isSafeHref(href)) return "<a>";
      const target = extractAttr(attrText, "target");
      const targetAttr = target === "_blank" ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${escapeAttr(href)}"${targetAttr}>`;
    }
    return `<${tag}>`;
  });

  return out;
}
