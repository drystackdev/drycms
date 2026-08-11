/** Validate a user-configurable upstream URL before the server makes a
 * request. This is intentionally conservative: provider URLs may be public
 * HTTP(S) endpoints in development, but loopback, link-local, private, local
 * and metadata destinations are never valid AI providers. DNS rebinding still
 * needs to be prevented at the deployment's egress/proxy layer. */
export function validateOutboundUrl(raw: string, label = "URL"): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`${label} must use HTTP or HTTPS.`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain credentials.`);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname === "metadata.google.internal") {
    throw new Error(`${label} points to a private or local destination.`);
  }
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) throw new Error(`${label} points to a private or local destination.`);
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

/** Validate again against DNS answers immediately before a server-side fetch.
 * Literal checks alone are vulnerable when an attacker controls a hostname
 * that resolves to a private address (including a DNS-rebinding target).
 * Workers deployments should enforce the same rule at their egress layer;
 * Node performs the additional lookup here. */
export async function validateOutboundUrlForRequest(raw: string, label = "URL"): Promise<string> {
  const value = validateOutboundUrl(raw, label);
  if (typeof process === "undefined" || !process.versions?.node) return value;

  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) return value;
  try {
    const { lookup } = await import("node:dns/promises");
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateIpv4(address) || isPrivateIpv6(address))) {
      throw new Error(`${label} points to a private or local destination.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("private or local")) throw error;
    throw new Error(`${label} hostname could not be resolved safely.`);
  }
  return value;
}

/** Fetch without ever following a redirect, treating a redirect response the
 * same as a hard failure. Workers (workerd) fetch only implements
 * `redirect: "follow"` or `"manual"` - `"error"` throws "Invalid redirect
 * value" at request time - so a redirect has to be rejected by inspecting
 * the response instead. This is what actually enforces
 * `validateOutboundUrlForRequest`'s checks end-to-end: that function only
 * sees the URL the caller entered, not a redirect target the upstream could
 * point at afterward. */
export async function fetchNoRedirect(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: "manual" });
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new Error("Server refused to follow a redirect from the upstream URL.");
  }
  return response;
}

/** Like `fetchNoRedirect`, but follows exactly one redirect - common for a
 * caller-supplied `http://` URL a host 301s to its own `https://` origin.
 * Safe unlike a plain `redirect: "follow"`: the `Location` target goes back
 * through `validateOutboundUrlForRequest` (the same check the original URL
 * passed) before it's ever fetched, so a redirect can't be used to reach a
 * private/local destination the caller couldn't have named directly. A
 * second redirect (or a `Location`-less redirect response) still fails hard,
 * via `fetchNoRedirect`'s own check on the second hop. */
export async function fetchAllowingOneRedirect(url: string, init: RequestInit = {}, label = "URL"): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: "manual" });
  const isRedirect = response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
  if (!isRedirect) return response;
  const location = response.headers.get("location");
  if (!location) throw new Error("Server refused to follow a redirect from the upstream URL.");
  const target = await validateOutboundUrlForRequest(new URL(location, url).toString(), label);
  return fetchNoRedirect(target, init);
}

function isPrivateIpv4(hostname: string): boolean {
  if (/^\d+$/.test(hostname)) return true;
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part > 255)) return false;
  const first = numbers[0]!;
  const second = numbers[1]!;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) || (first === 198 && (second === 18 || second === 19)) || first >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  const value = hostname.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") ||
    /^(fe[89ab]):/.test(value) || value.includes("ffff:") || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") ||
    value.startsWith("::ffff:192.168.") || value.startsWith("::ffff:169.254.");
}
