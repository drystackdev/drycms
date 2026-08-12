/**
 * A minimal, hand-rolled ZIP reader/writer - `STORED` (uncompressed) entries
 * only, same "Prefer API over library" reasoning as `icons/sanitize-svg.ts`:
 * media files (images/video/audio) are already compressed, so DEFLATE would
 * barely shrink a real backup anyway, and skipping it avoids reaching for a
 * zip dependency (or hand-rolling DEFLATE, which WOULD be a real parsing
 * job worth a library) just to re-compress bytes that don't compress. This
 * is a drycms-to-drycms round trip (`routes/storage-backup.ts` writes it,
 * the same route reads it back), not a general-purpose zip library - format
 * support is intentionally the minimum both directions actually use.
 */

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
/** General-purpose bit 11 ("language encoding flag") - filenames are
 * written as UTF-8 (`TextEncoder`'s only encoding), and real media
 * filenames are frequently non-ASCII. */
const UTF8_FLAG = 0x0800;

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** Standard PKZIP/zlib CRC-32 (IEEE 802.3 polynomial). */
export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(epochMs: number): { time: number; date: number } {
  // ZIP has no representation for a date before 1980 - clamp rather than
  // wrap/underflow into a bogus future date.
  const d = new Date(Math.max(epochMs, Date.UTC(1980, 0, 1)));
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { time, date };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export interface ZipEntryInput {
  /** Forward-slash relative path, stored verbatim as the zip entry name. */
  path: string;
  data: Uint8Array;
  /** Epoch ms, defaults to `Date.now()`. */
  modifiedAt?: number;
}

/**
 * Builds one ZIP entry (local file header + raw data) and its matching
 * central-directory record, without buffering the whole archive - each call
 * returns just that entry's bytes so a caller (`routes/storage-backup.ts`)
 * can stream them out one file at a time. Call `finish()` once, after every
 * entry, to get the trailing central directory + end-of-central-directory
 * record that makes the stream a valid zip file.
 */
export class ZipWriter {
  private offset = 0;
  private count = 0;
  private centralRecords: Uint8Array[] = [];

  /** Returns the local file header + data to write next - append this
   * directly to the output in call order (this class assumes entries are
   * emitted in the same order `addEntry` was called, since each central
   * record points back at its own local header's byte offset). */
  addEntry({ path, data, modifiedAt }: ZipEntryInput): Uint8Array {
    const nameBytes = new TextEncoder().encode(path);
    const crc = crc32(data);
    const { time, date } = dosDateTime(modifiedAt ?? Date.now());

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, LOCAL_FILE_SIGNATURE, true);
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size == raw size (stored)
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra field length
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, CENTRAL_FILE_SIGNATURE, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed to extract
    central.setUint16(8, UTF8_FLAG, true);
    central.setUint16(10, 0, true); // method: stored
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true); // extra field length
    central.setUint16(32, 0, true); // comment length
    central.setUint16(34, 0, true); // disk number start
    central.setUint16(36, 0, true); // internal attributes
    central.setUint32(38, 0, true); // external attributes
    central.setUint32(42, this.offset, true); // this entry's local header offset
    centralHeader.set(nameBytes, 46);
    this.centralRecords.push(centralHeader);

    this.offset += localHeader.length + data.length;
    this.count += 1;
    return concatBytes(localHeader, data);
  }

  /** Central directory + end-of-central-directory record - append once,
   * after every `addEntry` call, to close out the archive. */
  finish(): Uint8Array {
    const central = this.centralRecords.reduce((acc, record) => concatBytes(acc, record), new Uint8Array(0));
    const eocd = new Uint8Array(22);
    const view = new DataView(eocd.buffer);
    view.setUint32(0, EOCD_SIGNATURE, true);
    view.setUint16(4, 0, true); // disk number
    view.setUint16(6, 0, true); // disk with central directory start
    view.setUint16(8, this.count, true); // records on this disk
    view.setUint16(10, this.count, true); // total records
    view.setUint32(12, central.length, true);
    view.setUint32(16, this.offset, true); // central directory offset
    view.setUint16(20, 0, true); // comment length
    return concatBytes(central, eocd);
  }
}

/** In-memory convenience wrapper over `ZipWriter` for callers that already
 * have every entry's bytes at hand (tests; a restore's own small fixtures) -
 * `routes/storage-backup.ts`'s real download streams entries one at a time
 * instead of calling this. */
export function buildZip(entries: ZipEntryInput[]): Uint8Array {
  const writer = new ZipWriter();
  let out: Uint8Array = new Uint8Array(0);
  for (const entry of entries) out = concatBytes(out, writer.addEntry(entry));
  return concatBytes(out, writer.finish());
}

export interface ZipEntryOutput {
  path: string;
  data: Uint8Array;
}

/**
 * Parses a ZIP archive back into its entries - reads the central directory
 * (scanning backward for the end-of-central-directory record, same as any
 * zip reader), then each entry's real bytes from its local header. Only
 * `STORED` (uncompressed) entries are supported - see this module's own
 * doc comment for why - anything else throws rather than silently
 * misreading compressed bytes as raw data.
 */
export function parseZip(bytes: Uint8Array): ZipEntryOutput[] {
  const MIN_EOCD_SIZE = 22;
  const MAX_COMMENT_SIZE = 65535;
  if (bytes.length < MIN_EOCD_SIZE) throw new Error("Not a valid zip file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const searchStart = Math.max(0, bytes.length - MIN_EOCD_SIZE - MAX_COMMENT_SIZE);
  let eocdOffset = -1;
  for (let i = bytes.length - MIN_EOCD_SIZE; i >= searchStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Not a valid zip file (no end-of-central-directory record found).");

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const decoder = new TextDecoder();
  const entries: ZipEntryOutput[] = [];
  let pos = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(pos, true) !== CENTRAL_FILE_SIGNATURE) throw new Error("Corrupt zip central directory.");
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const path = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));

    if (method !== 0) {
      throw new Error(`Unsupported zip compression method for "${path}" - only uncompressed (stored) entries are supported.`);
    }
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`Corrupt zip local header for "${path}".`);
    }
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    entries.push({ path, data: bytes.slice(dataStart, dataStart + compressedSize) });

    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
