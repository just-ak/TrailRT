/**
 * Finding the EXIF block inside a JPEG or HEIC file. Phase 11, design §3.2.
 *
 * Works over a `RangeReader`, so it reads only the bytes it needs
 * (Requirement 9.2) and is unit-testable against in-memory buffers:
 *
 * - **JPEG:** one read of the first 64 KB, then a walk of the markers from SOI
 *   to the first `APP1` that starts `Exif\0\0`.
 * - **HEIC:** the same first read, a walk of the top-level boxes to `meta`,
 *   then `iinf` for the `Exif` item and `iloc` (versions 0–2) for where it
 *   lies. When it lies past the first read, one more read of exactly that
 *   range.
 *
 * Anything inconsistent (a box running past the end, an extent past the file,
 * a layout not handled) is a typed failure with a reason, never an exception.
 *
 * Pure: no Node, no Electron, no DOM.
 */

/** Random access to a file's bytes. A read at the end returns fewer bytes. */
export interface RangeReader {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export type PhotoFormat = 'jpeg' | 'heic';

export type ContainerResult =
  /** The TIFF block, after the `Exif\0\0` prefix. */
  | { kind: 'exif'; tiff: Uint8Array }
  /** A valid image of the right kind with no EXIF block. */
  | { kind: 'none' }
  | { kind: 'failed'; reason: string };

/** Bytes read first. A JPEG APP1 segment cannot be longer, and a HEIC `meta` box rarely is. */
export const HEAD_BYTES = 64 * 1024;

/** Largest `meta` box or EXIF item read. Real ones are a few kilobytes. */
const MAX_EXTRA_READ = 1024 * 1024;

export const CONTAINER_REASON = {
  empty: 'The file is empty',
  notJpeg: 'Not a JPEG image',
  notHeic: 'Not a HEIC image',
  truncated: 'The file is truncated',
  damaged: 'The image file is damaged',
  unsupportedHeic: 'This HEIC file stores its metadata in a way TrailRT does not read yet',
} as const;

const failed = (reason: string): ContainerResult => ({ kind: 'failed', reason });

const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

/** An in-memory `RangeReader`, for tests and for bytes already in hand. */
export function bytesRangeReader(bytes: Uint8Array, onRead?: (offset: number, length: number) => void): RangeReader {
  return {
    size: bytes.length,
    read(offset, length) {
      onRead?.(offset, length);
      return Promise.resolve(bytes.subarray(offset, Math.min(bytes.length, offset + length)));
    },
  };
}

/**
 * The bytes of `[offset, offset + length)`, served from the head when it
 * covers them, otherwise by one more read. `null` when the range runs past
 * the end of the file.
 */
async function bytesAt(file: RangeReader, head: Uint8Array, offset: number, length: number): Promise<Uint8Array | null> {
  if (offset < 0 || length < 0 || offset + length > file.size) return null;
  if (offset + length <= head.length) return head.subarray(offset, offset + length);
  if (length > MAX_EXTRA_READ) return null;
  const bytes = await file.read(offset, length);
  return bytes.length === length ? bytes : null;
}

// ------------------------------------------------------------------ JPEG

async function findJpegExif(file: RangeReader, head: Uint8Array): Promise<ContainerResult> {
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return failed(CONTAINER_REASON.notJpeg);
  let at = 2;
  // Every segment before the image data is walked. Segment headers past the
  // head cost a four-byte read each, and a real file reaches APP1 in one or two.
  for (let segments = 0; segments < 64; segments += 1) {
    const header = await bytesAt(file, head, at, 4);
    if (header === null) return failed(CONTAINER_REASON.truncated);
    if (header[0] !== 0xff) return failed(CONTAINER_REASON.damaged);
    const marker = header[1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Start of scan or end of image: the metadata segments are over.
    if (marker === 0xda || marker === 0xd9) return { kind: 'none' };
    // Markers with no length field.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = ((header[2] ?? 0) << 8) | (header[3] ?? 0);
    if (length < 2) return failed(CONTAINER_REASON.damaged);
    if (at + 2 + length > file.size) return failed(CONTAINER_REASON.truncated);
    if (marker === 0xe1 && length >= 2 + EXIF_PREFIX.length) {
      const body = await bytesAt(file, head, at + 4, length - 2);
      if (body === null) return failed(CONTAINER_REASON.truncated);
      if (EXIF_PREFIX.every((b, i) => body[i] === b)) return { kind: 'exif', tiff: body.subarray(EXIF_PREFIX.length) };
    }
    at += 2 + length;
  }
  return { kind: 'none' };
}

// ------------------------------------------------------------------ HEIC

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'mif1']);

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
}

function u16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u32(bytes: Uint8Array, at: number): number {
  return (((bytes[at] ?? 0) << 24) >>> 0) + (((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
}

/** An unsigned big-endian integer of 0, 4 or 8 bytes. `null` for another size or an unsafe value. */
function uint(bytes: Uint8Array, at: number, size: number): number | null {
  if (size === 0) return 0;
  if (size === 4) return u32(bytes, at);
  if (size === 8) {
    const value = u32(bytes, at) * 2 ** 32 + u32(bytes, at + 4);
    return Number.isSafeInteger(value) ? value : null;
  }
  return null;
}

interface Box {
  type: string;
  /** Offset of the box's content, after its header. */
  start: number;
  /** Offset just past the box. */
  end: number;
}

/** Walks the boxes in `[from, to)` of `bytes`. `null` if one runs past `to`. */
function boxes(bytes: Uint8Array, from: number, to: number): Box[] | null {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(bytes, at);
    const type = fourcc(bytes, at + 4);
    let header = 8;
    if (size === 1) {
      const large = uint(bytes, at + 8, 8);
      if (large === null || at + 16 > to) return null;
      size = large;
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) return null;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return at === to ? out : null;
}

/** The item id of the `Exif` item in an `iinf` box, `null` when there is none, `undefined` when damaged. */
function exifItemId(meta: Uint8Array, iinf: Box): number | null | undefined {
  const version = meta[iinf.start] ?? 0;
  const entriesAt = iinf.start + 4 + (version === 0 ? 2 : 4);
  const entries = boxes(meta, entriesAt, iinf.end);
  if (entries === null) return undefined;
  for (const entry of entries) {
    if (entry.type !== 'infe') continue;
    const infeVersion = meta[entry.start] ?? 0;
    if (infeVersion < 2) continue; // versions 0 and 1 carry no item type
    const idSize = infeVersion === 2 ? 2 : 4;
    const id = idSize === 2 ? u16(meta, entry.start + 4) : u32(meta, entry.start + 4);
    const typeAt = entry.start + 4 + idSize + 2; // after item_protection_index
    if (typeAt + 4 > entry.end) return undefined;
    if (fourcc(meta, typeAt) === 'Exif') return id;
  }
  return null;
}

interface Extent {
  offset: number;
  length: number;
}

type IlocResult = { ok: true; extents: Extent[] } | { ok: false; reason: string };

/** The extents of `itemId` in an `iloc` box (ISO/IEC 14496-12 §8.11.3). */
function locate(meta: Uint8Array, iloc: Box, itemId: number): IlocResult {
  const damaged: IlocResult = { ok: false, reason: CONTAINER_REASON.damaged };
  const version = meta[iloc.start] ?? 0;
  if (version > 2) return { ok: false, reason: CONTAINER_REASON.unsupportedHeic };
  let at = iloc.start + 4;
  const sizes1 = meta[at] ?? 0;
  const sizes2 = meta[at + 1] ?? 0;
  const offsetSize = sizes1 >> 4;
  const lengthSize = sizes1 & 0x0f;
  const baseOffsetSize = sizes2 >> 4;
  const indexSize = version === 0 ? 0 : sizes2 & 0x0f;
  at += 2;
  const itemCount = version < 2 ? u16(meta, at) : u32(meta, at);
  at += version < 2 ? 2 : 4;

  for (let item = 0; item < itemCount; item += 1) {
    if (at > iloc.end) return damaged;
    const id = version < 2 ? u16(meta, at) : u32(meta, at);
    at += version < 2 ? 2 : 4;
    let method = 0;
    if (version > 0) {
      method = u16(meta, at) & 0x0f;
      at += 2;
    }
    at += 2; // data_reference_index
    const base = uint(meta, at, baseOffsetSize);
    if (base === null) return damaged;
    at += baseOffsetSize;
    const extentCount = u16(meta, at);
    at += 2;
    const extents: Extent[] = [];
    for (let e = 0; e < extentCount; e += 1) {
      at += indexSize;
      const offset = uint(meta, at, offsetSize);
      at += offsetSize;
      const length = uint(meta, at, lengthSize);
      at += lengthSize;
      if (offset === null || length === null) return damaged;
      extents.push({ offset: base + offset, length });
    }
    if (at > iloc.end) return damaged;
    if (id !== itemId) continue;
    // Method 0 is a file offset. Method 1 (in `idat`) and 2 (by item reference)
    // are legal, but no encoder tested puts EXIF there (ADR 0020).
    if (method !== 0) return { ok: false, reason: CONTAINER_REASON.unsupportedHeic };
    if (extents.length === 0 || extents.some((x) => x.length === 0)) return damaged;
    return { ok: true, extents };
  }
  return damaged; // the item is named in iinf but not located
}

async function findHeicExif(file: RangeReader, head: Uint8Array): Promise<ContainerResult> {
  if (head.length < 12 || fourcc(head, 4) !== 'ftyp') return failed(CONTAINER_REASON.notHeic);
  const ftypSize = u32(head, 0);
  if (ftypSize < 16 || ftypSize > head.length) return failed(CONTAINER_REASON.notHeic);
  const brands = [fourcc(head, 8)];
  for (let at = 16; at + 4 <= ftypSize; at += 4) brands.push(fourcc(head, at));
  if (!brands.some((b) => HEIC_BRANDS.has(b))) return failed(CONTAINER_REASON.notHeic);

  // Walk the top-level box headers to `meta`, reading headers past the head as needed.
  let at = 0;
  let meta: Uint8Array | null = null;
  while (at < file.size) {
    const header = await bytesAt(file, head, at, 16 <= file.size - at ? 16 : 8);
    if (header === null) return failed(CONTAINER_REASON.truncated);
    let size = u32(header, 0);
    if (size === 1) size = uint(header, 8, 8) ?? -1;
    else if (size === 0) size = file.size - at;
    if (size < 8) return failed(CONTAINER_REASON.damaged);
    if (fourcc(header, 4) === 'meta') {
      meta = await bytesAt(file, head, at, size);
      if (meta === null) return failed(at + size > file.size ? CONTAINER_REASON.truncated : CONTAINER_REASON.damaged);
      break;
    }
    at += size;
  }
  if (meta === null) return failed(at > file.size ? CONTAINER_REASON.truncated : CONTAINER_REASON.damaged);

  // `meta` is a FullBox: its children start after the four bytes of version and flags.
  const headerSize = u32(meta, 0) === 1 ? 16 : 8;
  const children = boxes(meta, headerSize + 4, meta.length);
  if (children === null) return failed(CONTAINER_REASON.damaged);
  const iinf = children.find((b) => b.type === 'iinf');
  const iloc = children.find((b) => b.type === 'iloc');
  if (iinf === undefined) return { kind: 'none' };
  const itemId = exifItemId(meta, iinf);
  if (itemId === undefined) return failed(CONTAINER_REASON.damaged);
  if (itemId === null) return { kind: 'none' };
  if (iloc === undefined) return failed(CONTAINER_REASON.damaged);
  const located = locate(meta, iloc, itemId);
  if (!located.ok) return failed(located.reason);

  const parts: Uint8Array[] = [];
  for (const extent of located.extents) {
    if (extent.offset + extent.length > file.size) return failed(CONTAINER_REASON.truncated);
    const part = await bytesAt(file, head, extent.offset, extent.length);
    if (part === null) return failed(CONTAINER_REASON.damaged);
    parts.push(part);
  }
  const item = parts.length === 1 ? (parts[0] ?? new Uint8Array()) : concat(parts);

  // The item starts with a 4-byte offset to the TIFF header, past an optional "Exif\0\0".
  if (item.length < 4) return failed(CONTAINER_REASON.damaged);
  const tiffAt = 4 + u32(item, 0);
  if (tiffAt + 8 > item.length) return failed(CONTAINER_REASON.damaged);
  return { kind: 'exif', tiff: item.subarray(tiffAt) };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Finds the EXIF block of a JPEG or HEIC file. The file's signature is checked
 * against `format`, which comes from the file's extension, so a file that is
 * not the image its name claims is a failure with a reason (Requirement 2.8).
 */
export async function findExif(file: RangeReader, format: PhotoFormat): Promise<ContainerResult> {
  if (file.size === 0) return failed(CONTAINER_REASON.empty);
  const head = await file.read(0, Math.min(HEAD_BYTES, file.size));
  return format === 'jpeg' ? findJpegExif(file, head) : findHeicExif(file, head);
}
