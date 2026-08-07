import type { DryRouteContext } from "./context.js";
import { getContentAdapters } from "./content-adapters.js";
import { GOOGLE_VERIFICATION_TYPE_ID } from "../content-types/system-fields.js";
import { mimeType } from "./route-helpers.js";

/**
 * Serves the `googleVerification` singleton's `content` at the exact
 * bare-root URL Google's HTML verification method requires
 * (`https://domain.com/<name>.html`) - a plain content-entry read, not a
 * file upload/storage adapter, so this behaves identically on every
 * `content.engine` (`sqlite` locally, `D1` on Cloudflare) with no extra
 * plumbing for either.
 *
 * Cheaply filtered before touching the DB: only a request shaped like a
 * single root-level `.html` file (no further path segment) even attempts
 * the `googleVerification` lookup, so ordinary page/asset requests pay
 * nothing.
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
  const googleVerificationType = allTypes.find((t) => t.id === GOOGLE_VERIFICATION_TYPE_ID);
  if (!googleVerificationType) return null;

  const row = await entries.getSingletonEntry(googleVerificationType, allTypes);
  const name = row?.value.name;
  const content = row?.value.content;
  if (typeof name !== "string" || !name || typeof content !== "string" || !content || pathname !== `/${name}`) {
    return null;
  }

  return new Response(content, {
    status: 200,
    headers: { "Content-Type": mimeType(name) },
  });
}
