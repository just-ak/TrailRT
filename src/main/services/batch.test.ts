import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BatchMember, RoutePoint } from '@shared/domain/types';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import type { ParsedTrack, ParsedTrackPoint } from '@shared/io/types';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as batchService from './batchService';
import { applyCommand, isUndoable } from './commands';
import { ServiceError } from './errors';
import * as routeService from './routeService';
import * as trackService from './trackService';
import * as tripService from './tripService';
import * as undoService from './undoService';
import * as waypointService from './waypointService';

/**
 * Phase 5: batch operations, the track undo repair, and point-level editing.
 *
 * The track assertions are deliberately blunt about the bug they cover: before
 * this phase `commands.ts` registered no `track:*` handlers, so every track
 * inverse was silently discarded by `record()`. These tests fail against that
 * state, which is the point of having them.
 */

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;
let otherTripId: string;

const p = (lat: number, lon: number): RoutePoint => ({
  lat,
  lon,
  ele: null,
  name: null,
  symbol: null,
  notes: null,
});

const tp = (
  lat: number,
  lon: number,
  ele: number | null = null,
  time: number | null = null,
): ParsedTrackPoint => ({ lat, lon, ele, time });

const parsed = (segments: ParsedTrackPoint[][], name = 'Track'): ParsedTrack => ({
  name,
  segments: segments.map((points) => ({ points })),
  metadata: {},
});

function newTrip(name: string): string {
  return tripService.create(db, {
    name,
    folderId: null,
    description: null,
    notes: null,
  }).result.id;
}

function newRoute(points: RoutePoint[], name = 'Route'): string {
  return routeService.create(db, { tripId, name, colour: null, points }).result
    .id;
}

function newTrack(segments: ParsedTrackPoint[][], name = 'Track'): string {
  return trackService.createFromParsed(db, {
    tripId,
    parsed: parsed(segments, name),
    source: 'user',
  }).result.id;
}

function newWaypoint(name = 'Waypoint'): string {
  return waypointService.create(db, {
    tripId,
    name,
    lat: BUXTON.lat,
    lon: BUXTON.lon,
    eleM: null,
    description: null,
    symbol: 'pin',
    notes: null,
    groupId: null,
  }).result.id;
}

/** Flat point list across all segments, which is what the table indexes. */
function flatPoints(id: string): { lat: number; lon: number }[] {
  return trackService
    .get(db, id)
    .segments.flatMap((s) => s.points.map((q) => ({ lat: q.lat, lon: q.lon })));
}

/**
 * Which sample each surviving point was, by its position along the run.
 *
 * `run()` spaces points a thousandth of a degree apart from Buxton, so the
 * offset recovers the ordinal. Asserting on ordinals keeps the expectations
 * readable — `[0, 3, 4, 5]` says "the first and the last three" — while the
 * fixture stays real geography rather than longitude 0, 1, 2.
 */
function ordinals(id: string): number[] {
  return flatPoints(id).map((point) =>
    Math.round((point.lon - BUXTON.lon) / 0.001),
  );
}

function segmentShape(id: string): number[] {
  return trackService.get(db, id).segments.map((s) => s.points.length);
}

/**
 * A straight run of `n` points heading east from Buxton.
 *
 * Spaced a thousandth of a degree apart — roughly 70 m — so the run is a
 * plausible recording rather than a line across the county. `lat` shifts the
 * whole run, which is how a second segment is made distinguishable from the
 * first.
 */
function run(n: number, lat = BUXTON.lat): ParsedTrackPoint[] {
  return Array.from({ length: n }, (_, i) =>
    tp(lat, BUXTON.lon + i * 0.001, 300 + i, 1000 + i),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-batch-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  undoService.clear();
  tripId = newTrip('Trip');
  otherTripId = newTrip('Other');
});

afterEach(() => {
  undoService.clear();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------- task 1: the track undo gap

describe('track undo handlers', () => {
  it('undoes a track rename, which was silently discarded before', () => {
    const id = newTrack([run(4)], 'Before');
    undoService.record(
      trackService.update(db, { id, name: 'After' }).inverse,
    );

    expect(undoService.state().canUndo).toBe(true);
    expect(undoService.state().undoLabel).toBe('track edit');

    undoService.undo(db);
    expect(trackService.summary(db, id).name).toBe('Before');
  });

  it('undoes a track move between trips', () => {
    const id = newTrack([run(3)]);
    undoService.record(
      trackService.moveToTrip(db, { id, tripId: otherTripId }).inverse,
    );
    expect(trackService.summary(db, id).tripId).toBe(otherTripId);

    undoService.undo(db);
    expect(trackService.summary(db, id).tripId).toBe(tripId);
  });

  it('undoes a track reverse', () => {
    const id = newTrack([run(4)]);
    const before = flatPoints(id);

    undoService.record(trackService.reverse(db, id).inverse);
    expect(ordinals(id)).toEqual([3, 2, 1, 0]);

    undoService.undo(db);
    expect(flatPoints(id)).toEqual(before);
  });

  it('undoes a range deletion, restoring the points', () => {
    const id = newTrack([run(6)]);
    undoService.record(trackService.deletePointRange(db, id, 1, 2).inverse);
    expect(ordinals(id)).toEqual([0, 3, 4, 5]);

    undoService.undo(db);
    expect(ordinals(id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('restores the segment structure a range deletion collapsed', () => {
    // `deletePointRange` flattens to one segment by design — it is a trim. Its
    // inverse carries the breaks, so undoing it must not leave the collapse
    // behind.
    const id = newTrack([run(3), run(3, BUXTON.lat + 0.01)]);
    expect(segmentShape(id)).toEqual([3, 3]);

    undoService.record(trackService.deletePointRange(db, id, 0, 0).inverse);
    expect(segmentShape(id)).toEqual([5]);

    undoService.undo(db);
    expect(segmentShape(id)).toEqual([3, 3]);
  });

  it('redoes a range deletion after undoing it', () => {
    const id = newTrack([run(5)]);
    undoService.record(trackService.deletePointRange(db, id, 0, 1).inverse);

    undoService.undo(db);
    expect(trackService.summary(db, id).pointCount).toBe(5);

    undoService.redo(db);
    expect(trackService.summary(db, id).pointCount).toBe(3);
  });

  it('still reports a track deletion as not undoable', () => {
    // ADR 0003: the point array is too large to carry. The retained original
    // file is the recovery path, and saying so beats a broken Undo item.
    const id = newTrack([run(4)]);
    undoService.record(trackService.remove(db, id).inverse);
    expect(undoService.state().canUndo).toBe(false);
  });

  it('still reports a split as not undoable', () => {
    // `split` emits `track:join`, whose own inverse is 'none'. Registering it
    // would make undo succeed and the matching redo silently do nothing.
    const id = newTrack([run(6)]);
    undoService.record(trackService.split(db, id, 3).inverse);
    expect(undoService.state().canUndo).toBe(false);
  });
});

// -------------------------------------------- task 2: the composite command

describe('the batch command', () => {
  it('is one undo entry, however many members it has', () => {
    const ids = [newRoute([p(0, 0)]), newRoute([p(1, 1)]), newRoute([p(2, 2)])];
    const members: BatchMember[] = ids.map((id) => ({ kind: 'route', id }));

    const mutation = batchService.remove(db, members);
    undoService.record(mutation.inverse);

    expect(undoService.state().canUndo).toBe(true);

    undoService.undo(db);
    for (const id of ids) expect(routeService.get(db, id).id).toBe(id);
    // One press, not three.
    expect(undoService.state().canUndo).toBe(false);
  });

  it('unwinds in the reverse of the order it applied', () => {
    const order: string[] = [];
    const mutation = applyCommand(db, {
      kind: 'batch',
      payload: {
        commands: [
          { kind: 'trip:update', payload: { id: tripId, name: 'A', description: null, notes: null } },
          { kind: 'trip:update', payload: { id: tripId, name: 'B', description: null, notes: null } },
        ],
      },
    });

    // The inverse restores the names in the opposite order, which for two
    // writes to the same field means the *first* recorded original wins.
    const inverse = mutation.inverse.payload.commands as {
      payload: { name: string };
    }[];
    for (const command of inverse) order.push(command.payload.name);

    // Applied A then B, so the inverses are [restore-to-A, restore-to-Trip]
    // reversed => the final state after undo is the original.
    expect(order).toEqual(['A', 'Trip']);

    applyCommand(db, mutation.inverse);
    expect(tripService.get(db, tripId).name).toBe('Trip');
  });

  it('records nothing when every member is non-undoable', () => {
    const members: BatchMember[] = [
      { kind: 'track', id: newTrack([run(3)], 'T1') },
      { kind: 'track', id: newTrack([run(3)], 'T2') },
    ];

    const mutation = batchService.remove(db, members);
    undoService.record(mutation.inverse);

    // A step that does nothing is worse than no step at all.
    expect(undoService.state().canUndo).toBe(false);
  });

  it('reports a batch of only non-undoable children as not undoable', () => {
    expect(
      isUndoable({
        kind: 'batch',
        payload: { commands: [{ kind: 'none', payload: {} }] },
      }),
    ).toBe(false);
  });

  it('reports a batch with one undoable child as undoable', () => {
    expect(
      isUndoable({
        kind: 'batch',
        payload: {
          commands: [
            { kind: 'none', payload: {} },
            { kind: 'trip:update', payload: { id: tripId, name: 'X' } },
          ],
        },
      }),
    ).toBe(true);
  });

  it('applies nothing when a member fails mid-batch', () => {
    const keep = newRoute([p(0, 0)], 'Keep');

    expect(() =>
      applyCommand(db, {
        kind: 'batch',
        payload: {
          commands: [
            { kind: 'route:update', payload: { id: keep, name: 'Renamed', colour: null } },
            // A route that does not exist: the whole transaction must roll back.
            {
              kind: 'route:update',
              payload: {
                id: '00000000-0000-4000-8000-000000000000',
                name: 'Nope',
                colour: null,
              },
            },
          ],
        },
      }),
    ).toThrow(ServiceError);

    expect(routeService.get(db, keep).name).toBe('Keep');
  });

  it('refuses a malformed child rather than applying the valid ones', () => {
    expect(() =>
      applyCommand(db, {
        kind: 'batch',
        payload: { commands: [{ kind: 'route:update' }] },
      }),
    ).toThrow(/malformed/i);
  });
});

// ------------------------------------------------------ task 3: batch service

describe('batchService.assess', () => {
  it('counts members by kind', () => {
    const members: BatchMember[] = [
      { kind: 'route', id: newRoute([p(0, 0)]) },
      { kind: 'route', id: newRoute([p(1, 1)]) },
      { kind: 'track', id: newTrack([run(3)]) },
      { kind: 'waypoint', id: newWaypoint() },
    ];

    const assessment = batchService.assess(db, members, 'delete');
    expect(assessment.counts).toEqual({ route: 2, track: 1, waypoint: 1 });
    expect(assessment.total).toBe(4);
  });

  it('names the track deletions that cannot be reversed', () => {
    const trackId = newTrack([run(50)]);
    const assessment = batchService.assess(
      db,
      [
        { kind: 'route', id: newRoute([p(0, 0)]) },
        { kind: 'track', id: trackId },
      ],
      'delete',
    );

    expect(assessment.undoable).toBe(true);
    expect(assessment.notUndoable).toEqual([{ kind: 'track', id: trackId }]);
    expect(assessment.irreversiblePoints).toBe(50);
    expect(assessment.reason).toMatch(/cannot be undone/i);
    expect(assessment.reason).toMatch(/50/);
  });

  it('treats a move as always reversible', () => {
    const assessment = batchService.assess(
      db,
      [
        { kind: 'track', id: newTrack([run(3)]) },
        { kind: 'route', id: newRoute([p(0, 0)]) },
      ],
      'move',
    );

    expect(assessment.undoable).toBe(true);
    expect(assessment.notUndoable).toEqual([]);
    expect(assessment.reason).toBeNull();
    expect(assessment.irreversiblePoints).toBeNull();
  });

  it('lists a vanished member as missing rather than failing', () => {
    // Requirement 1.9: a refresh racing a selection is ordinary.
    const gone = '00000000-0000-4000-8000-000000000001';
    const assessment = batchService.assess(
      db,
      [{ kind: 'route', id: gone }],
      'delete',
    );

    expect(assessment.missing).toEqual([{ kind: 'route', id: gone }]);
    expect(assessment.total).toBe(0);
  });

  it('counts a duplicated member once', () => {
    const id = newRoute([p(0, 0)]);
    const assessment = batchService.assess(
      db,
      [
        { kind: 'route', id },
        { kind: 'route', id },
      ],
      'delete',
    );
    expect(assessment.total).toBe(1);
  });

  it('refuses a selection past the bound, with the number', () => {
    const members: BatchMember[] = Array.from(
      { length: batchService.MAX_BATCH_MEMBERS + 1 },
      (_, i) => ({
        kind: 'route',
        // Distinct ids: the bound is on the count, so they need not exist.
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      }),
    );

    expect(() => batchService.assess(db, members, 'delete')).toThrow(
      new RegExp(`${batchService.MAX_BATCH_MEMBERS + 1} objects`),
    );
  });

  it('matches what the batch actually records', () => {
    const members: BatchMember[] = [
      { kind: 'route', id: newRoute([p(0, 0)]) },
      { kind: 'track', id: newTrack([run(3)]) },
    ];

    const predicted = batchService.assess(db, members, 'delete');
    const mutation = batchService.remove(db, members);

    expect(mutation.result.undoable).toBe(predicted.undoable);
    expect(mutation.result.notUndoable).toEqual(predicted.notUndoable);
    expect(undoService.record(mutation.inverse).canUndo).toBe(
      predicted.undoable,
    );
  });
});

describe('batchService.remove', () => {
  it('deletes a mixture and restores only what it said it could', () => {
    const routeId = newRoute([p(0, 0)], 'R');
    const trackId = newTrack([run(3)], 'T');
    const waypointId = newWaypoint('W');

    const mutation = batchService.remove(db, [
      { kind: 'route', id: routeId },
      { kind: 'track', id: trackId },
      { kind: 'waypoint', id: waypointId },
    ]);
    undoService.record(mutation.inverse);

    expect(mutation.result.applied).toBe(3);
    expect(() => routeService.get(db, routeId)).toThrow();
    expect(() => trackService.get(db, trackId)).toThrow();

    undoService.undo(db);

    expect(routeService.get(db, routeId).name).toBe('R');
    expect(waypointService.get(db, waypointId).name).toBe('W');
    // The track stays gone, exactly as the assessment warned.
    expect(() => trackService.get(db, trackId)).toThrow();
  });

  it('refuses when nothing in the selection exists any more', () => {
    expect(() =>
      batchService.remove(db, [
        { kind: 'route', id: '00000000-0000-4000-8000-000000000002' },
      ]),
    ).toThrow(/nothing was deleted/i);
  });
});

describe('batchService.moveToTrip', () => {
  it('moves every kind and undoes in one step', () => {
    const routeId = newRoute([p(0, 0)]);
    const trackId = newTrack([run(3)]);
    const waypointId = newWaypoint();

    const mutation = batchService.moveToTrip(
      db,
      [
        { kind: 'route', id: routeId },
        { kind: 'track', id: trackId },
        { kind: 'waypoint', id: waypointId },
      ],
      otherTripId,
    );
    undoService.record(
      mutation.inverse,
      batchService.labelFor('move', mutation.result.counts),
    );

    expect(routeService.get(db, routeId).tripId).toBe(otherTripId);
    expect(trackService.summary(db, trackId).tripId).toBe(otherTripId);
    expect(waypointService.get(db, waypointId).tripId).toBe(otherTripId);

    expect(undoService.state().undoLabel).toBe(
      'move 1 route, 1 track and 1 waypoint',
    );

    undoService.undo(db);

    expect(routeService.get(db, routeId).tripId).toBe(tripId);
    expect(trackService.summary(db, trackId).tripId).toBe(tripId);
    expect(waypointService.get(db, waypointId).tripId).toBe(tripId);
  });

  it('refuses a destination trip that does not exist', () => {
    expect(() =>
      batchService.moveToTrip(
        db,
        [{ kind: 'route', id: newRoute([p(0, 0)]) }],
        '00000000-0000-4000-8000-000000000003',
      ),
    ).toThrow(/trip/i);
  });
});

describe('batchService.labelFor', () => {
  it('names a single kind', () => {
    expect(batchService.labelFor('delete', { route: 1, track: 0, waypoint: 0 })).toBe(
      'delete 1 route',
    );
  });

  it('pluralises and joins', () => {
    expect(batchService.labelFor('delete', { route: 12, track: 2, waypoint: 0 })).toBe(
      'delete 12 routes and 2 tracks',
    );
  });
});

// -------------------------------- task 4: non-contiguous point deletion

describe('trackService.deletePointsAt', () => {
  it('deletes scattered indices', () => {
    const id = newTrack([run(6)]);
    trackService.deletePointsAt(db, id, [1, 3]);
    expect(ordinals(id)).toEqual([0, 2, 4, 5]);
  });

  it('preserves a segment break a deletion crosses', () => {
    const id = newTrack([run(3), run(3, BUXTON.lat + 0.01)]);
    trackService.deletePointsAt(db, id, [2, 3]);
    // Requirement 4.4: two segments, not one.
    expect(segmentShape(id)).toEqual([2, 2]);
  });

  it('preserves the break when the points either side of it both go', () => {
    const id = newTrack([run(2), run(2, BUXTON.lat + 0.01)]);
    trackService.deletePointsAt(db, id, [1, 2]);
    expect(segmentShape(id)).toEqual([1, 1]);
  });

  it('drops a segment emptied entirely, and its break with it', () => {
    const id = newTrack([run(1), run(3, BUXTON.lat + 0.01)]);
    trackService.deletePointsAt(db, id, [0]);
    expect(segmentShape(id)).toEqual([3]);
  });

  it('restores exactly on undo, structure included', () => {
    const id = newTrack([run(3), run(4, BUXTON.lat + 0.01)]);
    const before = flatPoints(id);

    undoService.record(trackService.deletePointsAt(db, id, [0, 2, 4]).inverse);
    expect(segmentShape(id)).toEqual([1, 3]);

    undoService.undo(db);
    expect(flatPoints(id)).toEqual(before);
    expect(segmentShape(id)).toEqual([3, 4]);
  });

  it('round-trips elevation and timestamps through the inverse', () => {
    const id = newTrack([
      [
        tp(BUXTON.lat, BUXTON.lon, 100, 1000),
        tp(BUXTON.lat, BUXTON.lon + 0.001, null, null),
        tp(BUXTON.lat, BUXTON.lon + 0.002, 300, 3000),
      ],
    ]);

    undoService.record(trackService.deletePointsAt(db, id, [1]).inverse);
    undoService.undo(db);

    const points = trackService.get(db, id).segments[0]?.points ?? [];
    // Absent stays absent: a missing elevation must not come back as 0.
    expect(points[1]).toEqual({
      lat: BUXTON.lat,
      lon: BUXTON.lon + 0.001,
      ele: null,
      time: null,
    });
  });

  it('redoes after an undo', () => {
    const id = newTrack([run(5)]);
    undoService.record(trackService.deletePointsAt(db, id, [1, 2]).inverse);

    undoService.undo(db);
    expect(trackService.summary(db, id).pointCount).toBe(5);

    undoService.redo(db);
    expect(ordinals(id)).toEqual([0, 3, 4]);
  });

  it('refuses to empty a track', () => {
    const id = newTrack([run(3)]);
    expect(() => trackService.deletePointsAt(db, id, [0, 1, 2])).toThrow(
      /every point/i,
    );
  });

  it('refuses indices that are not in the track', () => {
    const id = newTrack([run(3)]);
    expect(() => trackService.deletePointsAt(db, id, [99])).toThrow(
      /none of those points/i,
    );
  });

  it('ignores a duplicated index rather than deleting twice', () => {
    const id = newTrack([run(4)]);
    trackService.deletePointsAt(db, id, [1, 1, 1]);
    expect(ordinals(id)).toEqual([0, 2, 3]);
  });

  it('reports no inverse past the carried-points threshold', () => {
    // The deletion still happens; it is reported as irreversible rather than
    // claiming an inverse it would not carry.
    const total = trackService.MAX_UNDOABLE_POINT_EDITS + 2;
    const id = newTrack([run(total)]);
    const indices = Array.from(
      { length: trackService.MAX_UNDOABLE_POINT_EDITS + 1 },
      (_, i) => i,
    );

    const mutation = trackService.deletePointsAt(db, id, indices);
    expect(mutation.inverse.kind).toBe('none');
    expect(undoService.record(mutation.inverse).canUndo).toBe(false);
  });

  it('leaves deletePointRange collapsing segments, as a trim should', () => {
    const id = newTrack([run(3), run(3, BUXTON.lat + 0.01)]);
    trackService.deletePointRange(db, id, 0, 0);
    expect(segmentShape(id)).toEqual([5]);
  });
});

// ---------------------------- task 5: point editing and paged reads

describe('trackService.editPointAt', () => {
  it('corrects one sample and leaves the rest alone', () => {
    const id = newTrack([run(4)]);
    trackService.editPointAt(db, {
      id,
      index: 2,
      lat: LEEK.lat,
      lon: LEEK.lon,
      ele: 999,
      time: 5000,
    });

    const points = trackService.get(db, id).segments[0]?.points ?? [];
    expect(points[2]).toEqual({ lat: LEEK.lat, lon: LEEK.lon, ele: 999, time: 5000 });
    expect(points[1]?.lon).toBeCloseTo(BUXTON.lon + 0.001, 10);
  });

  it('keeps segment structure', () => {
    const id = newTrack([run(2), run(3, BUXTON.lat + 0.01)]);
    trackService.editPointAt(db, {
      id,
      index: 3,
      lat: ASHBOURNE.lat,
      lon: ASHBOURNE.lon,
      ele: null,
      time: null,
    });
    expect(segmentShape(id)).toEqual([2, 3]);
  });

  it('undoes to the previous values, nulls included', () => {
    const id = newTrack([
      [
        tp(BUXTON.lat, BUXTON.lon, null, null),
        tp(BUXTON.lat, BUXTON.lon + 0.001, 200, 2000),
      ],
    ]);

    undoService.record(
      trackService.editPointAt(db, {
        id,
        index: 0,
        lat: ASHBOURNE.lat,
        lon: ASHBOURNE.lon,
        ele: 500,
        time: 9000,
      }).inverse,
    );
    expect(undoService.state().undoLabel).toBe('point edit');

    undoService.undo(db);

    const points = trackService.get(db, id).segments[0]?.points ?? [];
    expect(points[0]).toEqual({
      lat: BUXTON.lat,
      lon: BUXTON.lon,
      ele: null,
      time: null,
    });
  });

  it('refuses an index the track does not have, naming the count', () => {
    const id = newTrack([run(3)]);
    expect(() =>
      trackService.editPointAt(db, {
        id,
        index: 7,
        lat: BUXTON.lat,
        lon: BUXTON.lon,
        ele: null,
        time: null,
      }),
    ).toThrow(/3 points/);
  });
});

describe('trackService.pointsPage', () => {
  it('returns a window and the total', () => {
    const id = newTrack([run(50)]);
    const page = trackService.pointsPage(db, { id, offset: 10, limit: 5 });

    expect(page.total).toBe(50);
    expect(page.offset).toBe(10);
    expect(page.points).toHaveLength(5);
    expect(
      page.points.map((q) => Math.round((q.lon - BUXTON.lon) / 0.001)),
    ).toEqual([10, 11, 12, 13, 14]);
  });

  it('returns a short window at the end rather than padding it', () => {
    const id = newTrack([run(10)]);
    const page = trackService.pointsPage(db, { id, offset: 8, limit: 5 });
    expect(page.points).toHaveLength(2);
  });

  it('reports the whole track\u2019s breaks, not the window\u2019s', () => {
    // A renderer cannot infer a break from a window that does not contain one.
    const id = newTrack([run(3), run(3, 51), run(3, 52)]);
    const page = trackService.pointsPage(db, { id, offset: 0, limit: 2 });

    expect(page.segmentBreaks).toEqual([2, 5]);
    expect(page.total).toBe(9);
  });

  it('has no breaks for a single segment', () => {
    const id = newTrack([run(4)]);
    expect(trackService.pointsPage(db, { id, offset: 0, limit: 4 }).segmentBreaks).toEqual(
      [],
    );
  });

  it('reads exact points, never the simplified render cache', () => {
    // A zig-zag that simplification would thin out. The table must still see
    // every sample, or the row the user edits is not the one they are looking
    // at (Requirement 4.3).
    const points = Array.from({ length: 40 }, (_, i) =>
      tp(BUXTON.lat + (i % 2) * 0.00001, BUXTON.lon + i * 0.00001),
    );
    const id = newTrack([points]);

    const cached = trackService.geometryFor(db, id, 5);
    expect(cached.simplified).toBe(true);

    const page = trackService.pointsPage(db, { id, offset: 0, limit: 1000 });
    expect(page.total).toBe(40);
    expect(page.points).toHaveLength(40);
  });

  it('stays consistent after an edit shifts the indices', () => {
    const id = newTrack([run(10)]);
    trackService.deletePointsAt(db, id, [0, 1]);

    const page = trackService.pointsPage(db, { id, offset: 0, limit: 100 });
    expect(page.total).toBe(8);
    expect(page.points[0]?.lon).toBeCloseTo(BUXTON.lon + 0.002, 10);
  });

  it('clamps an offset past the end instead of failing', () => {
    const id = newTrack([run(3)]);
    const page = trackService.pointsPage(db, { id, offset: 99, limit: 10 });
    expect(page.total).toBe(3);
    expect(page.points).toHaveLength(1);
  });

  it('refuses a track that does not exist', () => {
    expect(() =>
      trackService.pointsPage(db, {
        id: '00000000-0000-4000-8000-000000000004',
        offset: 0,
        limit: 10,
      }),
    ).toThrow(/track/i);
  });
});
