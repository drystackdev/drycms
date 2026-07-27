/** UUID v4. `crypto.randomUUID()` only exists in a secure context (https or
 * localhost) - reaching the dev server over plain http via a LAN IP makes it
 * disappear ("crypto.randomUUID is not a function"), while
 * `crypto.getRandomValues()` has no such restriction, so that's the
 * fallback here instead of failing outright. */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
