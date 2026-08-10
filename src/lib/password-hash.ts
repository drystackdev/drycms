import { scrypt as scryptCallback, type ScryptOptions } from "node:crypto";
import { base64Decode, base64Encode } from "./secret-crypto.js";

/**
 * One-way password hashing for the built-in `user` collection's `password`
 * field (see `content-types/seed.ts`) - unlike `secretkey` (reversible,
 * `secret-crypto.ts`), a login credential must never be recoverable, only
 * verifiable. Built on `node:crypto`'s `scrypt`, memory-hard rather than
 * iteration-hard - unlike Web Crypto's `subtle.deriveBits("PBKDF2", ...)`,
 * it carries no artificial 100,000-round platform cap on Cloudflare Workers.
 * Available on both adapters: `nodejs_compat` is already required in
 * `wrangler.jsonc` (for `node:stream` elsewhere in `src/server/**`), which
 * is what exposes `node:crypto` there too.
 */

function scrypt(password: string, salt: Uint8Array, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const PREFIX = "scrypt:";
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/**
 * Node's own `scrypt` defaults (N=16384, r=8, p=1) - about 16 MiB of working
 * memory per call, comfortably under both Node's default 32 MiB `maxmem` and
 * a Workers isolate's 128 MB budget. The cost params travel with the stored
 * hash (see `hashPassword`) so a future tuning change stays verifiable
 * against everything already stored.
 */
const N = 16_384;
const R = 8;
const P = 1;
const MAXMEM = 32 * 1024 * 1024;

async function deriveKey(password: string, salt: Uint8Array, n: number, r: number, p: number): Promise<Uint8Array> {
  const derived = await scrypt(password, salt, KEY_BYTES, { N: n, r, p, maxmem: MAXMEM });
  return new Uint8Array(derived);
}

/** Constant-time comparison - a password hash check must not leak timing
 * information about how many leading bytes matched. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Hashes `plain` into a self-contained, storable string: the cost
 * parameters, a random salt, and the derived key - a fresh random salt every
 * call, so hashing the same password twice produces different output. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveKey(plain, salt, N, R, P);
  return `${PREFIX}${N}:${R}:${P}:${base64Encode(salt)}:${base64Encode(hash)}`;
}

/** Verifies `plain` against a `hashPassword` output. Returns `false` (never
 * throws) for anything that isn't shaped like this module's own output -
 * there is no silent fallback to a plaintext comparison. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(PREFIX)) return false;
  const [nPart, rPart, pPart, saltPart, hashPart] = stored.slice(PREFIX.length).split(":");
  const n = Number(nPart);
  const r = Number(rPart);
  const p = Number(pPart);
  if (!saltPart || !hashPart || ![n, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
  try {
    const salt = base64Decode(saltPart);
    const expected = base64Decode(hashPart);
    const actual = await deriveKey(plain, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
