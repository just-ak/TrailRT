import { describe, expect, it } from 'vitest';
import type { ItineraryView } from '../domain/itinerary';
import type { PhotoState } from '../domain/linkedFolders';
import { itineraryTreeChildren } from '../itinerary/treeSummary';
import {
  CAMERA_TIME_HINT,
  dayPhotoText,
  fileCountLines,
  fileName,
  folderDetail,
  photoStateLines,
  photoStateText,
  subfolder,
  takenText,
} from './library';

const counts = (c: Partial<Record<PhotoState, number>>): Record<PhotoState, number> => ({
  located: 0,
  unlocated: 0,
  unreadable: 0,
  'not-downloaded': 0,
  ...c,
});

describe('folderDetail', () => {
  it('counts photos and those not on the map', () => {
    expect(folderDetail(counts({ located: 294, unlocated: 12, unreadable: 2, 'not-downloaded': 4 }), 'available')).toBe(
      '312 photos · 18 without location',
    );
    expect(folderDetail(counts({ located: 1 }), 'available')).toBe('1 photo');
    expect(folderDetail(counts({ located: 40_000 }), null)).toBe('40,000 photos');
  });

  it('says when the folder is not there, or being read', () => {
    expect(folderDetail(counts({ located: 3 }), 'missing')).toBe('3 photos · unavailable');
    expect(folderDetail(counts({ located: 3 }), 'denied')).toBe('3 photos · no access');
    expect(folderDetail(counts({}), 'scanning')).toBe('no photos · scanning');
  });
});

describe('the properties panel', () => {
  it('counts files of kinds this phase does not read, and says so', () => {
    expect(fileCountLines({ photo: 29, geodata: 2, video: 1 })).toEqual([
      '29 photos',
      '2 GPX and track files (listed, read in a later version)',
      '1 video (listed, not shown yet)',
    ]);
  });

  it('says when nothing recognised is in the folder yet', () => {
    expect(fileCountLines({ photo: 0, geodata: 0, video: 0 })).toEqual(['No files TrailRT recognises yet']);
  });

  it('lists only the photo states present', () => {
    expect(photoStateLines(counts({ located: 20, unlocated: 5, unreadable: 4 }))).toEqual([
      '20 on the map',
      '5 with no location',
      '4 unreadable',
    ]);
    expect(photoStateLines(counts({ 'not-downloaded': 2 }))).toEqual(['2 not downloaded from iCloud']);
  });
});

describe('photo list rows', () => {
  it('says why each state is not on the map', () => {
    expect(photoStateText({ state: 'located', reason: null })).toBe('');
    expect(photoStateText({ state: 'unlocated', reason: 'No location recorded in this photo' })).toBe('No location');
    expect(
      photoStateText({ state: 'unlocated', reason: 'Location recorded as 0°, 0° — usually a camera with no GPS fix' }),
    ).toBe('No location — location recorded as 0°, 0° — usually a camera with no GPS fix');
    expect(photoStateText({ state: 'not-downloaded', reason: 'Not downloaded' })).toBe('Not downloaded from iCloud');
    expect(photoStateText({ state: 'unreadable', reason: 'Not a HEIC image' })).toBe('Unreadable — not a HEIC image');
    expect(photoStateText({ state: 'unreadable', reason: 'HEIC stores it oddly' })).toBe('Unreadable — HEIC stores it oddly');
  });

  it('says a photo is unavailable while its folder is, whatever was read', () => {
    expect(photoStateText({ state: 'located', reason: null }, 'missing')).toBe('Unavailable');
    expect(photoStateText({ state: 'unlocated', reason: null }, 'denied')).toBe('Unavailable');
  });

  it('shows the wall clock as recorded, with its zone or "camera time"', () => {
    expect(takenText({ takenLocal: '2026-05-01T14:03:09', takenOffsetMin: 60 })).toBe('1 May 2026, 14:03 (UTC+01:00)');
    expect(takenText({ takenLocal: '2026-05-01T14:03:09', takenOffsetMin: -330 })).toBe('1 May 2026, 14:03 (UTC−05:30)');
    expect(takenText({ takenLocal: '2026-12-31T23:59:59', takenOffsetMin: null })).toBe('31 Dec 2026, 23:59 (camera time)');
    expect(takenText({ takenLocal: null, takenOffsetMin: null })).toBe('No date');
  });

  it('splits a path into the name and the subfolder', () => {
    expect(fileName('Day 2/Lunch/IMG_0001.HEIC')).toBe('IMG_0001.HEIC');
    expect(subfolder('Day 2/Lunch/IMG_0001.HEIC')).toBe('Day 2/Lunch');
    expect(fileName('IMG_0001.JPG')).toBe('IMG_0001.JPG');
    expect(subfolder('IMG_0001.JPG')).toBeNull();
  });
});

const day = (date: string) => ({
  date,
  driveSeconds: 0,
  driveDistanceM: 0,
  otherSeconds: 0,
  nightStopId: null,
  overDailyCap: false,
  incomplete: false,
});

describe('photos per day in a dated trip', () => {
  // Only what the tree reads: two days, no stops.
  const view = {
    itinerary: { tripId: 't' },
    stops: [],
    timeline: {
      calendarZone: 'Europe/London',
      calendarZoneKnown: true,
      stops: [],
      days: [day('2026-05-01'), day('2026-05-02'), day('2026-05-03')],
      endDate: '2026-05-03',
      complete: true,
    },
  } as unknown as ItineraryView;
  const build = {
    route: () => ({ id: 'r', kind: 'route' as const, name: 'r', children: [] }),
    track: () => ({ id: 't', kind: 'track' as const, name: 't', children: [] }),
    waypoint: () => ({ id: 'w', kind: 'waypoint' as const, name: 'w', children: [] }),
  };

  it('adds the count to each day with photos, and flags camera time', () => {
    const children = itineraryTreeChildren(view, { routes: [], tracks: [], waypoints: [] }, 'trip:t', build, new Map([
      ['2026-05-01', { count: 23, cameraTime: 0 }],
      ['2026-05-02', { count: 5, cameraTime: 2 }],
    ]));
    const [first, second, third] = children;
    expect(first?.detail).toBe('no travel · 23 photos');
    expect(first?.hint).toBeUndefined();
    expect(second?.detail).toBe('no travel · 5 photos (camera time)');
    expect(second?.hint).toBe(CAMERA_TIME_HINT);
    expect(third?.detail).toBe('no travel');
  });

  it('is unchanged for a trip with no photos', () => {
    const children = itineraryTreeChildren(view, { routes: [], tracks: [], waypoints: [] }, 'trip:t', build);
    expect(children.map((c) => c.detail)).toEqual(['no travel', 'no travel', 'no travel']);
  });

  it('words a day count', () => {
    expect(dayPhotoText({ count: 1, cameraTime: 0 })).toBe('1 photo');
    expect(dayPhotoText({ count: 23, cameraTime: 1 })).toBe('23 photos (camera time)');
  });
});
