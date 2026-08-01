import { KeyValueError } from "./types.js";

export const DEFAULT_MAX_VALUE_BYTES = 1024 * 1024;

export function assertKvPart(value: string, label: string): void {
  if (!value || value.length > 255 || value.includes("\u0000")) {
    throw new KeyValueError("invalid_key", `${label} must be 1-255 characters and cannot contain NUL.`);
  }
}

export function encodeValue(value: unknown, maxBytes = DEFAULT_MAX_VALUE_BYTES): { json: string; sizeBytes: number } {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new KeyValueError("invalid_value", `Value is not JSON serializable: ${error instanceof Error ? error.message : "unknown error"}.`);
  }
  if (json === undefined) throw new KeyValueError("invalid_value", "Value must be JSON serializable.");
  const sizeBytes = new TextEncoder().encode(json).byteLength;
  if (sizeBytes > maxBytes) {
    throw new KeyValueError("invalid_value", `Value exceeds the ${maxBytes}-byte limit.`);
  }
  return { json, sizeBytes };
}

export function decodeValue(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new KeyValueError("invalid_value", "Stored value is not valid JSON.");
  }
}

export function encodeCursor(index: number): string {
  return Buffer.from(String(index), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
