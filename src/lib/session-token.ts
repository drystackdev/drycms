import { readEnvVar } from "../server/options.js";

/** Stateless JWT session token for the built-in `user` collection's login.
 * Uses HS256 with the application secret and standard `header.payload.signature`
 * encoding. The token remains self-contained so session checks do not need to
 * re-query the user row; the KV-backed session blacklist handles revocation. */

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ISSUER = "drycms";

export interface SessionPayload {
  id: number;
  name: string;
  email: string;
}

interface JwtPayload {
  sub: string;
  name: string;
  email: string;
  iat: number;
  exp: number;
  jti: string;
  iss: string;
}

let cachedKeyPromise: Promise<CryptoKey> | undefined;

/** Derives an HMAC key from the same `DRYCMS_SECRET_KEY` env var
 * `secret-crypto.ts` already requires - one app secret, not a second env var
 * to configure. Cached for the life of the process, same as
 * `secret-crypto.ts`'s `getKey()`. */
function getKey(): Promise<CryptoKey> {
  if (!cachedKeyPromise) {
    cachedKeyPromise = (async () => {
      const passphrase = readEnvVar("DRYCMS_SECRET_KEY");
      if (!passphrase) {
        throw new Error(
          "[drycms] Signing in requires a `DRYCMS_SECRET_KEY` env var (any secret string - used to sign session tokens).",
        );
      }
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passphrase));
      return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    })();
  }
  return cachedKeyPromise;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function base64UrlEncode(value: string): string {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return atob(padded);
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(JSON.stringify(value));
}

async function signBytes(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await getKey(), new TextEncoder().encode(input)));
}

/** Signs a standard HS256 JWT. */
export async function signSession(payload: SessionPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const body = encodeJson({
    sub: String(payload.id),
    name: payload.name,
    email: payload.email,
    iat: now,
    exp: now + SESSION_MAX_AGE_MS / 1000,
    jti: crypto.randomUUID(),
    iss: ISSUER,
  } satisfies JwtPayload);
  const signingInput = `${header}.${body}`;
  return `${signingInput}.${base64UrlEncode(String.fromCharCode(...await signBytes(signingInput)))}`;
}

/** Verifies a JWT signature and required claims. Returns null for malformed,
 * tampered, expired, wrong-algorithm, or wrong-issuer tokens. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0])) as { alg?: unknown; typ?: unknown };
    const signed = JSON.parse(base64UrlDecode(parts[1])) as Partial<JwtPayload>;
    if (header.alg !== "HS256" || header.typ !== "JWT" || signed.iss !== ISSUER) return null;
    const expectedSignature = await signBytes(`${parts[0]}.${parts[1]}`);
    const signatureBytes = Uint8Array.from(base64UrlDecode(parts[2]), (char) => char.charCodeAt(0));
    if (!timingSafeEqual(signatureBytes, expectedSignature)) return null;
    if (typeof signed.sub !== "string" || !/^\d+$/.test(signed.sub)) return null;
    if (typeof signed.name !== "string" || typeof signed.email !== "string" || typeof signed.jti !== "string") return null;
    if (typeof signed.iat !== "number" || typeof signed.exp !== "number" || signed.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: Number(signed.sub), name: signed.name, email: signed.email };
  } catch {
    return null;
  }
}
