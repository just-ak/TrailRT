import { describe, expect, it } from 'vitest';
import { BUXTON } from '@fixtures/places';
import { buildExifPayload, buildTiff, type ExifSpec, withExif } from '@fixtures/photos/exifWrite';
import { bytesRangeReader, CONTAINER_REASON, findExif, HEAD_BYTES, type PhotoFormat } from './containers';

const SPEC: ExifSpec = { orientation: 1, taken: '2026:06:14 10:32:05', gps: { lat: BUXTON.lat, lon: BUXTON.lon } };
const TIFF = buildTiff(SPEC);

// ------------------------------------------------------------ builders

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of arrays) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function be(value: number, size: number): number[] {
  const out: number[] = [];
  for (let i = size - 1; i >= 0; i -= 1) out.push(Math.floor(value / 2 ** (8 * i)) % 256);
  return out;
}

const text = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const box = (type: string, ...content: (Uint8Array | number[])[]): Uint8Array => {
  const body = concat(...content);
  return concat(be(body.length + 8, 4), text(type), body);
};
const fullBox = (type: string, version: number, ...content: (Uint8Array | number[])[]): Uint8Array =>
  box(type, [version, 0, 0, 0], ...content);

function segment(marker: number, body: Uint8Array | number[]): Uint8Array {
  const bytes = concat(body);
  return concat([0xff, marker], be(bytes.length + 2, 2), bytes);
}

/** SOI, then `before` segments, then the EXIF APP1, then a scan of `scanBytes` bytes. */
function jpeg(options: { before?: Uint8Array[]; exif?: boolean; scanBytes?: number } = {}): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0xff, 0xd8), ...(options.before ?? [])];
  if (options.exif ?? true) parts.push(segment(0xe1, buildExifPayload(SPEC)));
  parts.push(segment(0xdb, [0, 1, 2]), segment(0xda, [3, 4]), new Uint8Array(options.scanBytes ?? 16), Uint8Array.of(0xff, 0xd9));
  return concat(...parts);
}

interface HeicOptions {
  brand?: string;
  /** Compatible brands in `ftyp`. Default `mif1` and the major brand. */
  compatible?: string[];
  ilocVersion?: 0 | 1 | 2 | 3;
  offsetSize?: 0 | 4 | 8;
  lengthSize?: 4 | 8;
  baseOffsetSize?: 0 | 4 | 8;
  infeVersion?: 1 | 2 | 3;
  itemType?: string;
  method?: number;
  /** Bytes of image data before the EXIF item in `mdat`. */
  padding?: number;
  /** Bytes before the TIFF header inside the item: Apple writes "Exif\0\0". */
  prefix?: number[];
  /** Overrides the item's length in `iloc`. */
  lengthOverride?: number;
}

/** A minimal HEIF file: `ftyp`, `meta` (`iinf`, `iloc`) and `mdat` holding the EXIF item. */
function heic(options: HeicOptions = {}): { bytes: Uint8Array; exifAt: number; itemLength: number } {
  const {
    brand = 'heic',
    ilocVersion = 0,
    offsetSize = 4,
    lengthSize = 4,
    baseOffsetSize = 0,
    infeVersion = 2,
    itemType = 'Exif',
    method = 0,
    padding = 64,
    prefix = text('Exif\0\0'),
  } = options;
  const item = concat(be(prefix.length, 4), prefix, TIFF);
  const ITEM_ID = 7;

  const build = (exifAt: number): Uint8Array => {
    const ftyp = box('ftyp', text(brand), be(0, 4), ...(options.compatible ?? ['mif1', brand]).map(text));
    const infeId = infeVersion === 3 ? be(ITEM_ID, 4) : be(ITEM_ID, 2);
    const infe = fullBox('infe', infeVersion, infeId, be(0, 2), infeVersion >= 2 ? text(itemType) : [], [0]);
    const otherInfe = fullBox('infe', Math.max(2, infeVersion), infeVersion === 3 ? be(1, 4) : be(1, 2), be(0, 2), text('hvc1'), [0]);
    const iinf = fullBox('iinf', 0, be(2, 2), otherInfe, infe);
    const v = ilocVersion;
    const idBytes = (id: number) => (v < 2 ? be(id, 2) : be(id, 4));
    const entry = (id: number, offset: number, length: number, m: number): number[] => {
      const base = baseOffsetSize === 0 ? 0 : offset;
      const extentOffset = baseOffsetSize === 0 ? offset : 0;
      return [
        ...idBytes(id),
        ...(v > 0 ? be(m, 2) : []),
        ...be(0, 2), // data_reference_index
        ...be(base, baseOffsetSize),
        ...be(1, 2), // one extent
        ...(v > 0 ? [] : []), // index_size is 0 here
        ...be(extentOffset, offsetSize),
        ...be(length, lengthSize),
      ];
    };
    const iloc = fullBox(
      'iloc',
      v,
      [(offsetSize << 4) | lengthSize, baseOffsetSize << 4],
      v < 2 ? be(2, 2) : be(2, 4),
      entry(1, 0, 1, 0),
      entry(ITEM_ID, exifAt, options.lengthOverride ?? item.length, method),
    );
    const meta = fullBox('meta', 0, fullBox('hdlr', 0, be(0, 4), text('pict'), new Uint8Array(13)), iinf, iloc);
    return concat(ftyp, meta, box('mdat', new Uint8Array(padding), item));
  };

  const first = build(0);
  const exifAt = first.length - item.length;
  return { bytes: build(exifAt), exifAt, itemLength: item.length };
}

async function find(bytes: Uint8Array, format: PhotoFormat) {
  const reads: [number, number][] = [];
  const result = await findExif(bytesRangeReader(bytes, (offset, length) => reads.push([offset, length])), format);
  const bytesRead = reads.reduce((sum, [, length]) => sum + length, 0);
  return { result, reads, bytesRead };
}

// ------------------------------------------------------------------ JPEG

describe('findExif: JPEG', () => {
  it('finds the EXIF block in APP1 with one read', async () => {
    const { result, reads } = await find(jpeg(), 'jpeg');
    expect(result).toEqual({ kind: 'exif', tiff: TIFF });
    expect(reads).toHaveLength(1);
  });

  it('skips a non-EXIF APP1 (XMP) and fill bytes before it', async () => {
    const xmp = segment(0xe1, text('http://ns.adobe.com/xap/1.0/\0<x/>'));
    const bytes = jpeg({ before: [Uint8Array.of(0xff), segment(0xe0, text('JFIF\0')), xmp] });
    expect((await find(bytes, 'jpeg')).result).toEqual({ kind: 'exif', tiff: TIFF });
  });

  it('is none for a JPEG with no EXIF', async () => {
    expect((await find(jpeg({ exif: false }), 'jpeg')).result).toEqual({ kind: 'none' });
  });

  it('finds APP1 after 70 KB of other segments, past the first read', async () => {
    const icc = Array.from({ length: 2 }, () => segment(0xe2, new Uint8Array(35_000)));
    const { result, reads } = await find(jpeg({ before: icc }), 'jpeg');
    expect(result).toEqual({ kind: 'exif', tiff: TIFF });
    expect(reads.length).toBeGreaterThan(1);
  });

  it('reads only the first 64 KB of a 5 MB JPEG', async () => {
    const { result, bytesRead } = await find(jpeg({ scanBytes: 5 * 1024 * 1024 }), 'jpeg');
    expect(result.kind).toBe('exif');
    expect(bytesRead).toBe(HEAD_BYTES);
  });

  it('reports a file cut off inside APP1 as truncated', async () => {
    expect((await find(jpeg().subarray(0, 60), 'jpeg')).result).toEqual({ kind: 'failed', reason: CONTAINER_REASON.truncated });
  });

  it.each([
    ['a PNG', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ['text', Uint8Array.from(text('This is a text file with a .jpg name.\n'))],
    ['a HEIC', heic().bytes],
  ])('says %s is not a JPEG', async (_name, bytes) => {
    expect((await find(bytes, 'jpeg')).result).toEqual({ kind: 'failed', reason: CONTAINER_REASON.notJpeg });
  });

  it('says an empty file is empty', async () => {
    expect((await find(new Uint8Array(), 'jpeg')).result).toEqual({ kind: 'failed', reason: CONTAINER_REASON.empty });
  });
});

// ------------------------------------------------------------------ HEIC

describe('findExif: HEIC', () => {
  it('finds the EXIF item through iinf and iloc with one read', async () => {
    const { result, reads } = await find(heic().bytes, 'heic');
    expect(result).toEqual({ kind: 'exif', tiff: TIFF });
    expect(reads).toHaveLength(1);
  });

  it.each([
    { ilocVersion: 1 as const },
    { ilocVersion: 2 as const },
    { offsetSize: 8 as const, lengthSize: 8 as const },
    { baseOffsetSize: 4 as const, offsetSize: 0 as const },
    { baseOffsetSize: 8 as const, offsetSize: 4 as const, ilocVersion: 1 as const },
    { infeVersion: 3 as const },
    { brand: 'heix' },
    { brand: 'mif1' },
    { brand: 'avif', compatible: ['avif', 'mif1'] },
    { prefix: [] },
  ])('reads iloc layout %o', async (options) => {
    expect((await find(heic(options).bytes, 'heic')).result).toEqual({ kind: 'exif', tiff: TIFF });
  });

  it('makes exactly one extra read, of exactly the item, when it lies past the first 64 KB', async () => {
    const { bytes, exifAt, itemLength } = heic({ padding: 100_000 });
    expect(exifAt).toBeGreaterThan(HEAD_BYTES);
    const { result, reads } = await find(bytes, 'heic');
    expect(result).toEqual({ kind: 'exif', tiff: TIFF });
    expect(reads).toEqual([
      [0, HEAD_BYTES],
      [exifAt, itemLength],
    ]);
  });

  it('reads at most 64 KB plus the item from a 5 MB file', async () => {
    const { bytes, itemLength } = heic({ padding: 5 * 1024 * 1024 });
    const { result, bytesRead } = await find(bytes, 'heic');
    expect(result.kind).toBe('exif');
    expect(bytesRead).toBeLessThanOrEqual(HEAD_BYTES + itemLength);
  });

  it('is none when there is no Exif item', async () => {
    expect((await find(heic({ itemType: 'mime' }).bytes, 'heic')).result).toEqual({ kind: 'none' });
  });

  it('is none when the item entries are version 1, which carry no item type', async () => {
    expect((await find(heic({ infeVersion: 1 }).bytes, 'heic')).result).toEqual({ kind: 'none' });
  });

  it('refuses an iloc version it does not know', async () => {
    expect((await find(heic({ ilocVersion: 3 }).bytes, 'heic')).result).toEqual({
      kind: 'failed',
      reason: CONTAINER_REASON.unsupportedHeic,
    });
  });

  it('refuses an item stored in idat (construction method 1)', async () => {
    expect((await find(heic({ ilocVersion: 1, method: 1 }).bytes, 'heic')).result).toEqual({
      kind: 'failed',
      reason: CONTAINER_REASON.unsupportedHeic,
    });
  });

  it('says an extent past the end of the file is truncated', async () => {
    const { bytes } = heic({ lengthOverride: 10_000 });
    expect((await find(bytes, 'heic')).result).toEqual({ kind: 'failed', reason: CONTAINER_REASON.truncated });
  });

  it('says a file cut off inside meta is truncated', async () => {
    expect((await find(heic().bytes.subarray(0, 60), 'heic')).result).toEqual({ kind: 'failed', reason: CONTAINER_REASON.truncated });
  });

  it.each([
    ['an MP4 (ISO brands, no HEIF brand)', heic({ brand: 'isom', compatible: ['isom', 'mp41'] }).bytes],
    ['a JPEG', jpeg()],
    ['text', Uint8Array.from(text('This is a text file with a .heic name.\n'))],
  ])('says %s is not a HEIC', async (_name, bytes) => {
    expect((await find(bytes, 'heic')).result).toEqual({ kind: 'failed', reason: CONTAINER_REASON.notHeic });
  });
});

// ------------------------------------------------------------- robustness

/** A small deterministic PRNG, so a failure can be replayed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('findExif never throws', () => {
  it.each<[PhotoFormat, Uint8Array]>([
    ['jpeg', withExif(jpeg({ exif: false }), SPEC)],
    ['heic', heic({ ilocVersion: 2, offsetSize: 8, lengthSize: 8 }).bytes],
  ])('on 2,000 corrupted copies of a %s', async (format, original) => {
    const random = mulberry32(20_261_112);
    for (let round = 0; round < 2000; round += 1) {
      const bytes = original.slice(0, Math.max(1, Math.floor(original.length * (0.2 + random() * 0.8))));
      for (let flips = 0; flips < 1 + Math.floor(random() * 8); flips += 1) {
        bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
      }
      const result = await findExif(bytesRangeReader(bytes), format);
      expect(['exif', 'none', 'failed']).toContain(result.kind);
    }
  });
});
