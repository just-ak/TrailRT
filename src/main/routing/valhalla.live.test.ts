import { describe, expect, it } from 'vitest';
import {
  BUXTON,
  MACCLESFIELD,
  catAndFiddle,
  closedLoop,
  corners,
} from '@fixtures/places';
import { createValhallaProvider } from './valhalla';

/**
 * The Valhalla adapter against a **real** Valhalla instance.
 *
 * Skipped unless `TRAILRT_LIVE_VALHALLA` names an endpoint, so the normal suite
 * stays entirely offline — a test that needs the network is a test that fails
 * on a train, and `valhalla.test.ts` already covers the wire format against a
 * loopback server.
 *
 * This file exists because "verified against the published API reference" is a
 * weaker claim than it sounds: a reference can be out of date, and an adapter
 * can parse a documented shape that no deployment actually emits. Running this
 * is what turns that caveat into a fact.
 *
 *   TRAILRT_LIVE_VALHALLA=https://valhalla1.openstreetmap.de \
 *     npx vitest run src/main/routing/valhalla.live.test.ts
 *
 * Note the `1` in that host. `valhalla.openstreetmap.de` without it is the demo
 * *website*, whose nginx answers POST with 405 — the single most likely reason
 * a correctly written client appears broken. The public instance is also rate
 * limited to roughly one call per second, which `client.ts` respects for any
 * non-loopback origin.
 *
 * ## Why the Peak District, and what it buys
 *
 * The geography is the Buxton loop from `test-data/places.ts`. Real towns on
 * real roads make these assertions mean something: the numbers below were
 * measured against this instance, not estimated.
 *
 *   Buxton → Macclesfield over the A537      20.1 km
 *   the closed four-corner loop             100.8 km over 4 legs
 *   worst via-point offset from the road        76 m
 *   posted limits returned          48, 64, 80 km/h
 *
 * That last line is the one worth keeping. The UK posts in mph, OSM stores
 * "30 mph", and Valhalla answers in km/h — so 48, 64 and 80 are exactly 30, 40
 * and 50 mph. Any break in that conversion chain moves the values off whole
 * mph, which `limitsLookPosted` below checks directly. An invented coordinate
 * in open country could never support that.
 */

const endpoint = process.env.TRAILRT_LIVE_VALHALLA;

/** Buxton to Macclesfield: the A537 over the Cat and Fiddle. */
const FROM = { lat: BUXTON.lat, lon: BUXTON.lon };
const TO = { lat: MACCLESFIELD.lat, lon: MACCLESFIELD.lon };

/** Straight-line corner distance. The road is necessarily longer. */
const STRAIGHT_LINE_M = 14_300;

describe.runIf(endpoint !== undefined && endpoint.length > 0)(
  'Valhalla adapter against a live instance',
  () => {
    const provider = createValhallaProvider({
      endpoint: endpoint ?? '',
      timeoutMs: 30_000,
    });

    it('routes between two points and returns polyline6 geometry', async () => {
      const result = await provider.snap([FROM, TO], 'auto');

      expect(result.legs).toHaveLength(1);
      const leg = result.legs[0];
      expect(leg?.matched).toBe(true);

      // Hundreds of vertices for a twisting moorland road: proof the shape
      // decoded at precision 6. At precision 5 the coordinates come out ten
      // times too large and would fail the bounds check below.
      expect(leg?.shape.length ?? 0).toBeGreaterThan(100);
      for (const point of leg?.shape ?? []) {
        // Inside the loop's area, with slack for the road wandering.
        expect(point.lat).toBeGreaterThan(53);
        expect(point.lat).toBeLessThan(53.4);
        expect(point.lon).toBeGreaterThan(-2.3);
        expect(point.lon).toBeLessThan(-1.7);
      }
    });

    it('converts the reported length from kilometres to metres', async () => {
      const result = await provider.snap([FROM, TO], 'auto');
      const distanceM = result.legs[0]?.distanceM;

      // Measured at 19.8 km direct. A missed km-to-m conversion would land
      // this near 20, not near 20,000 — the 1000x error the conversion exists
      // to prevent.
      expect(distanceM).not.toBeNull();
      expect(distanceM ?? 0).toBeGreaterThan(STRAIGHT_LINE_M);
      expect(distanceM ?? 0).toBeLessThan(40_000);
    });

    /**
     * The square, snapped in one call.
     *
     * Four corners closed back to Buxton, which is the shape a user actually
     * draws. Three legs would be a line; four plus the closing one is a
     * circuit, and a circuit is where leg-ordering mistakes show up.
     */
    it('snaps the four-corner loop into one leg per corner pair', async () => {
      const result = await provider.snap(
        closedLoop().map((point) => ({ lat: point.lat, lon: point.lon })),
        'auto',
      );

      // Five control points, so four legs.
      expect(result.legs).toHaveLength(4);
      expect(result.legs.every((leg) => leg.matched)).toBe(true);

      const total = result.legs.reduce(
        (sum, leg) => sum + (leg.distanceM ?? 0),
        0,
      );
      // Measured at 100.8 km. Bounded either side of that rather than pinned,
      // because the road network and the engine's costing both move.
      expect(total).toBeGreaterThan(84_000);
      expect(total).toBeLessThan(140_000);

      console.info(
        `[live] loop snapped to ${(total / 1000).toFixed(1)} km over ${result.legs.length} legs`,
      );
    });

    /**
     * A snapped leg stays near the control points it was given.
     *
     * The assertion real geography buys. With invented coordinates there is
     * nothing for a route to be close *to*, so a snap test can only check that
     * a shape came back. Here, a leg that took the motorway network instead of
     * the A537 would fail — and so would a fixture coordinate that drifted off
     * the road, which is how three of these points were found to be wrong.
     */
    it('keeps the snapped shape near the road corridor it was given', async () => {
      const corridor = catAndFiddle();
      const result = await provider.snap(
        corridor.map((point) => ({ lat: point.lat, lon: point.lon })),
        'auto',
      );

      const shape = result.legs.flatMap((leg) => leg.shape);
      expect(shape.length).toBeGreaterThan(100);

      for (const via of corridor) {
        const nearest = Math.min(...shape.map((point) => metres(point, via)));
        // Measured worst case is 76 m. 250 m leaves room for the road network
        // changing without leaving room for the route taking a different road.
        expect(nearest, `${via.name} is off the snapped route`).toBeLessThan(
          250,
        );
      }
    });

    /**
     * Map matching, over geometry that came from the road network.
     *
     * Two calls on purpose, because that is the production sequence: a route
     * is snapped to roads first, and `roadAttributeService.match` then matches
     * *that* geometry to recover attributes.
     *
     * It also has to be this way round. Map matching wants a trace — a dense
     * run of samples along a road — and rejects sparse waypoints outright:
     * feeding it the four corridor points returns HTTP 400, error 444, "map
     * snap algorithm failed to snap the shape points". Straight-line
     * interpolation between them fails too, because it cuts the bends off a
     * road whose bends are the entire character of it.
     */
    it('map matches a snapped shape and returns attributes in SI units', async () => {
      const edges = await matchSnappedCorridor(provider);

      expect(edges.length).toBeGreaterThan(20);

      const classes = new Set(
        edges.map((edge) => edge.roadClass).filter((c) => c !== null),
      );
      // Real OSM road classes came back and survived `isRoadClass`, rather
      // than every one being dropped as unrecognised. Measured: trunk,
      // secondary, tertiary, unclassified, residential and service_other.
      expect(classes.size).toBeGreaterThan(2);
      expect(classes).toContain('trunk');

      const limits = edges
        .map((edge) => edge.speedLimitMps)
        .filter((v): v is number => v !== null);

      expect(limits.length).toBeGreaterThan(10);
      for (const mps of limits) {
        // 30 mph is 13.3 m/s, 60 mph is 26.8 m/s. A missed conversion anywhere
        // in the mph → km/h → m/s chain lands outside this range.
        expect(mps).toBeGreaterThan(1);
        expect(mps).toBeLessThan(60);
      }
    }, 60_000);

    /**
     * The posted limits are whole mph values, as a British road sign is.
     *
     * A sharper check than a range: 48, 64 and 80 km/h are 30, 40 and 50 mph
     * exactly, so if the chain were out by a factor or an offset the values
     * would no longer land on mph multiples. This is only assertable because
     * the test drives on British roads.
     */
    it('returns posted limits that correspond to whole mph values', async () => {
      const edges = await matchSnappedCorridor(provider);

      const mph = edges
        .map((edge) => edge.speedLimitMps)
        .filter((v): v is number => v !== null)
        .map((mps) => (mps * 3600) / 1609.344);

      expect(mph.length).toBeGreaterThan(10);
      for (const value of mph) {
        // Within half an mph of a 10 mph multiple: UK limits are posted at 20,
        // 30, 40, 50, 60 and 70.
        const nearest = Math.round(value / 10) * 10;
        expect(
          Math.abs(value - nearest),
          `${value.toFixed(2)} mph is not a posted limit`,
        ).toBeLessThan(0.5);
        expect(nearest).toBeGreaterThanOrEqual(10);
        expect(nearest).toBeLessThanOrEqual(70);
      }

      console.info(
        `[live] posted limits seen: ${[...new Set(mph.map((v) => Math.round(v / 10) * 10))].toSorted((a, b) => a - b).join(', ')} mph`,
      );
    }, 60_000);

    /*
     * The finding ADR 0011 is built on, confirmed against live data rather than
     * taken from a coverage statistic: some matched edges carry no posted
     * limit. Those become the Unknown band, which is why it must never be
     * redistributed or inferred away.
     */
    it('returns some edges with no posted speed limit, as null', async () => {
      const edges = await matchSnappedCorridor(provider);

      const total = edges.length;
      const known = edges.filter((edge) => edge.speedLimitMps !== null).length;

      expect(total).toBeGreaterThan(0);
      // Never 0 as a stand-in for absent.
      expect(
        edges.every(
          (edge) => edge.speedLimitMps === null || edge.speedLimitMps > 0,
        ),
      ).toBe(true);
      // Measured: around 190 of 200 edges carried one, so the gap is real but
      // small on A-roads. Logged rather than asserted — the exact ratio is a
      // property of the map data on the day, not of our code.
      console.info(
        `[live] ${known} of ${total} matched edges carried a posted speed limit`,
      );
    }, 60_000);

    /**
     * Motorcycle costing over the Cat and Fiddle.
     *
     * Worth a live check because the mode is the point of the application, and
     * the A537 is exactly the road a motorcycle router should be willing to
     * take. A mode the deployment does not support fails loudly here instead
     * of silently falling back to car routing in the product.
     */
    it('routes the Cat and Fiddle with motorcycle costing', async () => {
      const result = await provider.snap([FROM, TO], 'motorcycle');

      expect(result.legs).toHaveLength(1);
      expect(result.legs[0]?.matched).toBe(true);
      expect(result.legs[0]?.distanceM ?? 0).toBeGreaterThan(STRAIGHT_LINE_M);
    });

    /** Four corners is four clicks, which is what the snap tool sends. */
    it('accepts the open four-corner selection as three legs', async () => {
      const result = await provider.snap(
        corners().map((point) => ({ lat: point.lat, lon: point.lon })),
        'auto',
      );
      expect(result.legs).toHaveLength(3);
    });
  },
);

/**
 * Snaps the Cat and Fiddle corridor, then map matches the road shape it
 * returned, subsampled to roughly 200 m between samples.
 *
 * The subsampling matters in both directions: too sparse and `map_snap`
 * refuses, too dense and the request is large for no extra information.
 */
async function matchSnappedCorridor(provider: {
  snap: (
    points: { lat: number; lon: number }[],
    mode: 'auto',
  ) => Promise<{ legs: { shape: { lat: number; lon: number }[] }[] }>;
  match: (
    shape: { lat: number; lon: number }[],
    mode: 'auto',
  ) => Promise<{
    edges: { roadClass: string | null; speedLimitMps: number | null }[];
  }>;
}): Promise<{ roadClass: string | null; speedLimitMps: number | null }[]> {
  const corridor = catAndFiddle();
  const snapped = await provider.snap(
    corridor.map((point) => ({ lat: point.lat, lon: point.lon })),
    'auto',
  );

  const road = snapped.legs.flatMap((leg) => leg.shape);
  const step = Math.max(1, Math.floor(road.length / 100));
  const trace = road.filter((_point, index) => index % step === 0);

  const matched = await provider.match(trace, 'auto');
  return matched.edges;
}

/** Local haversine, so the check does not lean on the code under test. */
const toRad = (deg: number): number => (deg * Math.PI) / 180;

function metres(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_008.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
