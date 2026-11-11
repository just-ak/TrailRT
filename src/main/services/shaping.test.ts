import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LatLon } from '@shared/geo/distance';
import { BUXTON, MACCLESFIELD } from '@fixtures/places';
import type { RouteEdit } from '@shared/routing/edit';
import {
  MAX_UNDOABLE_POINTS,
  type RoutingProvider,
  type SnapResult,
} from '@shared/routing/RoutingProvider';
import type { PreviewedLeg, ProvenanceControlPoint } from '@shared/routing/results';
import { legShapes } from '@shared/routing/splice';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as controlRepo from '../db/repositories/routeControlPoints';
import * as routesRepo from '../db/repositories/routes';
import { ServiceError } from './errors';
import * as roadAttributeService from './roadAttributeService';
import * as routeService from './routeService';
import * as routingService from './routingService';
import * as shapingService from './shapingService';
import * as tripService from './tripService';
import * as undoService from './undoService';

/**
 * Shaping a saved route: Phase 6, task 7.
 *
 * The provider is a fake that draws each leg as a straight line through a
 * midpoint, so every leg's geometry is predictable and the tests can say
 * exactly which points must not have moved.
 */

const BUX: LatLon = { lat: BUXTON.lat, lon: BUXTON.lon };
const MAC: LatLon = { lat: MACCLESFIELD.lat, lon: MACCLESFIELD.lon };
/** Along the A537. */
const BURBAGE: LatLon = { lat: 53.2533, lon: -1.9343 };
const CAT_FIDDLE: LatLon = { lat: 53.2578, lon: -2.0327 };
const WALKER_BARN: LatLon = { lat: 53.261, lon: -2.0675 };
/** A point north of the A537, on the A5004 side. */
const LONG_HILL: LatLon = { lat: 53.29, lon: -1.96 };

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-shaping-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  undoService.clear();
  tripId = tripService.create(db, {
    name: 'Trip',
    folderId: null,
    description: null,
    notes: null,
  }).result.id;
});

afterEach(() => {
  undoService.clear();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const mid = (a: LatLon, b: LatLon): LatLon => ({
  lat: (a.lat + b.lat) / 2,
  lon: (a.lon + b.lon) / 2,
});

/** A leg the fake would produce: from, midpoint, to. */
const fakeLeg = (from: LatLon, to: LatLon): PreviewedLeg => ({
  matched: true,
  shape: [from, mid(from, to), to],
  distanceM: 1000,
  displacementM: null,
});

function build(points: readonly LatLon[], mode: 'auto'): SnapResult {
  return {
      provider: 'fake',
      mode,
      legs: points.slice(1).map((to, i) => ({
        matched: true,
        fromControlIndex: i,
        toControlIndex: i + 1,
        shape: fakeLeg(points[i] as LatLon, to).shape,
        distanceM: 1000,
        durationS: 60,
      })),
      unmatchedLegs: [],
      displaced: [],
    };
}

function fakeProvider(options: { sections?: boolean; calls?: string[] } = {}): RoutingProvider {
  return {
    id: 'fake',
    name: 'Fake',
    origins: [],
    attribution: 'Fake',
    snap: async (points, mode) => {
      options.calls?.push(`snap:${points.length}`);
      return build(points, mode as 'auto');
    },
    match: async (shape, mode) => ({
      provider: 'fake',
      mode,
      shape: [...shape],
      edges: [],
      unmatchedPointCount: 0,
    }),
    ...(options.sections === true
      ? {
          snapSection: async (locations, mode) => {
            options.calls?.push(`section:${locations.length}`);
            return build(
              locations.map((l) => l.point),
              mode as 'auto',
            );
          },
        }
      : {}),
  };
}

/** A snapped route through `control`, built as the tool would save it. */
function snappedRoute(control: LatLon[], roles?: ('via' | 'shaping')[]): string {
  return routingService.createSnappedRoute(db, {
    tripId,
    name: 'Shaped',
    colour: null,
    controlPoints: control,
    legs: control.slice(1).map((to, i) => fakeLeg(control[i] as LatLon, to)),
    roles,
    mode: 'auto',
    provider: 'fake',
  }).result.id;
}

const expected = (routeId: string): ProvenanceControlPoint[] =>
  controlRepo.listControlRows(db, routeId);

const pointsOf = (routeId: string): LatLon[] =>
  routeService.get(db, routeId).points.map((p) => ({ lat: p.lat, lon: p.lon }));

const legsOf = (routeId: string): LatLon[][] => {
  const rows = controlRepo.listControlRows(db, routeId);
  return legShapes(
    pointsOf(routeId),
    rows.map((r) => r.shapeIndex as number),
  );
};

/** Applies an edit with whatever legs the fake would route for it. */
async function apply(routeId: string, edit: RouteEdit) {
  const rows = controlRepo.listControlRows(db, routeId);
  const { planEdit } = await import('@shared/routing/edit');
  const plan = planEdit(
    rows.map((r) => ({ point: { lat: r.lat, lon: r.lon }, role: r.role })),
    legsOf(routeId),
    edit,
  );
  const legs =
    plan.section === null
      ? null
      : await shapingService.routeSection(fakeProvider(), plan.section, 'auto');
  return shapingService.applyEdit(db, { routeId, expected: expected(routeId), edit, legs });
}

function snapshot(routeId: string) {
  return {
    points: routeService.get(db, routeId).points,
    control: controlRepo.listControlRows(db, routeId),
    metadata: routesRepo.readMetadata(db, routeId),
  };
}

describe('applyEdit', () => {
  it('dragging a middle point re-routes its two legs and leaves the others point for point', async () => {
    const id = snappedRoute([BUX, BURBAGE, CAT_FIDDLE, WALKER_BARN, MAC]);
    const before = legsOf(id);

    await apply(id, { kind: 'move', index: 2, to: LONG_HILL });

    const after = legsOf(id);
    expect(after).toHaveLength(4);
    expect(after[0]).toEqual(before[0]);
    expect(after[3]).toEqual(before[3]);
    expect(after[1]?.at(-1)).toEqual(LONG_HILL);
    expect(controlRepo.listControlRows(db, id)[2]).toMatchObject(LONG_HILL);
  });

  it('dragging the line adds a shaping point; clicking it splits the leg with no change in shape', async () => {
    const id = snappedRoute([BUX, CAT_FIDDLE, MAC]);
    const shapeBefore = pointsOf(id);

    await apply(id, { kind: 'insertOnLine', leg: 0, segmentEnd: 1, at: mid(BUX, mid(BUX, CAT_FIDDLE)) });
    const rows = controlRepo.listControlRows(db, id);
    expect(rows.map((r) => r.role)).toEqual(['via', 'shaping', 'via', 'via']);
    // One vertex added exactly on the line; nothing else moved.
    expect(pointsOf(id).filter((p) => !shapeBefore.some((q) => q.lat === p.lat && q.lon === p.lon))).toHaveLength(1);

    await apply(id, { kind: 'insert', leg: 2, at: LONG_HILL });
    expect(controlRepo.listControlRows(db, id).map((r) => r.role)).toEqual([
      'via',
      'shaping',
      'via',
      'shaping',
      'via',
    ]);
  });

  const EDITS: [string, RouteEdit][] = [
    ['append', { kind: 'append', at: { lat: 53.27, lon: -2.15 } }],
    ['move', { kind: 'move', index: 1, to: LONG_HILL }],
    ['insert', { kind: 'insert', leg: 1, at: LONG_HILL }],
    ['insertOnLine', { kind: 'insertOnLine', leg: 0, segmentEnd: 1, at: mid(BUX, mid(BUX, BURBAGE)) }],
    ['remove middle', { kind: 'remove', index: 1 }],
    ['remove end', { kind: 'remove', index: 3 }],
    ['setRole', { kind: 'setRole', index: 2, role: 'shaping' }],
    [
      'choose',
      {
        kind: 'choose',
        leg: 1,
        candidate: [BURBAGE, LONG_HILL, CAT_FIDDLE],
        shaping: [mid(BURBAGE, LONG_HILL)],
      },
    ],
  ];

  it.each(EDITS)('%s: undo restores exactly, and redo restores the edit exactly', async (_, edit) => {
    const id = snappedRoute([BUX, BURBAGE, CAT_FIDDLE, MAC]);
    const original = snapshot(id);

    const mutation = await apply(id, edit);
    const edited = snapshot(id);
    expect(mutation.inverse.kind).toBe('route:spliceLegs');

    undoService.record(mutation.inverse);
    undoService.undo(db);
    expect(snapshot(id)).toEqual(original);

    undoService.redo(db);
    expect(snapshot(id)).toEqual(edited);
  });

  it('records only the changed stretch in the undo entry, so long routes stay undoable', async () => {
    // Built directly through the repository: past the tool's editable limit,
    // as a whole-route snap of a long route can be.
    const long: LatLon[] = Array.from({ length: 20_000 }, (_, i) => ({
      lat: BUX.lat + i * 1e-6,
      lon: BUX.lon - i * 1e-6,
    }));
    const id = snappedRoute([BUX, MAC]);
    const joint = long.at(-1) as LatLon;
    const shape = [...long, mid(joint, MAC), MAC];
    routesRepo.replacePoints(db, id, routingService.toRoutePoints(shape));
    controlRepo.replaceControlPoints(db, id, [
      { ...BUX, role: 'via', shapeIndex: 0 },
      { ...joint, role: 'via', shapeIndex: long.length - 1 },
      { ...MAC, role: 'via', shapeIndex: shape.length - 1 },
    ]);

    const mutation = await apply(id, { kind: 'move', index: 2, to: WALKER_BARN });

    expect(mutation.result.undoable).toBe(true);
    const payload = mutation.inverse.payload as { points: unknown[] };
    expect(payload.points.length).toBeLessThan(10);
    expect(payload.points.length).toBeLessThan(MAX_UNDOABLE_POINTS);
    expect(pointsOf(id)).toHaveLength(long.length + 2);
  });

  it('writes nothing when the route changed since the renderer planned the edit', async () => {
    const id = snappedRoute([BUX, CAT_FIDDLE, MAC]);
    const stale = expected(id);
    await apply(id, { kind: 'move', index: 1, to: LONG_HILL });
    const now = snapshot(id);

    expect(() =>
      shapingService.applyEdit(db, {
        routeId: id,
        expected: stale,
        edit: { kind: 'remove', index: 1 },
        legs: [fakeLeg(BUX, MAC)],
      }),
    ).toThrow(ServiceError);
    expect(snapshot(id)).toEqual(now);
  });

  it('refuses legs that do not match the plan, and writes nothing', () => {
    const id = snappedRoute([BUX, CAT_FIDDLE, MAC]);
    const before = snapshot(id);
    expect(() =>
      shapingService.applyEdit(db, {
        routeId: id,
        expected: expected(id),
        edit: { kind: 'move', index: 1, to: LONG_HILL },
        legs: [fakeLeg(BUX, LONG_HILL)],
      }),
    ).toThrow(/did not match/);
    expect(snapshot(id)).toEqual(before);
  });

  it('refuses a route snapped before boundaries were recorded, saying how to fix it', () => {
    const id = snappedRoute([BUX, CAT_FIDDLE, MAC]);
    controlRepo.replaceControlPoints(db, id, [BUX, CAT_FIDDLE, MAC]);
    expect(() =>
      shapingService.applyEdit(db, {
        routeId: id,
        expected: expected(id),
        edit: { kind: 'setRole', index: 1, role: 'shaping' },
        legs: null,
      }),
    ).toThrow(/Re-route it once/);
  });

  it('a whole-route snap of such a route establishes the boundaries', async () => {
    const id = snappedRoute([BUX, CAT_FIDDLE, MAC]);
    controlRepo.replaceControlPoints(db, id, [BUX, CAT_FIDDLE, MAC]);
    await routingService.snapRoute(db, { routeId: id, provider: fakeProvider(), mode: 'auto' });
    await expect(apply(id, { kind: 'setRole', index: 1, role: 'shaping' })).resolves.toBeDefined();
  });

  it('setRole changes no geometry at all', async () => {
    const id = snappedRoute([BUX, CAT_FIDDLE, MAC]);
    const before = routeService.get(db, id).points;
    await apply(id, { kind: 'setRole', index: 1, role: 'shaping' });
    expect(routeService.get(db, id).points).toEqual(before);
  });

  it('halves of an unmatched leg stay unmatched; a chosen candidate is matched', async () => {
    const id = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Partly straight',
      colour: null,
      controlPoints: [BUX, CAT_FIDDLE, MAC],
      legs: [
        { matched: false, shape: [BUX, CAT_FIDDLE], distanceM: null, displacementM: null },
        fakeLeg(CAT_FIDDLE, MAC),
      ],
      mode: 'auto',
      provider: 'fake',
    }).result.id;

    const split = await apply(id, { kind: 'insertOnLine', leg: 0, segmentEnd: 1, at: mid(BUX, CAT_FIDDLE) });
    expect(split.result.unmatchedLegs).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('a result past the stored-route limit writes nothing', async () => {
    const id = snappedRoute([BUX, CAT_FIDDLE, MAC]);
    const before = snapshot(id);
    const huge: LatLon[] = Array.from({ length: 25_001 }, (_, i) => ({
      lat: BUX.lat + i * 1e-7,
      lon: BUX.lon,
    }));
    expect(() =>
      shapingService.applyEdit(db, {
        routeId: id,
        expected: expected(id),
        edit: { kind: 'move', index: 0, to: BUX },
        legs: [{ matched: true, shape: huge, distanceM: null, displacementM: null }],
      }),
    ).toThrow(/more than/);
    expect(snapshot(id)).toEqual(before);
  });

  it('makes cached road attributes read as stale', async () => {
    const id = snappedRoute([BUX, CAT_FIDDLE, MAC]);
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: id,
      provider: fakeProvider(),
      mode: 'auto',
    });
    expect(roadAttributeService.cached(db, 'route', id)?.status.stale).toBe(false);

    await apply(id, { kind: 'move', index: 1, to: LONG_HILL });
    expect(roadAttributeService.cached(db, 'route', id)?.status.stale).toBe(true);
  });
});

describe('routeSection', () => {
  it('uses pass-through section routing when the provider has it', async () => {
    const calls: string[] = [];
    const legs = await shapingService.routeSection(
      fakeProvider({ sections: true, calls }),
      [
        { point: BUX, passThrough: false },
        { point: LONG_HILL, passThrough: true },
        { point: MAC, passThrough: false },
      ],
      'auto',
    );
    expect(calls).toEqual(['section:3']);
    expect(legs).toHaveLength(2);
  });

  it('leaves the route untouched when the provider fails', async () => {
    const id = snappedRoute([BUX, CAT_FIDDLE, MAC]);
    const before = snapshot(id);
    const failing: RoutingProvider = {
      ...fakeProvider(),
      snap: () => Promise.reject(new ServiceError('PROVIDER_UNAVAILABLE', 'down')),
    };
    await expect(
      shapingService.routeSection(
        failing,
        [
          { point: BUX, passThrough: false },
          { point: MAC, passThrough: false },
        ],
        'auto',
      ),
    ).rejects.toThrow('down');
    expect(snapshot(id)).toEqual(before);
  });
});

describe('whole-route snap with shaping points', () => {
  it('routes each via-to-via run with shaping points as one section, and keeps the roles', async () => {
    const id = snappedRoute(
      [BUX, BURBAGE, CAT_FIDDLE, WALKER_BARN, MAC],
      ['via', 'shaping', 'via', 'via', 'via'],
    );
    const calls: string[] = [];
    await routingService.snapRoute(db, {
      routeId: id,
      provider: fakeProvider({ sections: true, calls }),
      mode: 'auto',
    });

    // BUX→BURBAGE→CAT is one pass-through section; CAT→WALKER→MAC plain.
    expect(calls).toEqual(['section:3', 'snap:3']);
    expect(controlRepo.listControlRows(db, id).map((r) => r.role)).toEqual([
      'via',
      'shaping',
      'via',
      'via',
      'via',
    ]);
    expect(legsOf(id)).toHaveLength(4);
  });

  it('is one ordinary snap call for a route with no shaping points', async () => {
    const id = snappedRoute([BUX, BURBAGE, CAT_FIDDLE, MAC]);
    const calls: string[] = [];
    await routingService.snapRoute(db, {
      routeId: id,
      provider: fakeProvider({ sections: true, calls }),
      mode: 'auto',
    });
    expect(calls).toEqual(['snap:4']);
  });
});

describe('extending a saved route (Requirement 6.5)', () => {
  it('three clicks are three undo entries, and choosing a candidate after them is a fourth', async () => {
    const id = snappedRoute([BUX, CAT_FIDDLE]);
    const states = [snapshot(id)];

    for (const at of [WALKER_BARN, MAC, { lat: 53.27, lon: -2.15 }]) {
      const mutation = await apply(id, { kind: 'append', at });
      undoService.record(mutation.inverse);
      states.push(snapshot(id));
    }
    const choose = await apply(id, {
      kind: 'choose',
      leg: 3,
      candidate: [MAC, LONG_HILL, { lat: 53.27, lon: -2.15 }],
      shaping: [mid(MAC, LONG_HILL)],
    });
    undoService.record(choose.inverse);
    states.push(snapshot(id));

    expect(controlRepo.listControlRows(db, id)).toHaveLength(6);
    // Each ⌘Z steps back exactly one of those four, in order.
    for (let i = states.length - 2; i >= 0; i -= 1) {
      undoService.undo(db);
      expect(snapshot(id)).toEqual(states[i]);
    }
    expect(undoService.state().canUndo).toBe(false);
  });
});
