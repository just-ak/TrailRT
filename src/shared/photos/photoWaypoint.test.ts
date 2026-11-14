import { describe, expect, it } from 'vitest';
import { BUXTON } from '@fixtures/places';
import { photoDay, photoName, photoWaypointFields } from './photoWaypoint';

/** Phase 14 task 19: what a photo gives a waypoint (Requirement 18.3). */

const base = { relativePath: 'IMG_0412.HEIC', lat: BUXTON.lat, lon: BUXTON.lon, altitudeM: null, takenLocal: null };

describe('photoName', () => {
  it('is the file’s name without its folders or extension', () => {
    expect(photoName('2026/Peak/IMG_0412.HEIC')).toBe('IMG_0412');
    expect(photoName('Cat and Fiddle.jpeg')).toBe('Cat and Fiddle');
  });

  it('keeps a name that is only a dot-file or has no extension', () => {
    expect(photoName('.hidden')).toBe('.hidden');
    expect(photoName('scan')).toBe('scan');
  });

  it('is at most 200 characters', () => {
    expect(photoName(`${'a'.repeat(300)}.jpg`)).toHaveLength(200);
  });
});

describe('photoWaypointFields', () => {
  it('takes the place, the photo symbol and where it came from', () => {
    expect(photoWaypointFields({ ...base, takenLocal: '2026-07-01T14:02:10' })).toEqual({
      name: 'IMG_0412',
      lat: BUXTON.lat,
      lon: BUXTON.lon,
      eleM: null,
      description: 'From the photo IMG_0412.HEIC, taken 2026-07-01 at 14:02',
      symbol: 'photo',
    });
  });

  it('keeps an altitude, and invents none', () => {
    expect(photoWaypointFields({ ...base, altitudeM: 307 })?.eleM).toBe(307);
    expect(photoWaypointFields(base)?.eleM).toBeNull();
    expect(photoWaypointFields(base)?.description).toBe('From the photo IMG_0412.HEIC');
  });

  it('is nothing without a location', () => {
    expect(photoWaypointFields({ ...base, lat: null })).toBeNull();
    expect(photoWaypointFields({ ...base, lon: null })).toBeNull();
  });
});

describe('photoDay', () => {
  it('is the date it was taken, or null', () => {
    expect(photoDay('2026-07-01T14:02:10')).toBe('2026-07-01');
    expect(photoDay(null)).toBeNull();
    expect(photoDay('garbage')).toBeNull();
  });
});
