import { path } from "../../../server/config.js";
import { encodePath } from "../../../storage/http-source.js";

/**
 * Resolves an `image`-typed field's stored value into a servable `<img
 * src>`. The value is either a bare relative storage id (e.g. "hero.jpg",
 * resolved through the storage API) or a raw Link URL typed in the picker's
 * "Link" tab (already absolute/root-relative, stored verbatim) - mirrors
 * the admin's own resolution in `ContentEntryList.tsx`.
 */
export function imageSrc(value: string): string {
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
  return `${path}/api/storage/${encodePath(value)}`;
}
