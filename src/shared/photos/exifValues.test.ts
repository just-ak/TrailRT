import { describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import { buildTiff, type ExifSpec, type GpsSpec } from '@fixtures/photos/exifWrite';
import { haversineDistance } from '../geo/distance';
import {
  dmsToDegrees,
  type LocationResult,
  parseExifDateTime,
  parseExifOffset,
  REASON,
  readLocation,
  readOrientation,
  readTaken,
} from './exifValues';
import { DAMAGED, parseTiff } from './tiff';

function parsed(spec: ExifSpec) {
  const result = parseTiff(buildTiff(spec));
  if (!result.ok) throw new Error(result.reason);
  return result;
}

const location = (gps: GpsSpec, byteOrder: 'II' | 'MM' = 'II'): LocationResult => readLocation(parsed({ byteOrder, gps }).gps);

function located(result: LocationResult) {
  if (result.kind !== 'located') throw new Error(`expected located, got ${JSON.stringify(result)}`);
  return result.geotag;
}

describe('readLocation: located', () => {
  it('reads Buxton, west of Greenwich, with altitude, accuracy and a true bearing', () => {
    const geotag = located(location({ lat: BUXTON.lat, lon: BUXTON.lon, altitude: 300.5, accuracy: 8, direction: 271.25, directionRef: 'T' }));
    expect(geotag.lat).toBeCloseTo(BUXTON.lat, 9);
    expect(geotag.lon).toBeCloseTo(BUXTON.lon, 9);
    expect(geotag.lon).toBeLessThan(0);
    expect(geotag.altitudeM).toBe(300.5);
    expect(geotag.accuracyM).toBe(8);
    expect(geotag.direction).toEqual({ degrees: 271.25, ref: 'T' });
  });

  it('puts Buxton about 250 km east if the W is lost, which the sign check catches', () => {
    const right = located(location({ lat: BUXTON.lat, lon: BUXTON.lon }));
    const wrong = located(location({ lat: BUXTON.lat, lon: BUXTON.lon, lonRef: 'E' }));
    const km = haversineDistance(right, wrong) / 1000;
    expect(km).toBeGreaterThan(240);
    expect(km).toBeLessThan(260);
    expect(haversineDistance(right, BUXTON)).toBeLessThan(1);
  });

  it('makes south negative', () => {
    expect(located(location({ lat: -BUXTON.lat, lon: BUXTON.lon })).lat).toBeCloseTo(-BUXTON.lat, 9);
  });

  it('honours altitude below sea level', () => {
    expect(located(location({ lat: ASHBOURNE.lat, lon: ASHBOURNE.lon, altitude: -12.25 })).altitudeM).toBe(-12.25);
  });

  it('keeps absent altitude, accuracy and direction as null, never 0', () => {
    const geotag = located(location({ lat: LEEK.lat, lon: LEEK.lon }));
    expect(geotag.altitudeM).toBeNull();
    expect(geotag.accuracyM).toBeNull();
    expect(geotag.direction).toBeNull();
  });

  it('keeps a magnetic bearing marked magnetic', () => {
    expect(located(location({ lat: LEEK.lat, lon: LEEK.lon, direction: 45.5, directionRef: 'M' })).direction).toEqual({
      degrees: 45.5,
      ref: 'M',
    });
  });

  it('normalises a bearing of 370° to 10°', () => {
    expect(located(location({ lat: LEEK.lat, lon: LEEK.lon, direction: 370, directionRef: 'T' })).direction?.degrees).toBe(10);
  });

  it('gives identical results from big- and little-endian blocks', () => {
    const gps: GpsSpec = { lat: BUXTON.lat, lon: BUXTON.lon, altitude: -12.25, accuracy: 8, direction: 271.25 };
    expect(location(gps, 'MM')).toEqual(location(gps, 'II'));
  });
});

describe('readLocation: unlocated and rejected', () => {
  it('is none with no GPS IFD', () => {
    expect(readLocation(parsed({ orientation: 1 }).gps)).toEqual({ kind: 'none' });
  });

  it('is none with a GPS IFD that holds no position', () => {
    expect(location({ altitude: 100 })).toEqual({ kind: 'none' });
  });

  it.each<[string, GpsSpec, string]>([
    ['0°, 0°', { lat: 0, lon: 0 }, REASON.zeroZero],
    ['no latitude reference', { lat: BUXTON.lat, lon: BUXTON.lon, latRef: null }, REASON.noReference],
    ['no longitude reference', { lat: BUXTON.lat, lon: BUXTON.lon, lonRef: null }, REASON.noReference],
    ['an unknown reference', { lat: BUXTON.lat, lon: BUXTON.lon, latRef: 'X' }, REASON.badReference],
    ['a zero denominator', { latRaw: [[53, 1], [15, 1], [316_800, 0]], lon: BUXTON.lon }, REASON.zeroDenominator],
    ['four components', { latRaw: [[53, 1], [15, 1], [1, 1], [1, 1]], lon: BUXTON.lon }, REASON.badValue],
    ['latitude only', { lat: BUXTON.lat }, REASON.latitudeOnly],
    ['longitude only', { lon: BUXTON.lon }, REASON.longitudeOnly],
  ])('rejects %s with its reason', (_name, gps, reason) => {
    expect(location(gps)).toEqual({ kind: 'rejected', reason });
  });

  it('rejects an out-of-range latitude, naming the value', () => {
    const result = location({ lat: 95, lon: LEEK.lon });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.reason.startsWith(REASON.outOfRange)).toBe(true);
      expect(result.reason).toContain('95°');
    }
  });

  it('rejects an out-of-range longitude', () => {
    expect(location({ lat: LEEK.lat, lon: -181 }).kind).toBe('rejected');
  });

  it('rejects a damaged GPS IFD with the damage reason', () => {
    expect(readLocation({ status: 'damaged', reason: DAMAGED })).toEqual({ kind: 'rejected', reason: DAMAGED });
  });

  it('drops a bearing with no reference rather than guessing which north', () => {
    const tiff = parsed({ gps: { lat: LEEK.lat, lon: LEEK.lon, direction: 90 } });
    // The writer always adds a reference; remove it from the parsed map.
    if (tiff.gps.status !== 'ok') throw new Error('no gps');
    const tags = new Map(tiff.gps.tags);
    tags.delete(0x10);
    expect(located(readLocation({ status: 'ok', tags })).direction).toBeNull();
  });
});

describe('dmsToDegrees', () => {
  it('accepts the whole angle in the degrees', () => {
    expect(dmsToDegrees([[532_588, 10_000]])).toEqual({ ok: true, value: 53.2588 });
  });

  it('refuses no components', () => {
    expect(dmsToDegrees([])).toEqual({ ok: false, reason: REASON.badValue });
  });
});

const taken = (spec: ExifSpec) => readTaken(parsed(spec).exif);

describe('readTaken', () => {
  it('reads a time with a positive offset', () => {
    expect(taken({ taken: '2026:06:14 10:32:05', offset: '+01:00' })).toEqual({ local: '2026-06-14T10:32:05', offsetMinutes: 60 });
  });

  it('reads a time with a negative half-hour offset', () => {
    expect(taken({ taken: '2026:06:15 09:15:00', offset: '-05:30' })).toEqual({ local: '2026-06-15T09:15:00', offsetMinutes: -330 });
  });

  it('keeps a time with no offset as camera time, with no zone', () => {
    expect(taken({ taken: '2026:06:14 12:01:00' })).toEqual({ local: '2026-06-14T12:01:00', offsetMinutes: null });
  });

  it('is null with no Exif IFD', () => {
    expect(taken({ orientation: 1 })).toBeNull();
  });

  it('is null when the capture time is invalid', () => {
    expect(taken({ taken: '0000:00:00 00:00:00', offset: '+01:00' })).toBeNull();
  });
});

describe('parseExifDateTime', () => {
  it.each([
    ['2026:06:14 10:32:05', '2026-06-14T10:32:05'],
    ['2024:02:29 23:59:59', '2024-02-29T23:59:59'],
  ])('accepts %s', (text, expected) => {
    expect(parseExifDateTime(text)).toBe(expected);
  });

  it.each([
    '0000:00:00 00:00:00',
    '    :  :     :  :  ',
    '2026:02:29 10:00:00',
    '2026:02:30 10:00:00',
    '2026:13:01 10:00:00',
    '2026:06:31 10:00:00',
    '2026:06:14 24:00:00',
    '2026:06:14 10:60:00',
    '2026:06:14 10:00:60',
    '2026-06-14 10:32:05x',
    'yesterday',
  ])('refuses %s', (text) => {
    expect(parseExifDateTime(text)).toBeNull();
  });

  it('is null for null', () => {
    expect(parseExifDateTime(null)).toBeNull();
  });
});

describe('parseExifOffset', () => {
  it.each([
    ['+01:00', 60],
    ['-05:30', -330],
    ['+05:45', 345],
    ['+00:00', 0],
    ['+14:00', 840],
    ['-12:00', -720],
  ])('reads %s', (text, minutes) => {
    expect(parseExifOffset(text)).toBe(minutes);
  });

  it.each(['+15:00', '-13:00', '+01:60', '01:00', '+1:00', 'Z', ''])('refuses %s', (text) => {
    expect(parseExifOffset(text)).toBeNull();
  });
});

describe('readOrientation', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('reads orientation %i', (orientation) => {
    expect(readOrientation(parsed({ orientation }).ifd0)).toBe(orientation);
  });

  it.each([0, 9, 65_535])('refuses %i', (orientation) => {
    expect(readOrientation(parsed({ orientation }).ifd0)).toBeNull();
  });

  it('is null when absent', () => {
    expect(readOrientation(parsed({}).ifd0)).toBeNull();
  });
});
