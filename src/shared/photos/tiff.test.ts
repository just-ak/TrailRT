import { describe, expect, it } from 'vitest';
import { BUXTON } from '@fixtures/places';
import { buildTiff, type ExifSpec } from '@fixtures/photos/exifWrite';
import { DAMAGED, EXIF_TAGS, GPS_TAGS, IFD0_TAGS, parseTiff, type TiffResult } from './tiff';

const FULL: ExifSpec = {
  orientation: 6,
  taken: '2026:06:14 10:32:05',
  offset: '+01:00',
  gps: { lat: BUXTON.lat, lon: BUXTON.lon, altitude: 300.5, accuracy: 8, direction: 271.25, directionRef: 'T' },
};

function ok(result: TiffResult): Extract<TiffResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

/** Overwrites the value of an IFD0 entry, to corrupt a pointer. */
function patchIfd0(tiff: Uint8Array, tag: number, value: number): Uint8Array {
  const out = tiff.slice();
  const v = new DataView(out.buffer);
  const little = out[0] === 0x49;
  const count = v.getUint16(8, little);
  for (let i = 0; i < count; i += 1) {
    const at = 8 + 2 + i * 12;
    if (v.getUint16(at, little) === tag) {
      v.setUint32(at + 8, value, little);
      return out;
    }
  }
  throw new Error(`tag ${tag} not in IFD0`);
}

describe('parseTiff', () => {
  it.each(['II', 'MM'] as const)('reads the wanted tags from a %s block', (byteOrder) => {
    const result = ok(parseTiff(buildTiff({ ...FULL, byteOrder })));
    expect(result.littleEndian).toBe(byteOrder === 'II');
    expect(result.ifd0.get(IFD0_TAGS.orientation)).toEqual({ kind: 'uint', values: [6] });
    if (result.exif.status !== 'ok' || result.gps.status !== 'ok') throw new Error('sub-IFDs missing');
    expect(result.exif.tags.get(EXIF_TAGS.dateTimeOriginal)).toEqual({ kind: 'ascii', text: '2026:06:14 10:32:05' });
    expect(result.exif.tags.get(EXIF_TAGS.offsetTimeOriginal)).toEqual({ kind: 'ascii', text: '+01:00' });
    expect(result.gps.tags.get(GPS_TAGS.lonRef)).toEqual({ kind: 'ascii', text: 'W' });
    expect(result.gps.tags.get(GPS_TAGS.lat)).toEqual({
      kind: 'rational',
      values: [
        [53, 1],
        [15, 1],
        [316_800, 10_000],
      ],
    });
    expect(result.gps.tags.get(GPS_TAGS.altRef)).toEqual({ kind: 'uint', values: [0] });
  });

  it('gives identical tags in both byte orders', () => {
    const little = ok(parseTiff(buildTiff({ ...FULL, byteOrder: 'II' })));
    const big = ok(parseTiff(buildTiff({ ...FULL, byteOrder: 'MM' })));
    expect({ ...big, littleEndian: true }).toEqual(little);
  });

  it('never decodes free text: the Make tag the writer adds is not read', () => {
    const result = ok(parseTiff(buildTiff(FULL)));
    expect(result.ifd0.has(0x010f)).toBe(false);
    expect([...result.ifd0.keys()]).toEqual([IFD0_TAGS.orientation]);
  });

  it('reports absent sub-IFDs as absent, not damaged', () => {
    const result = ok(parseTiff(buildTiff({ orientation: 1 })));
    expect(result.exif).toEqual({ status: 'absent' });
    expect(result.gps).toEqual({ status: 'absent' });
  });

  it.each([
    ['too short', Uint8Array.of(0x49, 0x49, 42, 0)],
    ['an unknown byte order', Uint8Array.of(0x58, 0x58, 42, 0, 8, 0, 0, 0)],
    ['the wrong magic number', Uint8Array.of(0x49, 0x49, 43, 0, 8, 0, 0, 0)],
    ['IFD0 past the end', Uint8Array.of(0x49, 0x49, 42, 0, 0xff, 0, 0, 0)],
  ])('refuses %s', (_name, bytes) => {
    expect(parseTiff(bytes)).toEqual({ ok: false, reason: DAMAGED });
  });

  it('refuses IFD0 whose entries run past the end', () => {
    const tiff = buildTiff(FULL);
    expect(parseTiff(tiff.subarray(0, 20))).toEqual({ ok: false, reason: DAMAGED });
  });

  it('marks a GPS IFD past the end as damaged and still reads the rest', () => {
    const result = ok(parseTiff(patchIfd0(buildTiff(FULL), IFD0_TAGS.gpsIfd, 1_000_000)));
    expect(result.gps).toEqual({ status: 'damaged', reason: DAMAGED });
    expect(result.exif.status).toBe('ok');
  });

  it('refuses a cycle: a GPS pointer back to IFD0', () => {
    const result = ok(parseTiff(patchIfd0(buildTiff(FULL), IFD0_TAGS.gpsIfd, 8)));
    expect(result.gps).toEqual({ status: 'damaged', reason: DAMAGED });
  });

  it('refuses a cycle: the GPS pointer equal to the Exif pointer', () => {
    const tiff = buildTiff(FULL);
    const exifAt = (() => {
      const r = ok(parseTiff(tiff));
      if (r.exif.status !== 'ok') throw new Error('no exif');
      const v = new DataView(tiff.buffer);
      for (let i = 0; i < v.getUint16(8, true); i += 1) {
        if (v.getUint16(10 + i * 12, true) === IFD0_TAGS.exifIfd) return v.getUint32(10 + i * 12 + 8, true);
      }
      throw new Error('no pointer');
    })();
    const result = ok(parseTiff(patchIfd0(tiff, IFD0_TAGS.gpsIfd, exifAt)));
    expect(result.exif.status).toBe('ok');
    expect(result.gps).toEqual({ status: 'damaged', reason: DAMAGED });
  });

  it('does not read past the block for a value whose offset points outside it', () => {
    const tiff = buildTiff(FULL);
    const result = ok(parseTiff(tiff));
    if (result.gps.status !== 'ok') throw new Error('no gps');
    // Truncate just after the GPS IFD's entries, cutting off its rational values.
    const cut = ok(parseTiff(tiff.subarray(0, tiff.length - 8)));
    expect(cut.gps).toEqual({ status: 'damaged', reason: DAMAGED });
  });
});
