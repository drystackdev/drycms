import { Readable } from "node:stream";
import type { DryRouteContext } from "./context.js";
import { getContentAdapters } from "./content-adapters.js";
import { getStorageAdapter } from "./storage-adapters.js";
import { storage } from "./config.js";
import { SEO_DEFAULTS_TYPE_ID } from "../content-types/system-fields.js";
import { mimeType } from "./route-helpers.js";
import { StorageError } from "../storage/types.js";

/**
 * Serves the `seoDefaults.googleSiteVerificationFile` upload at the exact
 * bare-root URL Google's HTML verification method requires
 * (`https://domain.com/<filename>.html`), by reading it live through
 * whatever storage adapter is actually configured - unlike the `kind:
 * "local"` backend's `public/`-as-storage-root trick (`options.ts`'s
 * `resolveStorageOption`), this also works for `kind: "r2"`, whose objects
 * live under a `storage/` key prefix with no bare-root HTTP access at all,
 * and as a side effect also fixes `kind: "local"` in production for a file
 * uploaded AFTER the last build (`dist/client` is a build-time snapshot -
 * see `entry-node.ts`'s `tryServeStaticAsset` - while this reads straight
 * off the adapter's live root on every request).
 *
 * Cheaply filtered before touching the DB: only a request shaped like a
 * single root-level `.html` file (no further path segment) even attempts
 * the `seoDefaults` lookup, so ordinary page/asset requests pay nothing.
 */
export async function tryServeGoogleVerificationFile(
  request: Request,
  context: DryRouteContext,
): Promise<Response | null> {
  const pathname = context.url.pathname;
  if (request.method !== "GET" || !pathname.endsWith(".html") || pathname.slice(1).includes("/")) {
    return null;
  }

  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const seoDefaultsType = allTypes.find((t) => t.id === SEO_DEFAULTS_TYPE_ID);
  if (!seoDefaultsType) return null;

  const row = await entries.getSingletonEntry(seoDefaultsType, allTypes);
  const value = row?.value.googleSiteVerificationFile;
  // A bare relative storage id only (see `field-registry.ts`'s
  // `fileFieldType` doc comment) - anything containing "/" is either a
  // sub-folder upload (unsupported by Google's root-only requirement) or an
  // external link, neither of which this route root-serves.
  if (typeof value !== "string" || !value || value.includes("/") || pathname !== `/${value}`) {
    return null;
  }

  try {
    const adapter = getStorageAdapter(storage, context);
    const file = await adapter.read(value);
    return new Response(Readable.toWeb(file.stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": mimeType(value),
        "Content-Length": String(file.size),
        "Last-Modified": new Date(file.modifiedAt).toUTCString(),
      },
    });
  } catch (error) {
    if (error instanceof StorageError) return null;
    throw error;
  }
}
