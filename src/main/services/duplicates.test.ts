import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import type { ParsedTrackPoint } from '@shared/io/types';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as trackRepo from '../db/repositories/tracks';
import { applyCommand, type Command } from './commands';
import * as duplicateService from './duplicateService';
import * as itineraryService from './itineraryService';
import * as routeService from './routeService';
import * as trackService from './trackService';
import * as tripService from './tripService';
import * as waypointService from './waypointService';

/**
 * Phase 14 Requirement 28 through the real database: what counts as the same
 * content, the copy kept, and removal as one undo step, a track rebuilt from
 * its twin with its original file (ADR 0027).
 */

let dir: string;
let handle: DbHandle;
let db: Db;
let peak: string;
let wales: string;

beforeEach(() => {
  // Each item a second younger than the last, so "the oldest" is the first made.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-24T09:00:00Z'));
  dir = mkdtempSync(join(tmpdir(), 'trailrt-duplicates-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  peak = tripService.create(db, { name: 'Peak', folderId: null, description: null, notes: null }).result.id;
  wales = tripService.create(db, { name: 'Wales', folderId: null, description: null, notes: null }).result.id;
});

afterEach(() => {
  vi.useRealTimers();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse('2026-05-16T09:00:00Z');
const at = (place: { lat: number; lon: number }, ele: number | null, time: number | null): ParsedTrackPoint => ({ lat: place.lat, lon: place.lon, ele, time });
const RIDE = [at(BUXTON, 300, T0), at(LEEK, 200, T0 + 60_000), at(ASHBOURNE, 150, T0 + 120_000)];

const tick = (): void => void vi.setSystemTime(Date.now() + 1000);

function track(name: string, segments: ParsedTrackPoint[][], trip = peak, file?: string): string {
  tick();
  return trackService.createFromParsed(db, {
    tripId: trip,
    parsed: { name, segments: segments.map((points) => ({ points })), metadata: { desc: name } },
    source: 'import',
    ...(file === undefined ? {} : { originalBytes: new TextEncoder().encode(file), originalFormat: 'gpx' }),
  }).result.id;
}

function waypoint(name: string, place: { lat: number; lon: number }, trip = peak, eleM: number | null = null): string {
  tick();
  return waypointService.create(db, { tripId: trip, name, lat: place.lat, lon: place.lon, eleM, description: null, symbol: 'pin', notes: null, groupId: null }).result.id;
}

function route(name: string, places: { lat: number; lon: number }[], trip = peak): string {
  tick();
  return routeService.create(db, { tripId: trip, name, colour: null, points: places.map((p) => ({ lat: p.lat, lon: p.lon, ele: null, name: null, symbol: null, notes: null })) }).result.id;
}

const pairs = (kind: Parameters<typeof duplicateService.find>[1]) =>
  duplicateService.find(db, kind, true).groups.flatMap((g) => g.remove.map((r) => ({ id: r.id, keepId: g.keep.id })));

describe('what counts as the same content', () => {
  it('finds tracks with the same points whatever their names', () => {
    const a = track('Morning ride', [RIDE]);
    const b = track('2026-05-16 export', [RIDE]);
    track('Different', [RIDE.slice(0, 2)]);
    const report = duplicateService.find(db, 'track', true);
    expect(report.compared).toBe(3);
    expect(report.groups.map((g) => [g.keep.id, g.remove.map((r) => r.id)])).toEqual([[a, [b]]]);
  });

  it('is exact: one elevation, one time or a segment break makes a different track', () => {
    track('Base', [RIDE]);
    track('Higher', [[at(BUXTON, 300.000001, T0), ...RIDE.slice(1)]]);
    track('Later', [[...RIDE.slice(0, 2), at(ASHBOURNE, 150, T0 + 120_001)]]);
    track('No height', [[at(BUXTON, null, T0), ...RIDE.slice(1)]]);
    track('Broken', [RIDE.slice(0, 1), RIDE.slice(1)]);
    expect(duplicateService.find(db, 'track', true).groups).toEqual([]);
  });

  it('compares waypoints by position and elevation, and routes by their points', () => {
    waypoint('Buxton', BUXTON);
    waypoint('Pavilion Gardens', BUXTON);
    waypoint('Buxton, on the hill', BUXTON, peak, 310);
    route('Cat and Fiddle', [MACCLESFIELD, BUXTON]);
    route('A537', [MACCLESFIELD, BUXTON]);
    route('Back the other way', [BUXTON, MACCLESFIELD]);
    expect(duplicateService.find(db, 'waypoint', true).groups.map((g) => [g.keep.name, g.remove.map((r) => r.name)])).toEqual([
      ['Buxton', ['Pavilion Gardens']],
    ]);
    expect(duplicateService.find(db, 'route', true).groups.map((g) => [g.keep.name, g.remove.map((r) => r.name)])).toEqual([
      ['Cat and Fiddle', ['A537']],
    ]);
  });

  it('leaves archived trips out unless they are shown, and keeps the copy in a trip over one outside', () => {
    const loose = tripService.looseTripId(db);
    const outside = waypoint('Outside', LEEK, loose);
    const inTrip = waypoint('In Wales', LEEK, wales);
    expect(duplicateService.find(db, 'waypoint', true).groups[0]).toMatchObject({ keep: { id: inTrip }, remove: [{ id: outside, loose: true }], acrossTrips: false });
    tripService.setStatus(db, { id: wales, status: 'archived' });
    expect(duplicateService.find(db, 'waypoint', false).groups).toEqual([]);
  });

  it('never removes a waypoint a plan uses, and marks copies in two trips', () => {
    const first = waypoint('Hotel', ASHBOURNE, wales);
    const planned = waypoint('Hotel', ASHBOURNE);
    itineraryService.create(db, { tripId: peak, startDate: '2026-05-16', startTime: '09:00' });
    itineraryService.addStop(db, { tripId: peak, waypointId: planned });
    const [group] = duplicateService.find(db, 'waypoint', true).groups;
    expect(group).toMatchObject({ keep: { id: planned, inPlan: true }, remove: [{ id: first }], acrossTrips: true });
    // Asked to remove the planned one anyway, it is skipped.
    expect(duplicateService.remove(db, 'waypoint', [{ id: planned, keepId: first }]).result).toEqual({ removed: 0, skipped: 1, undoable: false });
  });
});

describe('removing, as one undo step', () => {
  it('removes duplicate tracks and undo rebuilds each from the copy kept, with its row and original file', () => {
    const keep = track('Ride', [RIDE.slice(0, 1), RIDE.slice(1)], peak, '<gpx>one</gpx>');
    const same = track('Ride again', [RIDE.slice(0, 1), RIDE.slice(1)], wales, '<gpx>one</gpx>');
    const other = track('Ride, other export', [RIDE.slice(0, 1), RIDE.slice(1)], peak, '<gpx>two</gpx>');
    const before = trackRepo.rawTrack(db, other);
    const points = trackRepo.listTrackPoints(db, other);

    const removal = duplicateService.remove(db, 'track', pairs('track'));
    expect(removal.result).toEqual({ removed: 2, skipped: 0, undoable: true });
    expect(trackRepo.findTrack(db, same)).toBeNull();
    expect(trackRepo.findTrack(db, other)).toBeNull();
    // The second export's file went with its only track; the shared one stayed.
    expect(trackRepo.sourceLinkCount(db, trackRepo.findTrackSource(db, keep)?.contentHash ?? '')).toBe(1);

    const undone = applyCommand(db, removal.inverse as Command);
    expect(trackRepo.rawTrack(db, other)).toEqual(before);
    expect(trackRepo.listTrackPoints(db, other)).toEqual(points);
    expect(trackRepo.findTrack(db, same)?.tripId).toBe(wales);
    expect(new TextDecoder().decode(trackService.originalBytes(db, other)?.bytes)).toBe('<gpx>two</gpx>');
    expect(new TextDecoder().decode(trackService.originalBytes(db, same)?.bytes)).toBe('<gpx>one</gpx>');

    // Redo removes them again.
    applyCommand(db, undone.inverse as Command);
    expect(trackRepo.findTrack(db, same)).toBeNull();
    expect(trackRepo.findTrack(db, other)).toBeNull();
  });

  it('refuses to put a track back once the copy kept has changed or gone', () => {
    const keep = track('Ride', [RIDE]);
    track('Copy', [RIDE]);
    const removal = duplicateService.remove(db, 'track', pairs('track'));
    // A change that cannot be undone, such as a join, rewrites the kept points.
    db.transaction(() => trackRepo.replaceTrackPoints(db, keep, [{ points: [{ segmentIndex: 0, seq: 0, lat: 0, lon: 0, eleM: null, recordedAt: null }] }]));
    expect(() => applyCommand(db, removal.inverse as Command)).toThrow(/has changed since/);
    trackRepo.deleteTrack(db, keep);
    expect(() => applyCommand(db, removal.inverse as Command)).toThrow(/has since been deleted/);
  });

  it('undoes routes and waypoints through their own restore', () => {
    route('Cat and Fiddle', [MACCLESFIELD, BUXTON]);
    const copy = route('A537', [MACCLESFIELD, BUXTON]);
    const removal = duplicateService.remove(db, 'route', pairs('route'));
    expect(() => routeService.get(db, copy)).toThrow();
    applyCommand(db, removal.inverse as Command);
    expect(routeService.get(db, copy).name).toBe('A537');

    waypoint('Leek', LEEK);
    const second = waypoint('Leek market', LEEK);
    const gone = duplicateService.remove(db, 'waypoint', pairs('waypoint'));
    expect(gone.result.removed).toBe(1);
    expect(() => waypointService.get(db, second)).toThrow();
    applyCommand(db, gone.inverse as Command);
    expect(duplicateService.find(db, 'waypoint', true).groups[0]?.remove[0]?.id).toBe(second);
  });

  it('skips a pair that changed after the dialog opened', () => {
    const keep = waypoint('Leek', LEEK);
    const copy = waypoint('Leek market', LEEK);
    waypointService.update(db, { id: copy, name: 'Leek market', lat: LEEK.lat + 0.001, lon: LEEK.lon, eleM: null, description: null, symbol: 'pin', notes: null });
    expect(duplicateService.remove(db, 'waypoint', [{ id: copy, keepId: keep }]).result).toEqual({ removed: 0, skipped: 1, undoable: false });
  });
});
