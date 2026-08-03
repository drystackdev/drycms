import { readEnvVar } from "../server/options.js";

/** Stateless JWT session token for the built-in `user` collection's login.
 * Uses HS256 with the application secret and standard `header.payload.signature`
 * encoding. The identity claims are self-contained, while auth-security's
 * server-side session records still control revocation before token expiry. */

const SESSION_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
const ISSUER = "drycms";
const AUDIENCE = "drycms-admin";

export interface SessionPayload {
  id: number;
  name: string;
  email: string;
}

export interface SessionTokenClaims extends SessionPayload {
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  tokenId: string;
  keyId: string;
}

export interface SignSessionOptions {
  sessionId: string;
}

interface JwtPayload {
  sub: string;
  name: string;
  email: string;
  iat: number;
  exp: number;
  jti: string;
  iss: string;
  aud: string;
  sid: string;
  kid: string;
}

let cachedKeyPromises = new Map<string, Promise<CryptoKey>>();

interface KeyRing {
  activeKid: string;
  keys: Record<string, string>;
}

function keyRing(): KeyRing {
  const validate = (keys: Record<string, string>): Record<string, string> => {
    for (const [kid, secret] of Object.entries(keys)) {
      if (new TextEncoder().encode(secret).length < 32) {
        throw new Error(`[drycms] JWT secret for key id "${kid}" must be at least 32 bytes.`);
      }
    }
    return keys;
  };
  const raw = readEnvVar("DRYCMS_JWT_KEYS_JSON");
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, unknown>;
      const valid = Object.fromEntries(Object.entries(keys).filter(([, value]) => typeof value === "string" && value.length > 0)) as Record<string, string>;
      const activeKid = readEnvVar("DRYCMS_JWT_ACTIVE_KID") ?? Object.keys(valid)[0];
      if (activeKid && valid[activeKid]) return { activeKid, keys: validate(valid) };
    } catch {
      throw new Error("[drycms] DRYCMS_JWT_KEYS_JSON must be a valid JSON object of key ids to secret strings.");
    }
  }
  const secret = readEnvVar("DRYCMS_SECRET_KEY");
  if (!secret) {
    throw new Error(
      "[drycms] Signing in requires a `DRYCMS_SECRET_KEY` env var (any secret string - used to sign session tokens).",
    );
  }
  return { activeKid: "default", keys: validate({ default: secret }) };
}

/** Derives an HMAC key from the same `DRYCMS_SECRET_KEY` env var
 * `secret-crypto.ts` already requires - one app secret, not a second env var
 * to configure. Cached for the life of the process, same as
 * `secret-crypto.ts`'s `getKey()`. */
function getKey(kid: string): Promise<CryptoKey> {
  const existing = cachedKeyPromises.get(kid);
  if (existing) return existing;
  const promise = (async () => {
      const passphrase = keyRing().keys[kid];
      if (!passphrase) throw new Error(`[drycms] Unknown JWT key id "${kid}".`);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passphrase));
      return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    })();
  cachedKeyPromises.set(kid, promise);
  return promise;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function base64UrlEncode(value: string): string {
  // `btoa` only accepts Latin-1. JWT claims are JSON/UTF-8, so encode the
  // string to bytes first; names such as "Trần" must remain valid claims.
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(JSON.stringify(value));
}

async function signBytes(input: string, kid: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await getKey(kid), new TextEncoder().encode(input)));
}

/** Signs a standard HS256 JWT. */
export async function signSession(payload: SessionPayload, options: SignSessionOptions): Promise<string> {
  const activeKid = keyRing().activeKid;
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT", kid: activeKid });
  const body = encodeJson({
    sub: String(payload.id),
    name: payload.name,
    email: payload.email,
    iat: now,
    exp: now + SESSION_MAX_AGE_MS / 1000,
    jti: crypto.randomUUID(),
    iss: ISSUER,
    aud: AUDIENCE,
    sid: options.sessionId,
    kid: activeKid,
  } satisfies JwtPayload);
  const signingInput = `${header}.${body}`;
  return `${signingInput}.${base64UrlEncode(String.fromCharCode(...await signBytes(signingInput, activeKid)))}`;
}

/** Verifies a JWT signature and required claims. Returns null for malformed,
 * tampered, expired, wrong-algorithm, or wrong-issuer tokens. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  const claims = await verifySessionClaims(token);
  if (!claims) return null;
  return { id: claims.id, name: claims.name, email: claims.email };
}

export async function verifySessionClaims(token: string): Promise<SessionTokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0])) as { alg?: unknown; typ?: unknown; kid?: unknown };
    const signed = JSON.parse(base64UrlDecode(parts[1])) as Partial<JwtPayload>;
    if (header.alg !== "HS256" || header.typ !== "JWT" || typeof header.kid !== "string" || signed.iss !== ISSUER || signed.aud !== AUDIENCE || signed.kid !== header.kid) return null;
    const expectedSignature = await signBytes(`${parts[0]}.${parts[1]}`, header.kid);
    const signatureBytes = Uint8Array.from(base64UrlDecode(parts[2]), (char) => char.charCodeAt(0));
    if (!timingSafeEqual(signatureBytes, expectedSignature)) return null;
    if (typeof signed.sub !== "string" || !/^\d+$/.test(signed.sub)) return null;
    if (typeof signed.name !== "string" || typeof signed.email !== "string" || typeof signed.jti !== "string" || typeof signed.sid !== "string" || !signed.sid) return null;
    if (typeof signed.iat !== "number" || typeof signed.exp !== "number" || signed.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      id: Number(signed.sub),
      name: signed.name,
      email: signed.email,
      sessionId: signed.sid,
      issuedAt: signed.iat,
      expiresAt: signed.exp,
      tokenId: signed.jti,
      keyId: signed.kid,
    };
  } catch {
    return null;
  }
}
