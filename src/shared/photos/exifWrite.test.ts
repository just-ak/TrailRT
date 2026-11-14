import { describe, expect, it } from 'vitest';
import { BUXTON } from '@fixtures/places';
import {
  buildExifPayload,
  buildTiff,
  type ByteOrder,
  type ExifSpec,
  TAG,
  toDms,
  withExif,
} from '@fixtures/photos/exifWrite';

/**
 * Byte-level checks of the fixture EXIF writer (Phase 11, task 2).
 *
 * The reader under test in task 3 must not be the only thing that has ever
 * looked at these bytes, or a writer bug and a matching reader bug would pass
 * together. So this walks the TIFF structure with a deliberately minimal
 * decoder of its own. The generated fixtures were also read back with an
 * independent library, `exifr`, when the generator was written.
 */

interface RawEntry {
  type: number;
  count: number;
  /** Offset of the value: inline in the entry, or where the entry points. */
  at: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readIfd(tiff: Uint8Array, offset: number): { tags: number[]; entries: Map<number, RawEntry> } {
  const v = view(tiff);
  const little = tiff[0] === 0x49;
  const count = v.getUint16(offset, little);
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
  const tags: number[] = [];
  const entries = new Map<number, RawEntry>();
  for (let i = 0; i < count; i += 1) {
    const at = offset + 2 + i * 12;
    const tag = v.getUint16(at, little);
    const type = v.getUint16(at + 2, little);
    const n = v.getUint32(at + 4, little);
    const length = n * (sizes[type] ?? 0);
    tags.push(tag);
    entries.set(tag, { type, count: n, at: length <= 4 ? at + 8 : v.getUint32(at + 8, little) });
  }
  return { tags, entries };
}

function long(tiff: Uint8Array, at: number): number {
  return view(tiff).getUint32(at, tiff[0] === 0x49);
}

function rationals(tiff: Uint8Array, entry: RawEntry | undefined): [number, number][] {
  if (entry === undefined) throw new Error('missing entry');
  return Array.from({ length: entry.count }, (_, i) => [long(tiff, entry.at + i * 8), long(tiff, entry.at + i * 8 + 4)]);
}

function ascii(tiff: Uint8Array, entry: RawEntry | undefined): string {
  if (entry === undefined) throw new Error('missing entry');
  return String.fromCharCode(...tiff.subarray(entry.at, entry.at + entry.count - 1));
}

function pointer(tiff: Uint8Array, ifd0: Map<number, RawEntry>, tag: number): number {
  const entry = ifd0.get(tag);
  if (entry === undefined) throw new Error(`no pointer ${tag}`);
  return long(tiff, entry.at);
}


const FULL: ExifSpec = {
  orientation: 6,
  taken: '2026:06:14 10:32:05',
  offset: '+01:00',
  gps: { lat: BUXTON.lat, lon: BUXTON.lon, altitude: -12.25, accuracy: 8, direction: 271.25, directionRef: 'T' },
};

describe('toDms', () => {
  it('splits decimal degrees into degrees, minutes and 1/10,000 seconds', () => {
    expect(toDms(53.2588)).toEqual([
      [53, 1],
      [15, 1],
      [316_800, 10_000],
    ]);
  });

  it('drops the sign, which the reference carries', () => {
    expect(toDms(-1.911)).toEqual(toDms(1.911));
  });
});

describe.each<ByteOrder>(['II', 'MM'])('buildTiff in byte order %s', (byteOrder) => {
  const tiff = buildTiff({ ...FULL, byteOrder });
  const little = byteOrder === 'II';

  it('writes the TIFF header with IFD0 at offset 8', () => {
    expect(String.fromCharCode(tiff[0] ?? 0, tiff[1] ?? 0)).toBe(byteOrder);
    expect(view(tiff).getUint16(2, little)).toBe(42);
    expect(view(tiff).getUint32(4, little)).toBe(8);
  });

  it('writes IFD0, the Exif IFD and the GPS IFD with the expected entries, in tag order', () => {
    const ifd0 = readIfd(tiff, 8);
    expect(ifd0.tags).toEqual([TAG.make, TAG.orientation, TAG.exifIfd, TAG.gpsIfd]);

    const exif = readIfd(tiff, pointer(tiff, ifd0.entries, TAG.exifIfd));
    expect(exif.tags).toEqual([TAG.dateTimeOriginal, TAG.offsetTimeOriginal]);

    const gps = readIfd(tiff, pointer(tiff, ifd0.entries, TAG.gpsIfd));
    expect(gps.tags).toEqual([
      TAG.gpsVersion,
      TAG.gpsLatRef,
      TAG.gpsLat,
      TAG.gpsLonRef,
      TAG.gpsLon,
      TAG.gpsAltRef,
      TAG.gpsAlt,
      TAG.gpsDirRef,
      TAG.gpsDir,
      TAG.gpsHPositioningError,
    ]);
  });

  it('writes the values, with the hemisphere in the reference', () => {
    const ifd0 = readIfd(tiff, 8).entries;
    expect(view(tiff).getUint16(ifd0.get(TAG.orientation)?.at ?? 0, little)).toBe(6);

    const exif = readIfd(tiff, pointer(tiff, ifd0, TAG.exifIfd)).entries;
    expect(ascii(tiff, exif.get(TAG.dateTimeOriginal))).toBe('2026:06:14 10:32:05');
    expect(ascii(tiff, exif.get(TAG.offsetTimeOriginal))).toBe('+01:00');

    const gps = readIfd(tiff, pointer(tiff, ifd0, TAG.gpsIfd)).entries;
    expect(ascii(tiff, gps.get(TAG.gpsLatRef))).toBe('N');
    expect(ascii(tiff, gps.get(TAG.gpsLonRef))).toBe('W'); // the whole square is west of Greenwich
    expect(rationals(tiff, gps.get(TAG.gpsLat))).toEqual(toDms(BUXTON.lat));
    expect(rationals(tiff, gps.get(TAG.gpsLon))).toEqual(toDms(BUXTON.lon));
    expect(tiff[gps.get(TAG.gpsAltRef)?.at ?? 0]).toBe(1); // below sea level
    expect(rationals(tiff, gps.get(TAG.gpsAlt))).toEqual([[1225, 100]]);
    expect(rationals(tiff, gps.get(TAG.gpsHPositioningError))).toEqual([[800, 100]]);
    expect(ascii(tiff, gps.get(TAG.gpsDirRef))).toBe('T');
    expect(rationals(tiff, gps.get(TAG.gpsDir))).toEqual([[27_125, 100]]);
  });
});

describe('buildTiff malformations', () => {
  it('omits the latitude reference when asked to', () => {
    const tiff = buildTiff({ gps: { lat: BUXTON.lat, lon: BUXTON.lon, latRef: null } });
    const gps = readIfd(tiff, pointer(tiff, readIfd(tiff, 8).entries, TAG.gpsIfd));
    expect(gps.tags).not.toContain(TAG.gpsLatRef);
    expect(gps.tags).toContain(TAG.gpsLat);
  });

  it('writes a zero denominator exactly as given', () => {
    const tiff = buildTiff({ gps: { latRaw: [[53, 1], [15, 1], [316_800, 0]], lon: BUXTON.lon } });
    const gps = readIfd(tiff, pointer(tiff, readIfd(tiff, 8).entries, TAG.gpsIfd)).entries;
    expect(rationals(tiff, gps.get(TAG.gpsLat))).toEqual([
      [53, 1],
      [15, 1],
      [316_800, 0],
    ]);
  });

  it('writes an out-of-range latitude without clamping it', () => {
    const tiff = buildTiff({ gps: { lat: 95, lon: BUXTON.lon } });
    const gps = readIfd(tiff, pointer(tiff, readIfd(tiff, 8).entries, TAG.gpsIfd)).entries;
    expect(rationals(tiff, gps.get(TAG.gpsLat))[0]).toEqual([95, 1]);
  });

  it('writes no Exif or GPS IFD, and no pointer to one, when there is nothing to put in it', () => {
    const tiff = buildTiff({ orientation: 1 });
    expect(readIfd(tiff, 8).tags).toEqual([TAG.make, TAG.orientation]);
  });

  it('is deterministic', () => {
    expect(buildTiff(FULL)).toEqual(buildTiff(FULL));
  });
});

function segment(marker: number, body: number[]): number[] {
  return [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
}

/** A JPEG-shaped byte string: SOI, APP0, an old EXIF APP1, APP13, DQT, SOS and data. */
function fakeJpeg(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1]), // APP0 JFIF
    ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 9, 9, 9]), // an existing EXIF block
    ...segment(0xed, [0x50, 0x68, 0x6f, 0x74, 0x6f]), // APP13 "Photo"
    ...segment(0xdb, [1, 2, 3]), // DQT
    ...segment(0xda, [4, 5]), // SOS
    0x11, 0x22, 0x33, 0xff, 0xd9, // scan data and EOI
  ]);
}

function segments(jpeg: Uint8Array): { marker: number; body: Uint8Array }[] {
  const out: { marker: number; body: Uint8Array }[] = [];
  let at = 2;
  while (at < jpeg.length) {
    const marker = jpeg[at + 1] ?? 0;
    const length = ((jpeg[at + 2] ?? 0) << 8) | (jpeg[at + 3] ?? 0);
    out.push({ marker, body: jpeg.subarray(at + 4, at + 2 + length) });
    if (marker === 0xda) break;
    at += 2 + length;
  }
  return out;
}

describe('withExif', () => {
  it('puts one EXIF APP1 straight after SOI and drops the old one and APP13', () => {
    const out = withExif(fakeJpeg(), FULL);
    expect([out[0], out[1]]).toEqual([0xff, 0xd8]);
    expect(segments(out).map((s) => s.marker)).toEqual([0xe1, 0xe0, 0xdb, 0xda]);
    expect(segments(out)[0]?.body).toEqual(buildExifPayload(FULL));
  });

  it('keeps the scan data byte for byte', () => {
    const out = withExif(fakeJpeg(), FULL);
    expect(Array.from(out.subarray(-5))).toEqual([0x11, 0x22, 0x33, 0xff, 0xd9]);
  });

  it('replaces rather than stacks when applied twice', () => {
    const once = withExif(fakeJpeg(), { orientation: 3 });
    expect(withExif(withExif(fakeJpeg(), FULL), { orientation: 3 })).toEqual(once);
  });

  it('refuses something that is not a JPEG', () => {
    expect(() => withExif(Uint8Array.of(0x89, 0x50, 0x4e, 0x47), FULL)).toThrow(/not a JPEG/);
  });
});
