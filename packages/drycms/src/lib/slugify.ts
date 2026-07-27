/** URL-friendly slug for a piece of display text - strips diacritics
 * (đ→d handled separately since NFD doesn't decompose it), lowercases, and
 * collapses anything that isn't a-z/0-9 into single hyphens. Used to derive
 * a technical name/slug from a human label (`SlugField`), not to be
 * confused with `content-types/naming.ts`'s SQL-identifier validation. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Same diacritic-stripping/lowercasing as `slugify`, but joins words in
 * camelCase instead of hyphenating - for contexts where the result must be a
 * bare identifier with no separator at all, e.g. a content-type field name
 * (`content-types/naming.ts`'s `validateFieldName` rejects both "-" and "_",
 * the latter being reserved as the flatten-prefix separator). "Số Tiền" →
 * "soTien" instead of `slugify`'s "so-tien". */
export function slugifyIdentifier(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words
    .map((word, i) => (i === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join("");
}
