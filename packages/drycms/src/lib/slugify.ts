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
