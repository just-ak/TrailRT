import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LatLon } from '@shared/geo/distance';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import {
  MAX_SNAP_DISPLACEMENT_M,
  MAX_SNAPPED_POINTS,
  MAX_UNDOABLE_POINTS,
  type MatchedEdge,
  type MatchResult,
  type RoutingProvider,
  type SnapResult,
  type TransportMode,
} from '@shared/routing/RoutingProvider';
import { checkBoundaries } from '@shared/routing/splice';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as controlRepo from '../db/repositories/routeControlPoints';
import { ServiceError } from './errors';
import * as roadAttributeService from './roadAttributeService';
import * as routeService from './routeService';
import * as routingService from './routingService';
import * as trackService from './trackService';
import * as tripService from './tripService';
import * as undoService from './undoService';

/**
 * Named points on the Buxton loop, west along the A537 then round the square.
 *
 * Bare coordinates rather than the fixture's `Place` objects, because these
 * stand in for what a user clicked — a position, with no elevation or name
 * attached yet. The provider here is a fake, so the geography is not under
 * test; it is here so the fixtures read as a real ride and match what the
 * live snap tests and the end-to-end specs use.
 */
const BUX: LatLon = { lat: BUXTON.lat, lon: BUXTON.lon };
const MAC: LatLon = { lat: MACCLESFIELD.lat, lon: MACCLESFIELD.lon };
const LEE: LatLon = { lat: LEEK.lat, lon: LEEK.lon };
const ASH: LatLon = { lat: ASHBOURNE.lat, lon: ASHBOURNE.lon };
/** Along the A537 between Buxton and Macclesfield. */
const BURBAGE: LatLon = { lat: 53.2533, lon: -1.9343 };
const CAT_FIDDLE: LatLon = { lat: 53.2578, lon: -2.0327 };
const WALKER_BARN: LatLon = { lat: 53.261, lon: -2.0675 };
/** On the A515, used where a test needs a point off the direct line. */
const NEWHAVEN: LatLon = { lat: 53.1393, lon: -1.7535 };

/**
 * Great-circle metres, written out here rather than imported.
 *
 * A test that computed its expectations with the same function the code under
 * test uses would agree with it by construction, including when both are
 * wrong.
 */
const toRad = (deg: number): number => (deg * Math.PI) / 180;

function haversineM(a: LatLon, b: LatLon): number {
  const R = 6_371_008.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

const rp = (
  at: { lat: number; lon: number },
  ele: number | null = null,
) => ({
  lat: at.lat,
  lon: at.lon,
  ele,
  name: null,
  symbol: null,
  notes: null,
});

/**
 * A short timed recording. Module scope because it closes over the
 * per-test `db` and `tripId` module variables, not over a describe block.
 */
const timedTrack = () =>
  trackService.createFromParsed(db, {
    tripId,
    source: 'import',
    parsed: {
      name: 'Timed',
      segments: [
        {
          points: [
            { ...BUX, ele: null, time: 0 },
            { ...BURBAGE, ele: null, time: 60_000 },
            { ...CAT_FIDDLE, ele: null, time: 120_000 },
          ],
        },
      ],
      metadata: {},
    },
  }).result;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-routing-'));
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

/**
 * A provider that returns scripted geometry.
 *
 * The real adapter is tested against a loopback HTTP server in
 * `main/routing/valhalla.test.ts`. Here the question is what the *service* does
 * with a provider's answer, so the provider is a fake and the tests stay about
 * storage, control points, caps and undo.
 */
function fakeProvider(options: {
  /**
   * Returns the shape for a leg. `null` scripts an unmatched leg; returning
   * `undefined` (or omitting the hook) falls back to a straight three-point
   * shape. The two cases have to stay distinguishable, so `??` is not usable
   * here — it would collapse a scripted `null` into the default.
   */
  legShape?: (from: LatLon, to: LatLon) => LatLon[] | null | undefined;
  edges?: MatchResult['edges'];
  onCall?: () => void;
}): RoutingProvider {
  return {
    id: 'fake',
    name: 'Fake',
    origins: ['https://fake.invalid'],
    attribution: 'Fake',

    async snap(controlPoints, mode: TransportMode): Promise<SnapResult> {
      options.onCall?.();
      const legs: SnapResult['legs'] = [];
      const unmatchedLegs: [number, number][] = [];
      const displaced: SnapResult['displaced'] = [];

      const straight = (i: number, from: LatLon, to: LatLon): void => {
        legs.push({
          matched: false,
          fromControlIndex: i,
          toControlIndex: i + 1,
          shape: [from, to],
          distanceM: null,
          durationS: null,
        });
        unmatchedLegs.push([i, i + 1]);
      };

      for (let i = 0; i < controlPoints.length - 1; i += 1) {
        const from = controlPoints[i] as LatLon;
        const to = controlPoints[i + 1] as LatLon;
        const scripted = options.legShape?.(from, to);
        const shape =
          scripted === undefined
            ? [
                from,
                { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 },
                to,
              ]
            : scripted;
        if (shape === null) {
          straight(i, from, to);
          continue;
        }

        /*
         * A shape too short to have ends is passed through as-is.
         *
         * This is how a *broken* provider is modelled — one that answers with
         * a leg containing no geometry — and the service is supposed to reject
         * the whole snap for it. Converting it to a straight line here would
         * hide exactly the case that test covers, and there is nothing to
         * measure a displacement against anyway.
         */
        if (shape.length < 2) {
          legs.push({
            matched: true,
            fromControlIndex: i,
            toControlIndex: i + 1,
            shape,
            distanceM: null,
            durationS: null,
          });
          continue;
        }

        /*
         * Displacement measured from the scripted shape, exactly as the real
         * adapter measures it from the engine's.
         *
         * The fake mirroring this matters. A shape that starts a long way from
         * its control point is what a graph that does not cover the area
         * produces, and the service's handling of that is the point of these
         * tests — a fake that always reported no displacement could not
         * reproduce it.
         */
        const startOff = haversineM(from, shape[0] as LatLon);
        const endOff = haversineM(to, shape.at(-1) as LatLon);

        for (const [index, metres] of [
          [i, startOff],
          [i + 1, endOff],
        ] as const) {
          if (metres <= MAX_SNAP_DISPLACEMENT_M) continue;
          const seen = displaced.find((entry) => entry.index === index);
          if (seen === undefined) {
            displaced.push({ index, displacementM: metres });
          } else {
            seen.displacementM = Math.max(seen.displacementM, metres);
          }
        }

        if (
          startOff > MAX_SNAP_DISPLACEMENT_M ||
          endOff > MAX_SNAP_DISPLACEMENT_M
        ) {
          straight(i, from, to);
          continue;
        }

        legs.push({
          matched: true,
          fromControlIndex: i,
          toControlIndex: i + 1,
          shape,
          distanceM: null,
          durationS: null,
        });
      }

      return {
        provider: 'fake',
        mode,
        legs,
        unmatchedLegs,
        displaced: displaced.toSorted((a, b) => a.index - b.index),
      };
    },

    async match(shape, mode): Promise<MatchResult> {
      options.onCall?.();
      return {
        provider: 'fake',
        mode,
        shape: [...shape],
        edges: options.edges ?? [
          {
            startIndex: 0,
            endIndex: shape.length - 1,
            lengthM: null,
            speedLimitMps: 22.22,
            roadClass: 'secondary',
            surface: 'paved',
          },
        ],
        unmatchedPointCount: 0,
      };
    },
  };
}

const newRoute = (points = [rp(BUX), rp(CAT_FIDDLE)], name = 'Route') =>
  routeService.create(db, { tripId, name, colour: null, points }).result;

// ------------------------------------------------------------- flattenLegs

describe('flattenLegs', () => {
  // Leg n ends where leg n+1 begins. Keeping both copies puts a zero-length
  // segment at every control point, which inflates the count and reads as a
  // stationary sample in any speed calculation.
  it('drops the vertex shared between consecutive legs', () => {
    const shared = BURBAGE;
    const flat = routingService.flattenLegs([
      { shape: [BUX, shared] },
      { shape: [shared, CAT_FIDDLE] },
    ]);

    expect(flat).toHaveLength(3);
  });

  it('keeps a genuinely distinct vertex at a leg boundary', () => {
    const flat = routingService.flattenLegs([
      {
        shape: [
          BUX,
          BURBAGE,
        ],
      },
      {
        shape: [
          LEE,
          ASH,
        ],
      },
    ]);
    expect(flat).toHaveLength(4);
  });
});

// ---------------------------------------------------------------- snapping

describe('snapRoute', () => {
  it('replaces geometry with road shape and keeps the control points', async () => {
    const route = newRoute();
    const outcome = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'motorcycle',
    });

    expect(outcome.result.pointCount).toBe(3);
    expect(routeService.get(db, route.id).points).toHaveLength(3);

    // The user's two points survive as intent, so one of them can be moved
    // later and only the affected leg re-snapped.
    expect(controlRepo.listControlPoints(db, route.id)).toEqual([
      BUX,
      CAT_FIDDLE,
    ]);
  });

  it('records provenance so the geometry origin is auditable', async () => {
    const route = newRoute();
    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'motorcycle',
    });

    const provenance = routingService.provenance(db, route.id);
    expect(provenance.routingProvider).toBe('fake');
    expect(provenance.transportMode).toBe('motorcycle');
    expect(provenance.snappedAt).toBeGreaterThan(0);
    expect(provenance.controlPointCount).toBe(2);
  });

  // Absence of a provider is what marks a hand-drawn route, which is how every
  // pre-Phase-4 route keeps behaving identically.
  it('leaves a hand-drawn route with no provenance', () => {
    const route = newRoute();
    const provenance = routingService.provenance(db, route.id);
    expect(provenance.routingProvider).toBeNull();
    expect(provenance.controlPointCount).toBe(0);
  });

  it('recomputes statistics from the snapped geometry', async () => {
    const route = newRoute();
    const before = routeService.get(db, route.id).distanceM;

    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({
        // A detour: via a point well off the straight line.
        legShape: (from, to) => [from, NEWHAVEN, to],
      }),
      mode: 'auto',
    });

    // Longer than the straight line, because the road is.
    expect(routeService.get(db, route.id).distanceM).toBeGreaterThan(
      before as number,
    );
  });

  it('drops elevation on snapped points rather than carrying it over', async () => {
    const route = newRoute([rp(BUX, 1200), rp(CAT_FIDDLE, 1400)]);
    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    // The road shape is a different set of positions; a height measured
    // somewhere else would be invented data.
    expect(
      routeService.get(db, route.id).points.every((p) => p.ele === null),
    ).toBe(true);
    expect(routeService.get(db, route.id).elevGainM).toBeNull();
  });

  describe('an unmatched leg', () => {
    it('stays straight and is recorded in metadata', async () => {
      const route = newRoute([rp(BUX), rp(CAT_FIDDLE), rp(MAC)]);

      const outcome = await routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({
          // Refuse the second leg only.
          legShape: (from) => (from.lat === CAT_FIDDLE.lat ? null : undefined),
        }),
        mode: 'auto',
      });

      expect(outcome.result.unmatchedLegs).toEqual([[1, 2]]);
      expect(routingService.provenance(db, route.id).unmatchedLegs).toEqual([
        [1, 2],
      ]);
    });

    it('does not fail the whole snap', async () => {
      const route = newRoute([rp(BUX), rp(CAT_FIDDLE), rp(MAC)]);
      const outcome = await routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({
          legShape: (from) => (from.lat === CAT_FIDDLE.lat ? null : undefined),
        }),
        mode: 'auto',
      });
      expect(outcome.result.pointCount).toBeGreaterThan(2);
    });
  });

  it('preserves existing metadata when recording unmatched legs', async () => {
    const route = routeService.create(db, {
      tripId,
      name: 'Imported',
      colour: null,
      points: [rp(BUX), rp(CAT_FIDDLE)],
      metadata: { extensions: { source: 'gpx' } },
    }).result;

    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    // A snap must not discard fields preserved from an import.
    const { readMetadata } = await import('../db/repositories/routes');
    expect(readMetadata(db, route.id).extensions).toEqual({ source: 'gpx' });
  });

  it('refuses a route with fewer than two points', async () => {
    const route = newRoute([rp(BUX)]);
    await expect(
      routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({}),
        mode: 'auto',
      }),
    ).rejects.toThrow(/at least two points/);
  });

  // Refused before anything is written, with the count, rather than storing a
  // route that cannot be drawn or exported.
  it('refuses a snap that would exceed the point cap, naming the count', async () => {
    const route = newRoute();
    /*
     * A dense shape that genuinely runs between the control points.
     *
     * Interpolated rather than marching off in a straight line from the start:
     * a shape whose far end is nowhere near the control point it is supposed
     * to reach is now treated as a displaced, unmatched leg and replaced with
     * a two-point straight line — which would never reach the cap, so the test
     * would pass for the wrong reason.
     */
    const huge = Array.from({ length: MAX_SNAPPED_POINTS + 10 }, (_, i) => {
      const t = i / (MAX_SNAPPED_POINTS + 9);
      return {
        lat: BUX.lat + (CAT_FIDDLE.lat - BUX.lat) * t,
        lon: BUX.lon + (CAT_FIDDLE.lon - BUX.lon) * t,
      };
    });

    try {
      await routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({ legShape: () => huge }),
        mode: 'auto',
      });
      expect.unreachable('should have been refused');
    } catch (cause) {
      expect(cause).toBeInstanceOf(ServiceError);
      expect((cause as Error).message).toMatch(
        new RegExp(MAX_SNAPPED_POINTS.toLocaleString()),
      );
    }

    // Untouched.
    expect(routeService.get(db, route.id).points).toHaveLength(2);
    expect(controlRepo.hasControlPoints(db, route.id)).toBe(false);
  });

  it('reports a provider that returns nothing usable', async () => {
    const route = newRoute();
    await expect(
      routingService.snapRoute(db, {
        routeId: route.id,
        provider: fakeProvider({ legShape: () => [] }),
        mode: 'auto',
      }),
    ).rejects.toThrow(/no usable road geometry/);
  });
});

// -------------------------------------------------------------------- undo

describe('snap undo', () => {
  it('restores the previous geometry and clears control points', async () => {
    const route = newRoute();
    const original = routeService.get(db, route.id).points;

    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });
    expect(mutation.result.undoable).toBe(true);
    expect(mutation.inverse.kind).toBe('route:restoreSnap');

    routingService.restoreSnap(
      db,
      mutation.inverse.payload as Parameters<
        typeof routingService.restoreSnap
      >[1],
    );

    expect(routeService.get(db, route.id).points).toEqual(original);
    // A route that was hand-drawn before the snap is hand-drawn again, not a
    // snapped route carrying old geometry.
    expect(controlRepo.hasControlPoints(db, route.id)).toBe(false);
    expect(routingService.provenance(db, route.id).routingProvider).toBeNull();
  });

  it('round-trips through the undo stack', async () => {
    const route = newRoute();
    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    undoService.record(mutation.inverse);
    expect(undoService.state().canUndo).toBe(true);
    undoService.undo(db);

    expect(routeService.get(db, route.id).points).toHaveLength(2);
    // Redo puts the snap back.
    undoService.redo(db);
    expect(routeService.get(db, route.id).points).toHaveLength(3);
  });

  // An inverse holding tens of thousands of points on a 50-deep stack is a
  // memory problem dressed as a convenience. Declaring it beats faking it.
  it('declares itself non-undoable above the bound rather than faking an inverse', async () => {
    const big = Array.from({ length: MAX_UNDOABLE_POINTS + 1 }, (_, i) =>
      rp({ lat: BUX.lat + i * 1e-6, lon: BUX.lon + i * 1e-6 }),
    );
    const route = routeService.create(db, {
      tripId,
      name: 'Big',
      colour: null,
      points: big,
    }).result;

    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({ legShape: (from, to) => [from, to] }),
      mode: 'auto',
    });

    expect(mutation.result.undoable).toBe(false);
    expect(mutation.inverse.kind).toBe('none');
  });
});

// ------------------------------------------------------- road attributes

describe('road attributes', () => {
  it('matches a route and caches the result', async () => {
    const route = newRoute();
    let calls = 0;
    const provider = fakeProvider({ onCall: () => (calls += 1) });

    const first = await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });

    expect(first.provider).toBe('fake');
    expect(first.edgeCount).toBe(1);
    expect(calls).toBe(1);
  });

  it('serves a second request from the cache without calling out', async () => {
    const route = newRoute();
    let calls = 0;
    const provider = fakeProvider({ onCall: () => (calls += 1) });

    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });

    expect(calls).toBe(1);
  });

  it('re-matches when asked explicitly', async () => {
    const route = newRoute();
    let calls = 0;
    const provider = fakeProvider({ onCall: () => (calls += 1) });

    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
      force: true,
    });

    expect(calls).toBe(2);
  });

  // The reason the cache is keyed by content hash: an edited route must never
  // be handed attributes computed for its previous shape.
  it('invalidates when the geometry changes', async () => {
    const route = newRoute();
    const provider = fakeProvider({});

    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider,
      mode: 'auto',
    });
    expect(
      roadAttributeService.cached(db, 'route', route.id)?.status.stale,
    ).toBe(false);

    routeService.setGeometry(db, {
      id: route.id,
      points: [rp(BUX), rp(CAT_FIDDLE), rp(LEE)],
    });

    expect(
      roadAttributeService.cached(db, 'route', route.id)?.status.stale,
    ).toBe(true);
  });

  it('matches a track without modifying its geometry', async () => {
    const track = trackService.createFromParsed(db, {
      tripId,
      source: 'import',
      parsed: {
        name: 'Recorded',
        segments: [
          {
            points: [
              { ...BUX, ele: 1000, time: 1_700_000_000_000 },
              { ...BURBAGE, ele: 1010, time: 1_700_000_060_000 },
              { ...CAT_FIDDLE, ele: 1020, time: 1_700_000_120_000 },
            ],
          },
        ],
        metadata: {},
      },
    }).result;

    const before = trackService.get(db, track.id).segments;

    await roadAttributeService.match(db, {
      ownerType: 'track',
      ownerId: track.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    // A recording is measured data. Matching reads road attributes; it must
    // never move the samples. ADR 0011 §4.
    expect(trackService.get(db, track.id).segments).toEqual(before);
  });

  it('keeps route and track caches independent', async () => {
    const route = newRoute();
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });
    expect(roadAttributeService.cached(db, 'track', route.id)).toBeNull();
  });
});

// ----------------------------------------------------- speed distribution

describe('postedSpeedSamples', () => {
  /** Four points west along the A537: unequal spacing, as a real road has. */
  const shape = [BUX, BURBAGE, CAT_FIDDLE, WALKER_BARN];

  /**
   * Segment lengths of `shape`, computed rather than assumed.
   *
   * The earlier version of these tests used four points on a meridian a
   * hundredth of a degree apart and asserted one sample was "twice" another.
   * That held because the segments happened to be equal — so it would also
   * have held if the weighting ignored distance and counted segments. Summing
   * the real lengths states the invariant that was meant.
   */
  const segments = shape
    .slice(0, -1)
    .map((point, index) => haversineM(point, shape[index + 1] as LatLon));

  const spanM = (from: number, to: number) =>
    segments.slice(from, to).reduce((sum, length) => sum + length, 0);

  it('weights each edge by the distance it actually covers', () => {
    const samples = roadAttributeService.postedSpeedSamples(shape, [
      {
        startIndex: 0,
        endIndex: 1,
        lengthM: null,
        speedLimitMps: 20,
        roadClass: null,
        surface: null,
      },
      {
        startIndex: 1,
        endIndex: 3,
        lengthM: null,
        speedLimitMps: 30,
        roadClass: null,
        surface: null,
      },
    ]);

    expect(samples).toHaveLength(2);
    // Each sample carries the summed length of the segments its edge spans:
    // the first edge one segment, the second the remaining two.
    expect(samples[0]?.distanceM).toBeCloseTo(spanM(0, 1), 0);
    expect(samples[1]?.distanceM).toBeCloseTo(spanM(1, 3), 0);
  });

  /*
   * The half that makes the Unknown band honest. Without it, a route that
   * matched only part of its length would report a distribution over that part
   * and appear fully characterised.
   */
  it('accounts for geometry no edge covered as Unknown', () => {
    const samples = roadAttributeService.postedSpeedSamples(shape, [
      {
        startIndex: 0,
        endIndex: 1,
        lengthM: null,
        speedLimitMps: 20,
        roadClass: null,
        surface: null,
      },
    ]);

    const unknown = samples.filter((s) => s.speedMps === null);
    expect(unknown).toHaveLength(1);
    // The last two of the three segments were unmatched, so Unknown carries
    // exactly their combined length — not a segment count.
    expect(unknown[0]?.distanceM).toBeCloseTo(spanM(1, 3), 0);
  });

  it('adds no Unknown sample when every segment is covered', () => {
    const samples = roadAttributeService.postedSpeedSamples(shape, [
      {
        startIndex: 0,
        endIndex: 3,
        lengthM: null,
        speedLimitMps: 25,
        roadClass: null,
        surface: null,
      },
    ]);
    expect(samples.filter((s) => s.speedMps === null)).toHaveLength(0);
  });

  it('carries a null speed limit through as Unknown', () => {
    const samples = roadAttributeService.postedSpeedSamples(shape, [
      {
        startIndex: 0,
        endIndex: 3,
        lengthM: null,
        speedLimitMps: null,
        roadClass: 'unclassified',
        surface: null,
      },
    ]);
    expect(samples.every((s) => s.speedMps === null)).toBe(true);
  });
});

/** An unposted edge across the whole of a four-point shape. */
const unpostedEdge = (
  roadClass: MatchedEdge['roadClass'],
  oneway?: boolean | null,
): MatchedEdge => ({
  startIndex: 0,
  endIndex: 3,
  lengthM: null,
  speedLimitMps: null,
  roadClass,
  surface: null,
  ...(oneway === undefined ? {} : { oneway }),
});

describe('UK default limits (ADR 0018)', () => {
  /** The A537 west of Buxton: inside the UK, unposted in this test. */
  const shape = [BUX, BURBAGE, CAT_FIDDLE, WALKER_BARN];
  const MPH = 1609.344 / 3600;
  const edge = unpostedEdge;

  it('counts an unposted UK tertiary road at 60 mph, marked assumed', () => {
    const [sample] = roadAttributeService.postedSpeedSamples(
      shape,
      [edge('tertiary', false)],
      { ukDefaults: true },
    );
    expect(sample?.speedMps).toBeCloseTo(60 * MPH, 9);
    expect(sample?.assumed).toBe(true);
  });

  it('never marks a posted limit as assumed, and never overrides it', () => {
    const [sample] = roadAttributeService.postedSpeedSamples(
      shape,
      [{ ...edge('tertiary'), speedLimitMps: 50 * MPH }],
      { ukDefaults: true },
    );
    expect(sample?.speedMps).toBeCloseTo(50 * MPH, 9);
    expect(sample?.assumed).toBe(false);
  });

  it('reads attributes cached before one-way was recorded as single carriageway', () => {
    const [sample] = roadAttributeService.postedSpeedSamples(
      shape,
      [edge('trunk')],
      { ukDefaults: true },
    );
    expect(sample?.speedMps).toBeCloseTo(60 * MPH, 9);
  });

  it('leaves the road Unknown with the setting off', () => {
    const [sample] = roadAttributeService.postedSpeedSamples(
      shape,
      [edge('tertiary', false)],
      { ukDefaults: false },
    );
    expect(sample?.speedMps).toBeNull();
  });

  it('leaves a road with no class Unknown', () => {
    const [sample] = roadAttributeService.postedSpeedSamples(
      shape,
      [edge(null)],
      { ukDefaults: true },
    );
    expect(sample?.speedMps).toBeNull();
  });

  it('leaves a road outside the UK Unknown', () => {
    // The N11 south of Dublin: Irish law, not UK law.
    const dublin = [
      { lat: 53.27, lon: -6.18 },
      { lat: 53.26, lon: -6.17 },
      { lat: 53.25, lon: -6.16 },
      { lat: 53.24, lon: -6.15 },
    ];
    const [sample] = roadAttributeService.postedSpeedSamples(
      dublin,
      [edge('tertiary', false)],
      { ukDefaults: true },
    );
    expect(sample?.speedMps).toBeNull();
  });
});

describe('recordedDistribution', () => {
  it('derives speed from the track timestamps', () => {
    const track = timedTrack();
    const distribution = roadAttributeService.recordedDistribution(
      db,
      track.id,
      'metric',
    );

    expect(distribution?.source).toBe('recorded');
    expect(distribution?.totalDistanceM).toBeGreaterThan(0);
    expect(distribution?.allUnknown).toBe(false);
  });

  // A different answer from "all speeds unknown": one means the question
  // cannot be asked at all.
  it('returns null for an untimed recording', () => {
    const track = trackService.createFromParsed(db, {
      tripId,
      source: 'import',
      parsed: {
        name: 'Untimed',
        segments: [
          {
            points: [
              { ...BUX, ele: null, time: null },
              { ...BURBAGE, ele: null, time: null },
            ],
          },
        ],
        metadata: {},
      },
    }).result;

    expect(
      roadAttributeService.recordedDistribution(db, track.id, 'metric'),
    ).toBeNull();
  });

  it('labels itself recorded, never posted', () => {
    const track = timedTrack();
    expect(
      roadAttributeService.recordedDistribution(db, track.id, 'metric')?.source,
    ).toBe('recorded');
  });
});

describe('postedDistribution', () => {
  it('is null before anything is matched', () => {
    const route = newRoute();
    expect(
      roadAttributeService.postedDistribution(db, 'route', route.id, 'metric'),
    ).toBeNull();
  });

  it('labels itself posted and reports the provider', async () => {
    const route = newRoute();
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    const result = roadAttributeService.postedDistribution(
      db,
      'route',
      route.id,
      'metric',
    );
    expect(result?.distribution.source).toBe('posted');
    expect(result?.status.provider).toBe('fake');
  });

  it('reports an all-unknown route honestly', async () => {
    const route = newRoute();
    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: route.id,
      provider: fakeProvider({
        edges: [
          {
            startIndex: 0,
            endIndex: 1,
            lengthM: null,
            speedLimitMps: null,
            roadClass: 'unclassified',
            surface: null,
          },
        ],
      }),
      mode: 'auto',
    });

    const result = roadAttributeService.postedDistribution(
      db,
      'route',
      route.id,
      'metric',
    );
    expect(result?.distribution.allUnknown).toBe(true);
    expect(result?.distribution.unknown.percent).toBeCloseTo(100, 6);
  });
});

// ------------------------------------------- the interactive snap routing tool

/** A previewed leg, as the renderer would hand one back on finish. */
const previewed = (
  shape: { lat: number; lon: number }[],
  matched = true,
  distanceM: number | null = 100,
  displacementM: number | null = null,
) => ({ matched, shape, distanceM, displacementM });

describe('routeLeg', () => {
  it('returns one leg from a two-point snap', async () => {
    const leg = await routingService.routeLeg(
      fakeProvider({}),
      BUX,
      CAT_FIDDLE,
      'auto',
    );

    expect(leg.matched).toBe(true);
    // The fake inserts a midpoint, so a routed leg is more than the two ends.
    expect(leg.shape).toHaveLength(3);
  });

  it('issues exactly one provider call per leg', async () => {
    let calls = 0;
    const provider = fakeProvider({
      onCall: () => {
        calls += 1;
      },
    });

    await routingService.routeLeg(
      provider,
      BUX,
      BURBAGE,
      'auto',
    );

    // The whole point of the interactive tool: a click costs one call, so the
    // tenth click is no more expensive than the first.
    expect(calls).toBe(1);
  });

  // Requirement 3.6: a leg with no road path is a straight line and a report,
  // not an error that loses the user's click.
  it('reports an unmatched leg as a straight line rather than failing', async () => {
    const leg = await routingService.routeLeg(
      fakeProvider({ legShape: () => null }),
      BUX,
      CAT_FIDDLE,
      'auto',
    );

    expect(leg.matched).toBe(false);
    expect(leg.shape).toEqual([
      BUX,
      CAT_FIDDLE,
    ]);
    expect(leg.distanceM).toBeNull();
  });

  it('treats a provider that returns nothing usable as unmatched', async () => {
    const leg = await routingService.routeLeg(
      fakeProvider({ legShape: () => [] }),
      BUX,
      CAT_FIDDLE,
      'auto',
    );

    expect(leg.matched).toBe(false);
    expect(leg.shape).toHaveLength(2);
  });
});

describe('createSnappedRoute', () => {
  const control = [
    BUX,
    CAT_FIDDLE,
    MAC,
  ];

  it('saves the previewed geometry, not a re-route', () => {
    /*
     * A shape that deliberately detours well off the straight line. If the
     * service re-routed on save, the stored geometry would come back as
     * something else and this detour would vanish.
     */
    const detour = NEWHAVEN;

    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Built by clicking',
      colour: null,
      controlPoints: control,
      legs: [
        previewed([control[0] as never, detour, control[1] as never]),
        previewed([control[1] as never, control[2] as never]),
      ],
      mode: 'auto',
      provider: 'fake',
    });

    const saved = routeService.get(db, mutation.result.id);
    // Four points: three leg vertices plus two, minus the shared one.
    expect(saved.points).toHaveLength(4);
    expect(saved.points[1]).toMatchObject(detour);
  });

  it('keeps the clicked points as control points', () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: control,
      legs: [
        previewed([control[0] as never, control[1] as never]),
        previewed([control[1] as never, control[2] as never]),
      ],
      mode: 'motorcycle',
      provider: 'fake',
    });

    const stored = controlRepo.listControlPoints(db, mutation.result.id);
    expect(stored).toHaveLength(3);
    expect(stored[0]).toMatchObject(BUX);

    const provenance = routingService.provenance(db, mutation.result.id);
    expect(provenance.routingProvider).toBe('fake');
    expect(provenance.transportMode).toBe('motorcycle');
    expect(provenance.controlPointCount).toBe(3);
  });

  it('records which legs stayed straight', () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: control,
      legs: [
        previewed([control[0] as never, control[1] as never]),
        previewed([control[1] as never, control[2] as never], false, null),
      ],
      mode: 'auto',
      provider: 'fake',
    });

    expect(
      routingService.provenance(db, mutation.result.id).unmatchedLegs,
    ).toEqual([[1, 2]]);
  });

  /*
   * A leg count that does not match the control points means the renderer's
   * preview and its points had drifted apart, so neither can be trusted. The
   * alternative — writing the legs anyway — stores a route whose control points
   * do not describe it, and a later re-snap silently produces a different line.
   */
  it('refuses a leg count that does not match the control points', () => {
    expect(() =>
      routingService.createSnappedRoute(db, {
        tripId,
        name: 'Route',
        colour: null,
        controlPoints: control,
        legs: [previewed([control[0] as never, control[1] as never])],
        mode: 'auto',
        provider: 'fake',
      }),
    ).toThrow(ServiceError);

    // And nothing was written.
    expect(routeService.listForTrip(db, tripId)).toHaveLength(0);
  });

  it('refuses fewer than two points', () => {
    expect(() =>
      routingService.createSnappedRoute(db, {
        tripId,
        name: 'Route',
        colour: null,
        controlPoints: [control[0] as never],
        legs: [],
        mode: 'auto',
        provider: 'fake',
      }),
    ).toThrow(ServiceError);
  });

  /*
   * Bounded by the undo limit rather than the higher snapped-route limit, so a
   * route built with the tool stays editable through `route:setGeometry`
   * afterwards. Producing a route this app can store but not edit would be
   * worse than refusing the last leg.
   */
  it('refuses a route past the editable point limit, naming the count', () => {
    const huge = Array.from({ length: MAX_UNDOABLE_POINTS + 10 }, (_, i) => ({
      lat: BUX.lat + i * 0.00001,
      lon: BUX.lon,
    }));

    let message = '';
    try {
      routingService.createSnappedRoute(db, {
        tripId,
        name: 'Route',
        colour: null,
        controlPoints: [control[0] as never, control[1] as never],
        legs: [previewed(huge)],
        mode: 'auto',
        provider: 'fake',
      });
    } catch (error) {
      message = (error as ServiceError).message;
    }

    expect(message).toContain(MAX_UNDOABLE_POINTS.toLocaleString());
    expect(routeService.listForTrip(db, tripId)).toHaveLength(0);
  });

  it('is undoable, and the undo takes the control points with it', async () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: control,
      legs: [
        previewed([control[0] as never, control[1] as never]),
        previewed([control[1] as never, control[2] as never]),
      ],
      mode: 'auto',
      provider: 'fake',
    });
    const id = mutation.result.id;
    undoService.record(mutation.inverse);

    expect(controlRepo.hasControlPoints(db, id)).toBe(true);

    undoService.undo(db);

    // The route is gone, and `route_control_points` cascades on delete, so no
    // orphaned control points are left behind.
    expect(routeService.listForTrip(db, tripId)).toHaveLength(0);
    expect(controlRepo.listControlPoints(db, id)).toHaveLength(0);
  });

  it('joins legs by the same rule as a whole-route snap', () => {
    const shared = CAT_FIDDLE;

    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: [control[0] as never, shared, control[2] as never],
      legs: [
        previewed([control[0] as never, shared]),
        previewed([shared, control[2] as never]),
      ],
      mode: 'auto',
      provider: 'fake',
    });

    // Three, not four: the shared vertex at the control point is dropped once,
    // exactly as `flattenLegs` does for `snapRoute`.
    expect(routeService.get(db, mutation.result.id).points).toHaveLength(3);
  });

  it('stores no elevation rather than copying it from a control point', () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Route',
      colour: null,
      controlPoints: [control[0] as never, control[1] as never],
      legs: [previewed([control[0] as never, control[1] as never])],
      mode: 'auto',
      provider: 'fake',
    });

    const saved = routeService.get(db, mutation.result.id);
    // Road vertices are different positions from the clicked points, so an
    // elevation measured elsewhere would be invented data.
    expect(saved.points.every((p) => p.ele === null)).toBe(true);
    expect(saved.elevGainM).toBeNull();
  });
});

// --------------------------------------------- control points off the graph

/**
 * A control point the engine cannot reach.
 *
 * This is the failure that prompted the whole mechanism, and it is worth
 * restating why it needs one. Valhalla does not refuse a point outside its
 * loaded graph — it silently snaps it to the nearest road it *does* have and
 * routes to there instead, reporting success and echoing the original
 * coordinates back. Measured against a Derbyshire-only graph, Macclesfield
 * came back displaced 3,111 m and Leek 10,670 m, and the route looked
 * perfectly plausible while going nowhere near either town. See ADR 0016.
 */
/** Scripts a leg whose far end lands well away from where it was asked. */
const offBy = (metres: number) =>
  fakeProvider({
    legShape: (from, to) => [
      from,
      // Dragged north: a degree of latitude is about 111.3 km.
      { lat: to.lat + metres / 111_320, lon: to.lon },
    ],
  });

describe('snapRoute with a control point off the graph', () => {
  it('reports the control point and how far it was moved', async () => {
    const route = newRoute([rp(BUX), rp(CAT_FIDDLE)]);

    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: offBy(4_000),
      mode: 'auto',
    });

    expect(mutation.result.displaced).toHaveLength(1);
    expect(mutation.result.displaced[0]?.index).toBe(1);
    expect(mutation.result.displaced[0]?.displacementM).toBeCloseTo(4_000, -2);
  });

  it('keeps the leg as a straight line rather than a confident wrong road', async () => {
    const route = newRoute([rp(BUX), rp(CAT_FIDDLE)]);

    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: offBy(4_000),
      mode: 'auto',
    });

    // The same treatment as "no road path between these two points". A line
    // the user can see is not a road beats a road route to the wrong place.
    expect(mutation.result.unmatchedLegs).toEqual([[0, 1]]);

    const saved = routeService.get(db, route.id);
    expect(saved.points).toHaveLength(2);
    expect(saved.points[1]?.lat).toBeCloseTo(CAT_FIDDLE.lat, 6);
    expect(saved.points[1]?.lon).toBeCloseTo(CAT_FIDDLE.lon, 6);
  });

  it('says nothing when the displacement is within tolerance', async () => {
    const route = newRoute([rp(BUX), rp(CAT_FIDDLE)]);

    // 40 m: a map click or a gazetteer coordinate is easily this far from a
    // carriageway, and snapping it is the operation working.
    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: offBy(40),
      mode: 'auto',
    });

    expect(mutation.result.displaced).toEqual([]);
    expect(mutation.result.unmatchedLegs).toEqual([]);
  });

  it('persists it, so the panel keeps saying so after a reload', async () => {
    const route = newRoute([rp(BUX), rp(CAT_FIDDLE)]);

    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: offBy(9_000),
      mode: 'auto',
    });

    // A route snapped against a region that did not reach it stays wrong until
    // it is re-snapped, so this cannot be a toast that scrolls away.
    const provenance = routingService.provenance(db, route.id);
    expect(provenance.displaced).toHaveLength(1);
    expect(provenance.displaced[0]?.displacementM).toBeCloseTo(9_000, -2);
    expect(provenance.unmatchedLegs).toEqual([[0, 1]]);
  });

  it('names every bad point in a multi-leg route, once each', async () => {
    // Four corners of the Buxton loop, every far end dragged off.
    const route = newRoute([rp(BUX), rp(MAC), rp(LEE), rp(ASH)]);

    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: offBy(3_000),
      mode: 'auto',
    });

    // Points 1, 2 and 3 are each the far end of a leg. Point 0 is only ever a
    // start, and starts are reported too — but this provider only moves ends,
    // so the indices are exactly the ends.
    expect(mutation.result.displaced.map((d) => d.index)).toEqual([1, 2, 3]);
    expect(mutation.result.unmatchedLegs).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('reports a displacement on the leg start as well as the end', async () => {
    const route = newRoute([rp(BUX), rp(CAT_FIDDLE)]);

    const mutation = await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({
        // Only the *start* is dragged, which is what a first control point
        // outside the graph looks like.
        legShape: (from, to) => [
          { lat: from.lat + 5_000 / 111_320, lon: from.lon },
          to,
        ],
      }),
      mode: 'auto',
    });

    expect(mutation.result.displaced.map((d) => d.index)).toEqual([0]);
  });
});

describe('routeLeg displacement', () => {
  it('reports how far the clicked point was moved', async () => {
    const leg = await routingService.routeLeg(
      fakeProvider({
        legShape: (from, to) => [
          from,
          { lat: to.lat + 6_000 / 111_320, lon: to.lon },
        ],
      }),
      BUX,
      CAT_FIDDLE,
      'auto',
    );

    // Surfaced per click so a point outside the loaded region is obvious when
    // it is placed, not after the whole route is drawn and saved.
    expect(leg.displacementM).toBeCloseTo(6_000, -2);
    expect(leg.matched).toBe(false);
  });

  it('reports null when the point landed on a road', async () => {
    const leg = await routingService.routeLeg(
      fakeProvider({}),
      BUX,
      CAT_FIDDLE,
      'auto',
    );
    expect(leg.displacementM).toBeNull();
    expect(leg.matched).toBe(true);
  });
});

// ------------------------------------------- Phase 6: roles and leg boundaries

const boundariesOf = (routeId: string): (number | null)[] =>
  controlRepo.listControlRows(db, routeId).map((row) => row.shapeIndex);

describe('leg boundaries and roles (Phase 6)', () => {
  it('a whole-route snap records a boundary for every control point', async () => {
    const route = newRoute([rp(BUX), rp(CAT_FIDDLE), rp(MAC)]);
    await routingService.snapRoute(db, {
      routeId: route.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });

    const points = routeService.get(db, route.id).points;
    const boundaries = boundariesOf(route.id);
    // Two three-point legs sharing a vertex: [BUX, mid, CAT, mid, MAC].
    expect(boundaries).toEqual([0, 2, 4]);
    expect(checkBoundaries(points.length, boundaries, 3)).toBe(true);
    expect(points[2]).toMatchObject(CAT_FIDDLE);
  });

  it('a route built in the tool records boundaries and roles, with ends forced to via', () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Shaped',
      colour: null,
      controlPoints: [BUX, CAT_FIDDLE, MAC],
      legs: [previewed([BUX, BURBAGE, CAT_FIDDLE]), previewed([CAT_FIDDLE, MAC])],
      roles: ['shaping', 'shaping', 'shaping'],
      mode: 'auto',
      provider: 'fake',
    });

    const rows = controlRepo.listControlRows(db, mutation.result.id);
    expect(rows.map((r) => r.role)).toEqual(['via', 'shaping', 'via']);
    expect(rows.map((r) => r.shapeIndex)).toEqual([0, 2, 3]);
  });

  it('a re-snap keeps each point’s role', async () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Shaped',
      colour: null,
      controlPoints: [BUX, CAT_FIDDLE, MAC],
      legs: [previewed([BUX, CAT_FIDDLE]), previewed([CAT_FIDDLE, MAC])],
      roles: ['via', 'shaping', 'via'],
      mode: 'auto',
      provider: 'fake',
    });

    await routingService.snapRoute(db, {
      routeId: mutation.result.id,
      provider: fakeProvider({}),
      mode: 'auto',
    });
    expect(controlRepo.listControlRows(db, mutation.result.id).map((r) => r.role)).toEqual([
      'via',
      'shaping',
      'via',
    ]);

    // A moved point supplied without a role is still the kind of point it was.
    await routingService.snapRoute(db, {
      routeId: mutation.result.id,
      provider: fakeProvider({}),
      mode: 'auto',
      controlPoints: [BUX, WALKER_BARN, MAC],
    });
    expect(controlRepo.listControlRows(db, mutation.result.id)[1]?.role).toBe('shaping');
  });

  it('undoing a re-snap restores the previous roles and boundaries exactly', async () => {
    const mutation = routingService.createSnappedRoute(db, {
      tripId,
      name: 'Shaped',
      colour: null,
      controlPoints: [BUX, CAT_FIDDLE, MAC],
      legs: [previewed([BUX, BURBAGE, CAT_FIDDLE]), previewed([CAT_FIDDLE, MAC])],
      roles: ['via', 'shaping', 'via'],
      mode: 'auto',
      provider: 'fake',
    });
    const before = controlRepo.listControlRows(db, mutation.result.id);

    const resnap = await routingService.snapRoute(db, {
      routeId: mutation.result.id,
      provider: fakeProvider({ legShape: (from, to) => [from, NEWHAVEN, to] }),
      mode: 'auto',
    });
    expect(boundariesOf(mutation.result.id)).toEqual([0, 2, 4]);

    undoService.record(resnap.inverse);
    undoService.undo(db);
    expect(controlRepo.listControlRows(db, mutation.result.id)).toEqual(before);
  });

  it('stores unknown rather than wrong boundaries when a provider returns the wrong number of legs', async () => {
    const route = newRoute([rp(BUX), rp(CAT_FIDDLE), rp(MAC)]);
    const broken = fakeProvider({});
    const lying: RoutingProvider = {
      ...broken,
      async snap(points, mode) {
        const result = await broken.snap(points, mode);
        return { ...result, legs: result.legs.slice(0, 1) };
      },
    };
    await routingService.snapRoute(db, { routeId: route.id, provider: lying, mode: 'auto' });
    expect(boundariesOf(route.id)).toEqual([null, null, null]);
  });
});
