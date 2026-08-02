import { readEnvVar } from "../server/options.js";

/**
 * Reversible AES-256-GCM encryption for `secretkey` field values (see
 * `content-types/field-registry.ts`'s `secretKeyFieldType`) - unlike
 * `password` (hashed one-way, for login credentials), a secret key must be
 * recoverable server-side to actually use it (e.g. calling a third-party API
 * with it), just never sent back to a client as plaintext.
 *
 * Built on Web Crypto (`crypto.subtle`) rather than `node:crypto` because the
 * content engine already runs on two different backends
 * (`content-types/engine/sqlite.ts` and `.../d1.ts`) - the D1 one runs inside
 * Cloudflare Workers, where only Web Crypto is available. Web Crypto is
 * inherently async, which is why these aren't wired up as a
 * `FieldTypeDefinition.serialize`/`deserialize` pair (those are synchronous,
 * used today only for DDL `DEFAULT`-literal encoding in `migration.ts`) -
 * a future entry-CRUD read/write path is expected to `await` these directly.
 */

const VERSION_PREFIX = "v1:";
const IV_BYTES = 12;

let cachedPassphrase: string | undefined;
let cachedKeyPromise: Promise<CryptoKey> | undefined;

/** Exported so `lib/password-hash.ts` doesn't need its own copy - both modules
 * store a self-contained "version tag + base64 payload" string for the same
 * Web-Crypto-only-runtime reason documented above. */
export function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64Decode(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Derives a 256-bit AES key from `DRYCMS_SECRET_KEY` (any human-provided
 * passphrase string, hashed with SHA-256 - friendlier to configure than
 * requiring raw key bytes). The cache is tied to the effective passphrase,
 * rather than only to the process lifetime: Vite SSR/HMR and tests can reload
 * environment configuration without restarting the Node process. */
async function getKey(): Promise<CryptoKey> {
  const passphrase = readEnvVar("DRYCMS_SECRET_KEY");
  if (!passphrase) {
    throw new Error(
      '[drycms] A "secretkey" field requires a `DRYCMS_SECRET_KEY` env var (any secret string - used to derive the encryption key).',
    );
  }

  if (!cachedKeyPromise || cachedPassphrase !== passphrase) {
    cachedPassphrase = passphrase;
    cachedKeyPromise = (async () => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passphrase));
      return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    })();
  }
  return cachedKeyPromise;
}

/** Encrypts `plain` into a self-contained, storable string: a version tag (in
 * case the scheme ever needs to change) followed by base64 of `iv || ciphertext`
 * - a fresh random IV every call, so encrypting the same plaintext twice
 * produces different output. */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv, 0);
  payload.set(ciphertext, iv.length);
  return VERSION_PREFIX + base64Encode(payload);
}

/** Inverse of `encryptSecret`. Throws if `stored` isn't shaped like this
 * module's own output (wrong version tag, truncated payload, wrong key) -
 * there is no silent fallback to plaintext. */
export async function decryptSecret(stored: string): Promise<string> {
  if (!stored.startsWith(VERSION_PREFIX)) {
    throw new Error("[drycms] Cannot decrypt secret: unrecognized payload format.");
  }
  const payload = base64Decode(stored.slice(VERSION_PREFIX.length));
  if (payload.length <= IV_BYTES) {
    throw new Error("[drycms] Cannot decrypt secret: payload too short.");
  }
  const iv = payload.slice(0, IV_BYTES);
  const ciphertext = payload.slice(IV_BYTES);
  const key = await getKey();
  const plainBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plainBytes);
}
