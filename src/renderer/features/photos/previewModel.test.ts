import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Photo, PhotoDetails } from '@shared/domain/linkedFolders';
import { usePhotoStore } from '../../stores/photoStore';
import { NO_PHOTO_SELECTION } from './photoSelection';
import { CAMERA_TIME_PREVIEW_HINT, previewModel, type PreviewInput } from './previewModel';

const BASE: Photo = {
  id: 'p1',
  folderId: 'f1',
  relativePath: 'Day 1/buxton.jpg',
  kind: 'photo',
  format: 'jpeg',
  sizeBytes: 41_212,
  mtimeMs: 1,
  fingerprint: null,
  state: 'located',
  reason: null,
  lat: 53.259,
  lon: -1.911,
  altitudeM: 300.5,
  accuracyM: 8,
  directionDeg: 271.25,
  directionRef: 'T',
  takenLocal: '2026-06-14T10:32:00',
  takenOffsetMin: 60,
  orientation: 1,
};

/** The bridge's answer when there is nothing: a failed Result, never a throw. */
const none = () => Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'none' } });

function input(photo: Partial<Photo>, more: Partial<PreviewInput> = {}): PreviewInput {
  const details: PhotoDetails = { photo: { ...BASE, ...photo }, folderName: 'Peak 2026', tripId: 't1' };
  return { details, folderState: 'available', units: 'metric', sequence: ['p1'], inBurst: false, ...more };
}

afterEach(() => {
  usePhotoStore.setState({ selection: NO_PHOTO_SELECTION, burst: null, sequence: [], anchorDetails: null });
});

describe('the preview box', () => {
  it('shows a located photo’s name, path, time with its zone, and location with altitude and accuracy', () => {
    const m = previewModel(input({}));
    expect(m.name).toBe('buxton.jpg');
    expect(m.pathHint).toBe('Peak 2026/Day 1/buxton.jpg');
    expect(m.taken).toBe('14 Jun 2026, 10:32 (UTC+01:00)');
    expect(m.takenHint).toBeNull();
    expect(m.location).toBe('53.25900° N, 1.91100° W');
    expect(m.altitude).toBe('301 m');
    expect(m.accuracy).toBe('±8 m');
    expect(m.noLocation).toBeNull();
    expect(m.status).toBeNull();
    expect([m.canZoom, m.canOpen, m.canReveal]).toEqual([true, true, true]);
  });

  it('shows altitude and accuracy in the user’s units', () => {
    const m = previewModel(input({}, { units: 'imperial' }));
    expect(m.altitude).toBe('986 ft');
    expect(m.accuracy).toBe('±26 ft');
  });

  it('shows nothing at all for an absent altitude or accuracy: no dash, no zero', () => {
    const m = previewModel(input({ altitudeM: null, accuracyM: null }));
    expect(m.altitude).toBeNull();
    expect(m.accuracy).toBeNull();
    expect(m.location).not.toBeNull();
  });

  it('labels camera time, and explains it', () => {
    const m = previewModel(input({ takenOffsetMin: null }));
    expect(m.taken).toBe('14 Jun 2026, 10:32 · camera time');
    expect(m.takenHint).toBe(CAMERA_TIME_PREVIEW_HINT);
    expect(previewModel(input({ takenLocal: null, takenOffsetMin: null })).taken).toBe('No date');
  });

  it('says "No location" and why, and cannot zoom', () => {
    const m = previewModel(
      input({ state: 'unlocated', lat: null, lon: null, reason: 'Location recorded as 0°, 0° — usually a camera with no GPS fix' }),
    );
    expect(m.location).toBeNull();
    expect(m.altitude).toBeNull();
    expect(m.noLocation).toBe('No location — location recorded as 0°, 0° — usually a camera with no GPS fix');
    expect(m.canZoom).toBe(false);
    expect(m.zoomHint).toMatch(/no location/);
    expect(m.canOpen).toBe(true);
  });

  it('says why a photo could not be read', () => {
    const m = previewModel(input({ state: 'unreadable', lat: null, lon: null, reason: 'The file is truncated' }));
    expect(m.noLocation).toBe('Unreadable — the file is truncated');
  });

  it('says a photo is not downloaded, and offers Show in Finder but not Open', () => {
    const m = previewModel(input({ state: 'not-downloaded', lat: null, lon: null, reason: 'Not downloaded' }));
    expect(m.status).toBe('Not downloaded from iCloud — open it in Finder to download');
    expect(m.noLocation).toBeNull();
    expect(m.canOpen).toBe(false);
    expect(m.canReveal).toBe(true);
  });

  it('says a photo is unavailable when its folder is not there, whatever was read', () => {
    const missing = previewModel(input({}, { folderState: 'missing' }));
    expect(missing.status).toBe('Unavailable — Peak 2026 is not connected');
    expect([missing.canOpen, missing.canReveal]).toEqual([false, false]);
    expect(missing.location).not.toBeNull(); // where it was taken is still known
    expect(previewModel(input({}, { folderState: 'denied' })).status).toBe(
      'Unavailable — TrailRT has no access to Peak 2026',
    );
  });

  it('counts the position in the folder, and within a burst says "here"', () => {
    expect(previewModel(input({}, { sequence: ['p0', 'p1', 'p2'] })).position).toBe('2 of 3');
    expect(previewModel(input({}, { sequence: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], inBurst: true })).position).toBe(
      '1 of 7 here',
    );
    expect(previewModel(input({})).position).toBeNull();
  });

  it('disables previous on the first and next on the last', () => {
    const first = previewModel(input({}, { sequence: ['p1', 'p2'] }));
    expect([first.canStepBack, first.canStepForward]).toEqual([false, true]);
    const last = previewModel(input({ id: 'p2' }, { sequence: ['p1', 'p2'] }));
    expect([last.canStepBack, last.canStepForward]).toEqual([true, false]);
  });
});

describe('stepping through a burst', () => {
  // Stepping loads the next photo's details through the bridge; here it
  // answers that there are none, which is all these tests need.
  beforeEach(() => {
    vi.stubGlobal('window', { trailrt: { photos: { get: none, list: none } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('moves within the burst and stops at either end', () => {
    usePhotoStore.setState({
      selection: { ids: new Set(['b1']), anchor: 'b1' },
      burst: ['b1', 'b2', 'b3'],
      sequence: ['b1', 'b2', 'b3'],
    });
    const { step } = usePhotoStore.getState();
    step(-1);
    expect(usePhotoStore.getState().selection.anchor).toBe('b1');
    step(1);
    step(1);
    expect(usePhotoStore.getState().selection.anchor).toBe('b3');
    step(1);
    expect(usePhotoStore.getState().selection.anchor).toBe('b3');
    expect(usePhotoStore.getState().burst).toEqual(['b1', 'b2', 'b3']);
  });

  it('closing clears the photo and the burst', () => {
    usePhotoStore.setState({ selection: { ids: new Set(['b1']), anchor: 'b1' }, burst: ['b1', 'b2'], sequence: ['b1', 'b2'] });
    usePhotoStore.getState().closePreview();
    expect(usePhotoStore.getState().selection.anchor).toBeNull();
    expect(usePhotoStore.getState().burst).toBeNull();
  });
});
