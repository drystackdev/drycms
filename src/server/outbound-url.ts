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
