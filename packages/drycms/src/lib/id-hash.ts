/**
 * Reversible obfuscation (NOT encryption) for content-entry row ids: turns a
 * sequential SQLite `INTEGER PRIMARY KEY` into a short, non-sequential-looking
 * string for URLs/UI (`routes/content-entries.ts` is the only place that
 * calls this - the engine/codec/SQL layer always deals in real integers), so
 * `/content/user/aB3xZ9` doesn't reveal how many rows exist or let someone
 * walk `id+1` to enumerate every row. The internal constants below are fixed
 * and non-secret on purpose - this is the same "Sqids/Hashids"-style
 * obfuscation those libraries provide, not a security boundary. Real access
 * control is still permission enforcement, which the project has already
 * deliberately deferred (see `content-types/permissions.ts`).
 *
 * Built as a 4-round Feistel network over a 32-bit id, split into two 16-bit
 * halves - a Feistel network is bijective by construction regardless of how
 * "good" its per-round mixing function is, so `decodeEntryId` is guaranteed
 * to invert `encodeEntryId` for every id in range without the mixing
 * function itself needing to be invertible.
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length; // 62
// 62^6 (~5.68e10) comfortably covers every 32-bit id (max ~4.29e9), so every
// encoded id is at least this long regardless of magnitude - a 1-character
// hash for id=1 would otherwise give away that it's an early/small row.
const MIN_LENGTH = 6;
const HALF_BITS = 16;
const HALF_MASK = 0xffff;
const MAX_ID = 0xffffffff;
const ROUNDS = 4;
// Arbitrary odd round constants - only need to vary the mixing per round, not
// be cryptographically strong.
const ROUND_CONSTANTS = [0x9e37, 0x85eb, 0xc2b2, 0x27d5];

function mix(value: number, roundConstant: number): number {
  const mixed = (value * (roundConstant | 1)) & HALF_MASK;
  return ((mixed << 7) | (mixed >>> 9)) & HALF_MASK;
}

function feistelEncode(id: number): number {
  let left = (id >>> HALF_BITS) & HALF_MASK;
  let right = id & HALF_MASK;
  for (let round = 0; round < ROUNDS; round++) {
    const nextRight = left ^ mix(right, ROUND_CONSTANTS[round]!);
    left = right;
    right = nextRight;
  }
  return ((left << HALF_BITS) | right) >>> 0;
}

function feistelDecode(value: number): number {
  let left = (value >>> HALF_BITS) & HALF_MASK;
  let right = value & HALF_MASK;
  for (let round = ROUNDS - 1; round >= 0; round--) {
    const prevRight = left;
    const prevLeft = right ^ mix(left, ROUND_CONSTANTS[round]!);
    left = prevLeft;
    right = prevRight;
  }
  return ((left << HALF_BITS) | right) >>> 0;
}

function toBase62(value: number): string {
  let n = value >>> 0;
  let out = "";
  do {
    out = ALPHABET[n % BASE] + out;
    n = Math.floor(n / BASE);
  } while (n > 0);
  while (out.length < MIN_LENGTH) out = `${ALPHABET[0]}${out}`;
  return out;
}

function fromBase62(text: string): number | null {
  if (!text) return null;
  let n = 0;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit === -1) return null;
    n = n * BASE + digit;
    if (n > MAX_ID) return null;
  }
  return n;
}

/** Encodes a positive SQLite row id into a short, URL-safe, non-sequential
 * string. Throws for anything outside the supported 32-bit range - row
 * counts anywhere near that are not a realistic scenario for this feature. */
export function encodeEntryId(id: number): string {
  if (!Number.isInteger(id) || id < 0 || id > MAX_ID) {
    throw new Error(`[drycms] Cannot encode entry id ${id}: must be an integer between 0 and ${MAX_ID}.`);
  }
  return toBase62(feistelEncode(id));
}

/** Inverse of `encodeEntryId`. Returns `null` (never throws) for anything
 * that isn't a validly-shaped hash - malformed input from a tampered/guessed
 * URL is an expected case here, not exceptional. */
export function decodeEntryId(hash: string): number | null {
  const value = fromBase62(hash);
  if (value === null) return null;
  return feistelDecode(value);
}
