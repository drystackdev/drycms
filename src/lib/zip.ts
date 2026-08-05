import { promises as fs } from "node:fs";
import * as path from "node:path";
import { crc32 } from "node:zlib";

/**
 * Minimal hand-rolled ZIP container - STORE (method 0, no compression) only.
 * See `plans/content-type-seed.md`: avoids adding a zip dependency to either
 * the build script or the production server bundle (`zlib.crc32()` is
 * stdlib since Node 22.2, and `package.json`'s `engines` already requires
 * >=22.12.0). DEFLATE support (`zlib.deflateRawSync`/`inflateRawSync`, still
 * stdlib) could be added later as a pure size optimization without changing
 * this container format. No ZIP64 - a soft limit of 65535 entries, which a
 * CMS's own media/icon/component assets are never going to approach.
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const VERSION = 20;
const STORE_METHOD = 0;
// A fixed DOS date/time placeholder (1980-01-01 00:00:00) - entries here are
// asset bytes nobody reads a modified-time off of, and a fixed value keeps
// otherwise-identical builds byte-for-byte reproducible.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

export interface ZipEntry {
  /** Forward-slash relative path inside the zip, e.g. "storage/logo.png". */
  path: string;
  data: Uint8Array;
}

function toBuffer(data: Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export function createZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) {
    throw new Error(`[drycms] createZip: ${entries.length} entries exceeds the 65535 ZIP64-free limit.`);
  }

  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, "utf8");
    const data = toBuffer(entry.data);
    const crc = crc32(data) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(VERSION, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(STORE_METHOD, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localChunks.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
    centralHeader.writeUInt16LE(VERSION, 4);
    centralHeader.writeUInt16LE(VERSION, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(STORE_METHOD, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42);
    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory start
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, ...centralChunks, end]);
}

/**
 * Reads a zip produced by `createZip` above - relies on it never writing a
 * trailing comment, so the end-of-central-directory record is always
 * exactly the last 22 bytes (no need to scan backward for the signature).
 * Rejects anything not created by `createZip` (a compression method other
 * than STORE, or a missing/misplaced EOCD record) rather than silently
 * mis-reading it.
 */
export function parseZip(buffer: Uint8Array): ZipEntry[] {
  const buf = toBuffer(buffer);
  if (buf.length < 22 || buf.readUInt32LE(buf.length - 22) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new Error("[drycms] parseZip: not a zip produced by createZip (no trailing end-of-central-directory record).");
  }
  const eocd = buf.subarray(buf.length - 22);
  const totalEntries = eocd.readUInt16LE(10);
  const centralDirectoryOffset = eocd.readUInt32LE(16);

  const entries: ZipEntry[] = [];
  let cursor = centralDirectoryOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (buf.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`[drycms] parseZip: corrupt central directory entry at offset ${cursor}.`);
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localHeaderOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (method !== STORE_METHOD) {
      throw new Error(`[drycms] parseZip: entry "${name}" uses compression method ${method}, only STORE (0) is supported.`);
    }

    const localNameLength = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = Uint8Array.from(buf.subarray(dataStart, dataStart + compressedSize));
    if (data.length !== uncompressedSize) {
      throw new Error(`[drycms] parseZip: entry "${name}" size mismatch (expected ${uncompressedSize}, got ${data.length}).`);
    }
    entries.push({ path: name, data });

    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export interface ZipRoot {
  /** Prefix inside the zip, e.g. "storage" - entries are stored as
   * `${prefix}/${relativePath}`. An empty string flattens the root's own
   * contents directly to the zip root (`${relativePath}`, no leading
   * slash) - for a single-root zip meant to be extracted with a plain
   * `unzip` rather than routed back through `unzipToDirectories`'s
   * prefix->dir map. */
  prefix: string;
  /** Absolute directory on disk to walk. */
  dir: string;
}

async function walkFiles(dir: string, base = dir): Promise<{ relative: string; absolute: string }[]> {
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const results: { relative: string; absolute: string }[] = [];
  for (const dirent of dirents) {
    const absolute = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      results.push(...(await walkFiles(absolute, base)));
    } else if (dirent.isFile()) {
      results.push({ relative: path.relative(base, absolute).split(path.sep).join("/"), absolute });
    }
  }
  return results;
}

/**
 * Zips every existing root's files under `${prefix}/${relativePath}` - a
 * root that doesn't exist on disk (or is empty) contributes nothing, not an
 * error. Returns `null` if every root was empty/missing, so callers can skip
 * writing a zip file entirely rather than shipping an empty one.
 */
export async function zipDirectories(roots: ZipRoot[]): Promise<Uint8Array | null> {
  const entries: ZipEntry[] = [];
  for (const root of roots) {
    for (const file of await walkFiles(root.dir)) {
      const path = root.prefix ? `${root.prefix}/${file.relative}` : file.relative;
      entries.push({ path, data: await fs.readFile(file.absolute) });
    }
  }
  return entries.length === 0 ? null : createZip(entries);
}

/**
 * Extracts a zip produced by `zipDirectories` back to disk. Each entry's
 * path is split on its first `/` into a prefix + relative path; a prefix not
 * present in `prefixToDir` is skipped (forward-compatible: a zip built by a
 * newer drycms with an extra root a still-current install doesn't know
 * about shouldn't fail the whole extraction). Rejects any entry whose
 * relative path contains a `.`/`..`/empty segment - defends against a
 * corrupted or tampered zip writing outside the intended root (zip-slip).
 */
export async function unzipToDirectories(buffer: Uint8Array, prefixToDir: Record<string, string>): Promise<void> {
  for (const entry of parseZip(buffer)) {
    const slash = entry.path.indexOf("/");
    if (slash === -1) continue;
    const prefix = entry.path.slice(0, slash);
    const dir = prefixToDir[prefix];
    if (!dir) continue;

    const segments = entry.path.slice(slash + 1).split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`[drycms] unzipToDirectories: entry "${entry.path}" has an unsafe path segment.`);
    }

    const destination = path.join(dir, ...segments);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, entry.data);
  }
}
