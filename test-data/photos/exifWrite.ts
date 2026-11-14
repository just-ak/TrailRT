/**
 * A small EXIF writer for the synthetic photo fixtures. Phase 11, task 2.
 *
 * It writes exactly the tags the Phase 11 reader looks for (design §3.3), in
 * either byte order, and nothing a real camera would add. It can also write
 * them wrong on purpose, with no hemisphere reference, a zero denominator or
 * an out-of-range latitude, because the reader has to reject each of those
 * with a reason.
 *
 * It lives in `test-data/` beside `places.ts`, so tests import it as
 * `@fixtures/photos/exifWrite`, and `scripts/generate-fixtures.mjs` imports it
 * directly, which Node 26 allows because it strips types. That is why it uses
 * only erasable TypeScript syntax, and plain `Uint8Array` and `DataView`
 * rather than Node's `Buffer`.
 *
 * Nothing here is recorded GPS data. Callers pass positions from
 * `@fixtures/places`.
 */

export type ByteOrder = 'II' | 'MM';

/** An EXIF RATIONAL: two unsigned 32-bit integers. */
export type Rational = readonly [numerator: number, denominator: number];

export interface GpsSpec {
  /** Decimal degrees. Written as degrees, minutes and seconds with a reference. */
  lat?: number;
  lon?: number;
  /** Overrides the reference the sign implies. `null` omits the tag. */
  latRef?: string | null;
  lonRef?: string | null;
  /** Overrides the degrees, minutes and seconds, for malformed values. */
  latRaw?: readonly Rational[];
  lonRaw?: readonly Rational[];
  /** Metres. A negative value writes altitude reference 1, below sea level. */
  altitude?: number;
  /** Horizontal positioning error in metres (GPS tag 0x1F). */
  accuracy?: number;
  /** Degrees. */
  direction?: number;
  directionRef?: 'T' | 'M';
}

export interface ExifSpec {
  /** Default `II`, little-endian, as most cameras write. `sips` writes `MM`. */
  byteOrder?: ByteOrder;
  /** 1–8. */
  orientation?: number;
  /** `YYYY:MM:DD HH:MM:SS`, as EXIF writes `DateTimeOriginal`. */
  taken?: string;
  /** `±HH:MM`, as EXIF writes `OffsetTimeOriginal`. */
  offset?: string;
  gps?: GpsSpec;
}

/** Tags written. The reader's table is in design §3.3. */
export const TAG = {
  make: 0x010f,
  orientation: 0x0112,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
  gpsVersion: 0x00,
  gpsLatRef: 0x01,
  gpsLat: 0x02,
  gpsLonRef: 0x03,
  gpsLon: 0x04,
  gpsAltRef: 0x05,
  gpsAlt: 0x06,
  gpsDirRef: 0x10,
  gpsDir: 0x11,
  gpsHPositioningError: 0x1f,
} as const;

const TYPE = { byte: 1, ascii: 2, short: 3, long: 4, rational: 5 } as const;
type FieldType = (typeof TYPE)[keyof typeof TYPE];

interface Entry {
  tag: number;
  type: FieldType;
  /** Encoded value bytes, in the block's byte order. */
  bytes: Uint8Array;
  count: number;
  /** Set for the two IFD pointers, whose value is patched once offsets are known. */
  pointer?: 'exif' | 'gps';
}

class Writer {
  readonly little: boolean;
  constructor(order: ByteOrder) {
    this.little = order === 'II';
  }

  short(values: readonly number[]): Entry['bytes'] {
    const out = new Uint8Array(values.length * 2);
    const view = new DataView(out.buffer);
    values.forEach((v, i) => view.setUint16(i * 2, v, this.little));
    return out;
  }

  long(values: readonly number[]): Entry['bytes'] {
    const out = new Uint8Array(values.length * 4);
    const view = new DataView(out.buffer);
    values.forEach((v, i) => view.setUint32(i * 4, v >>> 0, this.little));
    return out;
  }

  rational(values: readonly Rational[]): Entry['bytes'] {
    return this.long(values.flatMap(([n, d]) => [n, d]));
  }
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length + 1); // NUL-terminated, and counted
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

/** Decimal degrees to EXIF degrees, minutes and seconds (seconds to 1/10,000). */
export function toDms(degrees: number): Rational[] {
  const abs = Math.abs(degrees);
  const d = Math.floor(abs);
  const minutesFloat = (abs - d) * 60;
  const m = Math.floor(minutesFloat);
  const s = (minutesFloat - m) * 60;
  return [
    [d, 1],
    [m, 1],
    [Math.round(s * 10_000), 10_000],
  ];
}

function hundredths(value: number): Rational {
  return [Math.round(value * 100), 100];
}

function asciiEntry(tag: number, text: string): Entry {
  const bytes = ascii(text);
  return { tag, type: TYPE.ascii, bytes, count: bytes.length };
}

function gpsEntries(w: Writer, gps: GpsSpec): Entry[] {
  const entries: Entry[] = [
    { tag: TAG.gpsVersion, type: TYPE.byte, bytes: Uint8Array.of(2, 3, 0, 0), count: 4 },
  ];
  const axis = (
    value: number | undefined,
    raw: readonly Rational[] | undefined,
    refOverride: string | null | undefined,
    refTag: number,
    valueTag: number,
    positive: string,
    negative: string,
  ): void => {
    if (value === undefined && raw === undefined) return;
    const ref = refOverride === undefined ? ((value ?? 0) < 0 ? negative : positive) : refOverride;
    if (ref !== null) entries.push(asciiEntry(refTag, ref));
    const rationals = raw ?? toDms(value ?? 0);
    entries.push({ tag: valueTag, type: TYPE.rational, bytes: w.rational(rationals), count: rationals.length });
  };
  axis(gps.lat, gps.latRaw, gps.latRef, TAG.gpsLatRef, TAG.gpsLat, 'N', 'S');
  axis(gps.lon, gps.lonRaw, gps.lonRef, TAG.gpsLonRef, TAG.gpsLon, 'E', 'W');
  if (gps.altitude !== undefined) {
    entries.push({ tag: TAG.gpsAltRef, type: TYPE.byte, bytes: Uint8Array.of(gps.altitude < 0 ? 1 : 0), count: 1 });
    entries.push({ tag: TAG.gpsAlt, type: TYPE.rational, bytes: w.rational([hundredths(Math.abs(gps.altitude))]), count: 1 });
  }
  if (gps.direction !== undefined) {
    entries.push(asciiEntry(TAG.gpsDirRef, gps.directionRef ?? 'T'));
    entries.push({ tag: TAG.gpsDir, type: TYPE.rational, bytes: w.rational([hundredths(gps.direction)]), count: 1 });
  }
  if (gps.accuracy !== undefined) {
    entries.push({ tag: TAG.gpsHPositioningError, type: TYPE.rational, bytes: w.rational([hundredths(gps.accuracy)]), count: 1 });
  }
  return entries;
}

/** Lays out one IFD at `start`, with values over four bytes after the entries. */
function layoutIfd(w: Writer, entries: Entry[], start: number): { bytes: Uint8Array; pointerAt: Map<string, number> } {
  const sorted = entries.toSorted((a, b) => a.tag - b.tag);
  const headLength = 2 + sorted.length * 12 + 4;
  const overflow = sorted.reduce((sum, e) => sum + (e.bytes.length > 4 ? e.bytes.length + (e.bytes.length % 2) : 0), 0);
  const out = new Uint8Array(headLength + overflow);
  const view = new DataView(out.buffer);
  const pointerAt = new Map<string, number>();
  view.setUint16(0, sorted.length, w.little);
  let dataOffset = headLength;
  sorted.forEach((entry, i) => {
    const at = 2 + i * 12;
    view.setUint16(at, entry.tag, w.little);
    view.setUint16(at + 2, entry.type, w.little);
    view.setUint32(at + 4, entry.count, w.little);
    if (entry.pointer !== undefined) pointerAt.set(entry.pointer, start + at + 8);
    if (entry.bytes.length <= 4) {
      out.set(entry.bytes, at + 8);
    } else {
      view.setUint32(at + 8, start + dataOffset, w.little);
      out.set(entry.bytes, dataOffset);
      dataOffset += entry.bytes.length + (entry.bytes.length % 2); // word-aligned
    }
  });
  view.setUint32(2 + sorted.length * 12, 0, w.little); // no next IFD
  return { bytes: out, pointerAt };
}

/** A TIFF block: header, IFD0, then the Exif IFD and the GPS IFD when present. */
export function buildTiff(spec: ExifSpec): Uint8Array {
  const order = spec.byteOrder ?? 'II';
  const w = new Writer(order);

  const ifd0: Entry[] = [asciiEntry(TAG.make, 'TrailRT synthetic')];
  if (spec.orientation !== undefined) {
    ifd0.push({ tag: TAG.orientation, type: TYPE.short, bytes: w.short([spec.orientation]), count: 1 });
  }
  const exif: Entry[] = [];
  if (spec.taken !== undefined) exif.push(asciiEntry(TAG.dateTimeOriginal, spec.taken));
  if (spec.offset !== undefined) exif.push(asciiEntry(TAG.offsetTimeOriginal, spec.offset));
  const gps = spec.gps === undefined ? [] : gpsEntries(w, spec.gps);
  if (exif.length > 0) ifd0.push({ tag: TAG.exifIfd, type: TYPE.long, bytes: w.long([0]), count: 1, pointer: 'exif' });
  if (gps.length > 0) ifd0.push({ tag: TAG.gpsIfd, type: TYPE.long, bytes: w.long([0]), count: 1, pointer: 'gps' });

  const first = layoutIfd(w, ifd0, 8);
  let offset = 8 + first.bytes.length;
  const exifIfd = exif.length > 0 ? layoutIfd(w, exif, offset) : null;
  if (exifIfd !== null) offset += exifIfd.bytes.length;
  const gpsIfd = gps.length > 0 ? layoutIfd(w, gps, offset) : null;

  const out = new Uint8Array(offset + (gpsIfd?.bytes.length ?? 0));
  const view = new DataView(out.buffer);
  out[0] = out[1] = order === 'II' ? 0x49 : 0x4d;
  view.setUint16(2, 42, w.little);
  view.setUint32(4, 8, w.little);
  out.set(first.bytes, 8);
  if (exifIfd !== null) {
    out.set(exifIfd.bytes, 8 + first.bytes.length);
    view.setUint32(first.pointerAt.get('exif') ?? 0, 8 + first.bytes.length, w.little);
  }
  if (gpsIfd !== null) {
    out.set(gpsIfd.bytes, offset);
    view.setUint32(first.pointerAt.get('gps') ?? 0, offset, w.little);
  }
  return out;
}

const EXIF_HEADER = Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0); // "Exif\0\0"

/** The payload of a JPEG APP1 segment: `Exif\0\0` and the TIFF block. */
export function buildExifPayload(spec: ExifSpec): Uint8Array {
  const tiff = buildTiff(spec);
  const out = new Uint8Array(EXIF_HEADER.length + tiff.length);
  out.set(EXIF_HEADER);
  out.set(tiff, EXIF_HEADER.length);
  return out;
}

function isExifApp1(jpeg: Uint8Array, at: number): boolean {
  return jpeg[at + 1] === 0xe1 && EXIF_HEADER.every((b, i) => jpeg[at + 4 + i] === b);
}

/**
 * Returns `jpeg` with `spec` as its only EXIF block, placed straight after SOI
 * as the EXIF standard says. Any existing EXIF `APP1` and Photoshop `APP13`
 * segment (both of which `sips` adds) are removed, so a fixture carries only
 * what its spec says. Everything else is kept byte for byte.
 */
export function withExif(jpeg: Uint8Array, spec: ExifSpec): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('withExif: not a JPEG (no SOI marker)');
  const kept: Uint8Array[] = [];
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1] ?? 0;
    if (marker === 0xda) break; // start of scan: the rest is image data
    const length = ((jpeg[at + 2] ?? 0) << 8) | (jpeg[at + 3] ?? 0);
    if (!(isExifApp1(jpeg, at) || marker === 0xed)) kept.push(jpeg.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  const payload = buildExifPayload(spec);
  if (payload.length + 2 > 0xffff) throw new Error('withExif: EXIF block too large for one APP1 segment');
  const app1 = new Uint8Array(4 + payload.length);
  app1.set([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
  app1.set(payload, 4);
  const parts = [jpeg.subarray(0, 2), app1, ...kept, jpeg.subarray(at)];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
