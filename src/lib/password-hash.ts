import { base64Decode, base64Encode } from "./secret-crypto.js";

/**
 * One-way password hashing for the built-in `user` collection's `password`
 * field (see `content-types/seed.ts`) - unlike `secretkey` (reversible,
 * `secret-crypto.ts`), a login credential must never be recoverable, only
 * verifiable. Built on Web Crypto's PBKDF2 (not `node:crypto`'s `scrypt`/
 * `bcrypt`) for the same reason as `secret-crypto.ts`: the D1 content engine
 * runs inside Cloudflare Workers, where only Web Crypto is available.
 */

const V1_PREFIX = "v1:";
const V2_PREFIX = "v2:";
const SALT_BYTES = 16;
/**
 * OWASP's current minimum for PBKDF2-HMAC-SHA256 is 210,000, which is what
 * `v1:` hashes were derived with. Cloudflare Workers rejects anything above
 * 100,000 outright (`NotSupportedError: Pbkdf2 failed: iteration counts
 * above 100000 are not supported`), so that ceiling - not the OWASP figure -
 * is the most this scheme can use on the runtime the D1 content engine
 * targets. Workers offers no scrypt/argon2 to trade up to either, so the cap
 * is a platform limit rather than a choice.
 */
const ITERATIONS = 100_000;
/** What every `v1:` hash was derived with, back when the count wasn't part
 * of the stored string. Only ever used to verify one, never to write one. */
const V1_ITERATIONS = 210_000;
const KEY_BITS = 256;

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
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

/** Hashes `plain` into a self-contained, storable string: a version tag, the
 * iteration count, the random salt, and the derived key - a fresh random salt
 * every call, so hashing the same password twice produces different output.
 * `v2:` carries the iteration count so a future change to `ITERATIONS` stays
 * verifiable against everything already stored, which `v1:` (a bare
 * `salt:hash`, count implied by a constant) could not survive. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(plain, salt, ITERATIONS);
  return `${V2_PREFIX}${ITERATIONS}:${base64Encode(salt)}:${base64Encode(hash)}`;
}

/** Verifies `plain` against a `hashPassword` output, in either format.
 * Returns `false` (never throws) for anything that isn't shaped like this
 * module's own output, including a legacy/corrupt value - there is no silent
 * fallback to a plaintext comparison. The try/catch also covers a `v1:` hash
 * being verified ON WORKERS, where its 210,000 iterations exceed the
 * platform cap and `deriveBits` rejects: unverifiable there, so `false` is
 * the honest answer, and it must not surface as a 500. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  try {
    const actual = await deriveBits(plain, parsed.salt, parsed.iterations);
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  expected: Uint8Array;
}

function parseStored(stored: string): ParsedHash | null {
  try {
    if (stored.startsWith(V2_PREFIX)) {
      const [iterationsPart, saltPart, hashPart] = stored.slice(V2_PREFIX.length).split(":");
      const iterations = Number(iterationsPart);
      if (!saltPart || !hashPart || !Number.isInteger(iterations) || iterations <= 0) return null;
      return { iterations, salt: base64Decode(saltPart), expected: base64Decode(hashPart) };
    }
    if (stored.startsWith(V1_PREFIX)) {
      const [saltPart, hashPart] = stored.slice(V1_PREFIX.length).split(":");
      if (!saltPart || !hashPart) return null;
      return { iterations: V1_ITERATIONS, salt: base64Decode(saltPart), expected: base64Decode(hashPart) };
    }
    return null;
  } catch {
    return null;
  }
}
