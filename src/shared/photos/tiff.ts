/**
 * A TIFF parser for the EXIF block of a photo. Phase 11, design §3.3.
 *
 * It reads IFD0, then follows the Exif IFD (`0x8769`) and GPS IFD (`0x8825`)
 * pointers, in either byte order. It decodes **only** the tags the photo
 * reader needs. Everything else, including every free-text field (title,
 * description, comments, maker notes), is never decoded at all. That is the
 * simplest way to treat imported text as untrusted (Requirement 2.7).
 *
 * Every offset is bounds-checked, and an IFD pointer back to an IFD already
 * read is refused, so a crafted file cannot loop the parser or make it read
 * outside the block. Failures are values, not exceptions.
 *
 * Pure: no Node, no Electron, no DOM. Runs on a `Uint8Array`.
 */

/** An EXIF RATIONAL: numerator and denominator, both unsigned 32-bit. */
export type Rational = readonly [numerator: number, denominator: number];

export type TiffValue =
  | { kind: 'ascii'; text: string }
  /** BYTE, SHORT and LONG. */
  | { kind: 'uint'; values: readonly number[] }
  | { kind: 'rational'; values: readonly Rational[] }
  /** A tag we want, written with a type we do not decode. Treated as malformed. */
  | { kind: 'unsupported'; type: number };

export type TagMap = ReadonlyMap<number, TiffValue>;

/** A sub-IFD: absent, read, or present but damaged. */
export type SubIfd =
  | { status: 'absent' }
  | { status: 'ok'; tags: TagMap }
  | { status: 'damaged'; reason: string };

export type TiffResult =
  | { ok: true; littleEndian: boolean; ifd0: TagMap; exif: SubIfd; gps: SubIfd }
  | { ok: false; reason: string };

export const IFD0_TAGS = {
  orientation: 0x0112,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
} as const;

export const EXIF_TAGS = {
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
} as const;

export const GPS_TAGS = {
  latRef: 0x01,
  lat: 0x02,
  lonRef: 0x03,
  lon: 0x04,
  altRef: 0x05,
  alt: 0x06,
  dirRef: 0x10,
  dir: 0x11,
  hPositioningError: 0x1f,
} as const;

const WANTED_IFD0 = new Set<number>(Object.values(IFD0_TAGS));
const WANTED_EXIF = new Set<number>(Object.values(EXIF_TAGS));
const WANTED_GPS = new Set<number>(Object.values(GPS_TAGS));

/** Byte size of one value of each TIFF field type. */
const TYPE_SIZE: Readonly<Record<number, number>> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
  13: 4, // IFD
};

/** Longest ASCII value decoded. The tags read are dates, offsets and one-letter references. */
const MAX_ASCII = 64;
/** Most values decoded for one numeric tag. GPS coordinates need three. */
const MAX_VALUES = 16;

export const DAMAGED = 'The photo’s EXIF data is damaged';

class Reader {
  readonly view: DataView;
  constructor(
    readonly bytes: Uint8Array,
    readonly little: boolean,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  fits(offset: number, length: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && length >= 0 && offset + length <= this.bytes.length;
  }

  u16(offset: number): number {
    return this.view.getUint16(offset, this.little);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, this.little);
  }
}

type IfdRead = { ok: true; tags: Map<number, TiffValue>; pointers: Map<number, number> } | { ok: false; reason: string };

function decode(r: Reader, type: number, count: number, at: number): TiffValue {
  switch (type) {
    case 2: {
      const length = Math.min(count, MAX_ASCII);
      let text = '';
      for (let i = 0; i < length; i += 1) {
        const byte = r.bytes[at + i] ?? 0;
        if (byte === 0) break;
        text += String.fromCharCode(byte);
      }
      return { kind: 'ascii', text };
    }
    case 1:
    case 7: // UNDEFINED, which some writers use for a one-byte altitude reference
      return { kind: 'uint', values: Array.from({ length: Math.min(count, MAX_VALUES) }, (_, i) => r.bytes[at + i] ?? 0) };
    case 3:
      return { kind: 'uint', values: Array.from({ length: Math.min(count, MAX_VALUES) }, (_, i) => r.u16(at + i * 2)) };
    case 4:
    case 13:
      return { kind: 'uint', values: Array.from({ length: Math.min(count, MAX_VALUES) }, (_, i) => r.u32(at + i * 4)) };
    case 5:
      return {
        kind: 'rational',
        values: Array.from({ length: Math.min(count, MAX_VALUES) }, (_, i): Rational => [r.u32(at + i * 8), r.u32(at + i * 8 + 4)]),
      };
    default:
      return { kind: 'unsupported', type };
  }
}

/**
 * Reads one IFD's entries for the wanted tags, and the two sub-IFD pointers
 * when `pointerTags` names them. Entries for other tags are skipped unread.
 */
function readIfd(r: Reader, offset: number, wanted: ReadonlySet<number>, pointerTags: ReadonlySet<number>): IfdRead {
  if (!r.fits(offset, 2)) return { ok: false, reason: DAMAGED };
  const count = r.u16(offset);
  if (!r.fits(offset + 2, count * 12)) return { ok: false, reason: DAMAGED };

  const tags = new Map<number, TiffValue>();
  const pointers = new Map<number, number>();
  for (let i = 0; i < count; i += 1) {
    const entry = offset + 2 + i * 12;
    const tag = r.u16(entry);
    if (!wanted.has(tag)) continue;
    const type = r.u16(entry + 2);
    const n = r.u32(entry + 4);
    const size = TYPE_SIZE[type];
    if (size === undefined || n === 0) {
      if (pointerTags.has(tag)) return { ok: false, reason: DAMAGED };
      tags.set(tag, { kind: 'unsupported', type });
      continue;
    }
    // Only as many values as will be decoded need to be in bounds; a huge
    // declared count is not read past what is used.
    const used = type === 2 ? Math.min(n, MAX_ASCII) : Math.min(n, MAX_VALUES);
    const inline = n * size <= 4;
    const at = inline ? entry + 8 : r.u32(entry + 8);
    if (!r.fits(at, used * size)) return { ok: false, reason: DAMAGED };
    const value = decode(r, type, n, at);
    if (pointerTags.has(tag)) {
      if (value.kind === 'uint' && value.values.length === 1) pointers.set(tag, value.values[0] ?? 0);
      else return { ok: false, reason: DAMAGED };
    } else {
      tags.set(tag, value);
    }
  }
  return { ok: true, tags, pointers };
}

function subIfd(r: Reader, pointer: number | undefined, wanted: ReadonlySet<number>, visited: Set<number>): SubIfd {
  if (pointer === undefined) return { status: 'absent' };
  if (visited.has(pointer)) return { status: 'damaged', reason: DAMAGED }; // a cycle
  visited.add(pointer);
  const read = readIfd(r, pointer, wanted, new Set());
  return read.ok ? { status: 'ok', tags: read.tags } : { status: 'damaged', reason: read.reason };
}

/** Parses a TIFF block: the part of an EXIF payload after `Exif\0\0`. */
export function parseTiff(bytes: Uint8Array): TiffResult {
  if (bytes.length < 8) return { ok: false, reason: DAMAGED };
  const order = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
  if (order !== 'II' && order !== 'MM') return { ok: false, reason: DAMAGED };
  const r = new Reader(bytes, order === 'II');
  if (r.u16(2) !== 42) return { ok: false, reason: DAMAGED };

  const ifd0Offset = r.u32(4);
  const visited = new Set<number>([ifd0Offset]);
  const ifd0 = readIfd(r, ifd0Offset, WANTED_IFD0, new Set([IFD0_TAGS.exifIfd, IFD0_TAGS.gpsIfd]));
  if (!ifd0.ok) return { ok: false, reason: ifd0.reason };

  return {
    ok: true,
    littleEndian: r.little,
    ifd0: ifd0.tags,
    exif: subIfd(r, ifd0.pointers.get(IFD0_TAGS.exifIfd), WANTED_EXIF, visited),
    gps: subIfd(r, ifd0.pointers.get(IFD0_TAGS.gpsIfd), WANTED_GPS, visited),
  };
}
