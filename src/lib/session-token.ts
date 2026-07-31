import { readEnvVar } from "../server/options.js";
import { base64Decode, base64Encode } from "./secret-crypto.js";

/**
 * Stateless, signed session token for the built-in `user` collection's login
 * (see `content-types/seed.ts`) - no session table, so this works
 * identically across all 3 content engines (including the D1/Workers one,
 * where only Web Crypto is available, same reasoning as `secret-crypto.ts`/
 * `password-hash.ts`). The signed payload carries the fields the UI needs to
 * display (name/email) so a session check never has to re-query the `user`
 * row - the tradeoff is a renamed/re-emailed user shows the stale value here
 * until their next login.
 */

const VERSION_PREFIX = "v1:";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionPayload {
  id: number;
  name: string;
  email: string;
}

interface SignedPayload extends SessionPayload {
  iat: number;
  exp: number;
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

/** Signs `payload` into a self-contained, storable string: a version tag
 * followed by base64 of the JSON payload and base64 of its HMAC, dot-joined -
 * matches the "version tag + base64 payload" shape `password-hash.ts`/
 * `secret-crypto.ts` already use. */
export async function signSession(payload: SessionPayload): Promise<string> {
  const key = await getKey();
  const now = Date.now();
  const signed: SignedPayload = { ...payload, iat: now, exp: now + SESSION_MAX_AGE_MS };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(signed));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, payloadBytes));
  return `${VERSION_PREFIX}${base64Encode(payloadBytes)}.${base64Encode(signature)}`;
}

/** Verifies `token` against `signSession`'s output. Returns `null` (never
 * throws) for anything that isn't shaped like this module's own output,
 * including a tampered, malformed, or expired token - same "no silent
 * fallback" contract as `password-hash.ts`'s `verifyPassword`. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  if (!token.startsWith(VERSION_PREFIX)) return null;
  const [payloadPart, signaturePart] = token.slice(VERSION_PREFIX.length).split(".");
  if (!payloadPart || !signaturePart) return null;

  let payloadBytes: Uint8Array;
  let signature: Uint8Array;
  try {
    payloadBytes = base64Decode(payloadPart);
    signature = base64Decode(signaturePart);
  } catch {
    return null;
  }

  const key = await getKey();
  const expectedSignature = new Uint8Array(await crypto.subtle.sign("HMAC", key, payloadBytes as BufferSource));
  if (!timingSafeEqual(signature, expectedSignature)) return null;

  let signed: SignedPayload;
  try {
    signed = JSON.parse(new TextDecoder().decode(payloadBytes)) as SignedPayload;
  } catch {
    return null;
  }
  if (typeof signed.exp !== "number" || Date.now() > signed.exp) return null;
  if (typeof signed.id !== "number" || typeof signed.name !== "string" || typeof signed.email !== "string") {
    return null;
  }
  return { id: signed.id, name: signed.name, email: signed.email };
}
