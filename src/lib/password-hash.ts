import { base64Decode, base64Encode } from "./secret-crypto.js";

/**
 * One-way password hashing for the built-in `user` collection's `password`
 * field (see `content-types/seed.ts`) - unlike `secretkey` (reversible,
 * `secret-crypto.ts`), a login credential must never be recoverable, only
 * verifiable. Built on Web Crypto's PBKDF2 (not `node:crypto`'s `scrypt`/
 * `bcrypt`) for the same reason as `secret-crypto.ts`: the D1 content engine
 * runs inside Cloudflare Workers, where only Web Crypto is available.
 */

const VERSION_PREFIX = "v1:";
const SALT_BYTES = 16;
// OWASP's current minimum recommendation for PBKDF2-HMAC-SHA256.
const ITERATIONS = 210_000;
const KEY_BITS = 256;

async function deriveBits(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Constant-time comparison - a password hash check must not leak timing
 * information about how many leading bytes matched. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Hashes `plain` into a self-contained, storable string: a version tag (in
 * case the scheme ever needs to change), the random salt, and the derived
 * key, each base64-encoded - a fresh random salt every call, so hashing the
 * same password twice produces different output. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(plain, salt);
  return `${VERSION_PREFIX}${base64Encode(salt)}:${base64Encode(hash)}`;
}

/** Verifies `plain` against a `hashPassword` output. Returns `false` (never
 * throws) for anything that isn't shaped like this module's own output,
 * including a legacy/corrupt value - there is no silent fallback to a
 * plaintext comparison. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(VERSION_PREFIX)) return false;
  const [saltPart, hashPart] = stored.slice(VERSION_PREFIX.length).split(":");
  if (!saltPart || !hashPart) return false;
  const salt = base64Decode(saltPart);
  const expected = base64Decode(hashPart);
  const actual = await deriveBits(plain, salt);
  return timingSafeEqual(actual, expected);
}
