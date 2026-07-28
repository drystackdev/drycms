interface Props {
  /** Any image URL a CSS `mask-image` accepts - an `/api/icons/*.svg` URL, a
   * `blob:` object URL, or a `data:image/svg+xml,...` URI. */
  src: string;
  /** Rendered size in px (both width and height). @default 24 */
  size?: number;
  class?: string;
}

/**
 * Renders an SVG icon of unknown/untrusted provenance so it correctly tints
 * with the surrounding `currentColor` (most Iconify icons draw with
 * `fill="currentColor"`, which a plain `<img src>` can't inherit - the SVG
 * decodes in its own image context, not the page's). Same CSS-mask technique
 * as the `<i>` snippet `IconPreviewDialog` generates for copy-paste.
 *
 * Deliberately still not `dangerouslySetInnerHTML`: a mask-image source is
 * decoded by the browser's image renderer, same as an `<img>` - embedded
 * `<script>`/event-handler content there never executes, regardless of
 * whether `sanitizeSvg` missed something. The one real cost is visual, not
 * security: multi-color/duotone icons collapse to a single solid
 * `currentColor` silhouette, since a mask has no notion of the source's own
 * colors - the same limitation already noted on the preview dialog's snippet.
 */
export default function IconGlyph({ src, size = 24, class: className }: Props) {
  const mask = `url('${src}') no-repeat center / contain`;
  return (
    <span
      aria-hidden="true"
      class={className}
      style={{
        display: "inline-block",
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: "currentColor",
        WebkitMask: mask,
        mask,
      }}
    />
  );
}
