import { resolve, sep } from "node:path";
import { StorageError } from "./types.js";

const RESERVED_SEGMENTS = new Set([".", ".."]);
/** The empty-folder marker (see `local.ts`) is server-internal bookkeeping,
 * never a valid request target on its own. */
const MARKER_SEGMENT = ".dir";

/**
 * Normalizes a `[...slug]`-style path segment into a clean, slash-joined
 * relative path (`''` = root), rejecting anything that could escape the
 * storage root or address the hidden marker file directly. Applied uniformly
 * to every request path *and* every `to`/`name` field in a body - single
 * source of truth for path safety.
 */
export function normalizeStoragePath(raw: string | undefined): string {
  const value = raw ?? "";
  if (value.includes("\\")) {
    throw new StorageError("invalid_path", "Path cannot contain backslashes.");
  }

  const segments = value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    if (RESERVED_SEGMENTS.has(segment)) {
      throw new StorageError(
        "invalid_path",
        `Path segment "${segment}" is not allowed.`,
      );
    }
  }

  if (segments[segments.length - 1] === MARKER_SEGMENT) {
    throw new StorageError(
      "invalid_path",
      'The ".dir" marker file is not directly addressable.',
    );
  }

  return segments.join("/");
}

/**
 * Joins an already-normalized relative path onto `root` and verifies the
 * result is still contained within it - defense in depth below
 * `normalizeStoragePath`, in case `root` itself is a symlink or the relative
 * path was constructed some other way.
 */
export function resolveWithinRoot(root: string, relativePath: string): string {
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new StorageError("invalid_path", "Path escapes the storage root.");
  }
  return target;
}

export function joinStoragePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function storagePathName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

export function storagePathParent(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}
