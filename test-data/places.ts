import type { Bounds, RoutePoint, TrackPoint } from '@shared/domain/types';
// The import attribute is required, not decorative: the end-to-end specs are
// loaded by Node directly rather than through a bundler, and Node refuses a
// JSON module without it.
import data from './places.json' with { type: 'json' };

/**
 * The test geography: a loop around the Peak District, based on Buxton.
 *
 * Every automated test that needs a *place* uses this module, so there is one
 * answer to "where do the tests happen" rather than a different invented
 * coordinate in each file. Format-parsing tests that only need some numbers
 * are free to keep using their own; what belongs here is anything where the
 * geography is load-bearing — snapping, map-region selection, road attributes,
 * and the end-to-end fixtures a reader is meant to recognise.
 *
 * ## The square
 *
 * Four real market towns at the corners of a rough quadrilateral:
 *
 * ```
 *   Macclesfield ────── A537 "Cat and Fiddle" ────── Buxton
 *        │                                              │
 *      A523                                           A515
 *        │                                              │
 *      Leek ───────── A523 / A52 ───────────────── Ashbourne
 * ```
 *
 * Buxton and Macclesfield sit at almost the same latitude — 53.2588 and
 * 53.2602 — so the northern edge is close to a straight east–west line, which
 * is what makes the shape read as a box rather than a scribble. The loop is
 * about 84 km as straight lines between the corners and rather more by road.
 *
 * It is a real circuit, which matters for three reasons:
 *
 * 1. **Snapping can be judged.** A snapped route is supposed to stay close to
 *    the control points it was given. With invented coordinates in open
 *    country there is nothing to be close *to*, and a snap test can only
 *    assert that something came back.
 * 2. **The A537 over the Cat and Fiddle is genuinely twisty**, and climbs from
 *    130 m at Macclesfield to 515 m at the inn. That exercises the elevation
 *    profile and the road-class and speed-limit bands properly, and it is the
 *    obvious fixture for the windy-roads routing work.
 * 3. **The loop spans three counties** — Derbyshire, Cheshire and
 *    Staffordshire — and Geofabrik publishes England by county. So no single
 *    county extract covers the whole square. That is not an inconvenience; it
 *    is the case the region picker was designed around, and it is now a
 *    fixture rather than a hypothetical. See `LOOP_VIEWPORT`.
 *
 * ## What these coordinates are, exactly
 *
 * Town coordinates are the published town-centre positions, cross-checked
 * between sources and rounded to four decimal places — about 10 m, which is
 * finer than "the middle of Buxton" means. The `via` points are approximate
 * positions of named places along the named A-roads, chosen so a synthetic
 * shape follows a real road corridor.
 *
 * They are **not** claimed to sit exactly on a carriageway. They do not need
 * to: snapping to the nearest road is the operation under test, and a point a
 * few metres off is a more honest input than one hand-placed onto a way.
 *
 * Nothing here is recorded GPS data, as `.kiro/steering/architecture.md`
 * requires. These are public place coordinates, and the tracks below are
 * interpolated between them by `recordedLoop()`.
 */

export interface Place {
  name: string;
  lat: number;
  lon: number;
  eleM: number;
}

export interface Town extends Place {
  county: string;
}

export type TownId = keyof typeof data.towns;

export interface Leg {
  from: TownId;
  to: TownId;
  /** How a rider would refer to it. */
  label: string;
  /** The road numbers it follows. */
  roads: string[];
  /** Named places along the way, in order. */
  via: Place[];
}

export const TOWNS: Record<TownId, Town> = data.towns;

export const BUXTON = TOWNS.buxton;
export const MACCLESFIELD = TOWNS.macclesfield;
export const LEEK = TOWNS.leek;
export const ASHBOURNE = TOWNS.ashbourne;

/** The four legs, in ride order, starting and ending at Buxton. */
export const LEGS: Leg[] = data.legs as Leg[];

/**
 * The four corners, in ride order.
 *
 * Open rather than closed: the final return to Buxton is the fourth leg, and
 * repeating the start point as a fifth corner would make every "four corners"
 * assertion read as five.
 */
export const CORNERS: Town[] = [BUXTON, MACCLESFIELD, LEEK, ASHBOURNE];

/**
 * The corners as route control points.
 *
 * This is the input a snap is given: four clicks, one per town. What comes
 * back should be a road route through all four, which is the whole claim
 * snapping makes.
 */
export function corners(): RoutePoint[] {
  return CORNERS.map((town) => ({
    lat: town.lat,
    lon: town.lon,
    ele: town.eleM,
    name: town.name,
    symbol: null,
    notes: null,
  }));
}

/** The corners closed back to the start, for a complete circuit. */
export function closedLoop(): RoutePoint[] {
  const first = corners()[0] as RoutePoint;
  return [...corners(), { ...first }];
}

/**
 * Every point of the loop including the via points: corners, then the places
 * along each leg, closing back at Buxton.
 *
 * Roughly a hundred kilometres described by sixteen points, which is the shape
 * of a hand-drawn route rather than a recording.
 */
export function loopShape(): Place[] {
  const shape: Place[] = [];
  for (const leg of LEGS) {
    shape.push(TOWNS[leg.from], ...leg.via);
  }
  // Closed: the last leg ends where the first began.
  shape.push(TOWNS[LEGS[0]?.from ?? 'buxton']);
  return shape;
}

/** One leg's shape, corner to corner, including its via points. */
export function legShape(index: number): Place[] {
  const leg = LEGS[index];
  if (leg === undefined) {
    throw new Error(`no leg ${index}; the loop has ${LEGS.length}`);
  }
  return [TOWNS[leg.from], ...leg.via, TOWNS[leg.to]];
}

/** The Cat and Fiddle: Buxton to Macclesfield over the A537. */
export function catAndFiddle(): Place[] {
  return legShape(0);
}

/**
 * A plausible recorded ride round the loop.
 *
 * Interpolated between the shape points rather than invented freehand, so the
 * track follows the same corridor as the route and the two can be compared.
 * `perLeg` points are produced between each consecutive pair.
 *
 * Timestamps advance at a steady `speedKmh`, which is deliberately simple: a
 * test that needs varying speed can say so, and a test that needs *a* speed
 * should not have to reason about an invented acceleration curve.
 */
export function recordedLoop(
  options: {
    perSegment?: number;
    startedAt?: number;
    speedKmh?: number;
    /** Leave timestamps absent, for the untimed-recording cases. */
    untimed?: boolean;
    /** Leave elevations absent, for the no-elevation cases. */
    noElevation?: boolean;
  } = {},
): TrackPoint[] {
  const perSegment = options.perSegment ?? 8;
  const speedKmh = options.speedKmh ?? 45;
  const shape = loopShape();

  const points: TrackPoint[] = [];
  let elapsedMs = 0;
  const startedAt = options.startedAt ?? Date.UTC(2026, 4, 16, 9, 0, 0);

  for (const [index, from] of shape.entries()) {
    const to = shape[index + 1];
    if (to === undefined) break;

    const metres = haversine(from, to);
    const stepMs = (metres / perSegment / 1000 / speedKmh) * 3_600_000;

    for (let step = 0; step < perSegment; step += 1) {
      const t = step / perSegment;
      points.push({
        lat: from.lat + (to.lat - from.lat) * t,
        lon: from.lon + (to.lon - from.lon) * t,
        // Absent stays absent: null, never 0, for the no-elevation fixtures.
        ele: options.noElevation === true
          ? null
          : Math.round(from.eleM + (to.eleM - from.eleM) * t),
        time: options.untimed === true
          ? null
          : Math.round(startedAt + elapsedMs),
      });
      elapsedMs += stepMs;
    }
  }

  // The closing point, so the recording actually returns to Buxton.
  const last = shape.at(-1);
  if (last !== undefined) {
    points.push({
      lat: last.lat,
      lon: last.lon,
      ele: options.noElevation === true ? null : last.eleM,
      time: options.untimed === true ? null : Math.round(startedAt + elapsedMs),
    });
  }

  return points;
}

/**
 * The loop split into one track segment per leg.
 *
 * Four segments with real gaps between them, which is what a day of riding
 * with stops looks like to a recorder — and what the segment-preservation
 * rules in ADR 0003 and Phase 5 exist to protect.
 */
export function recordedLegs(
  options: { perSegment?: number; startedAt?: number } = {},
): TrackPoint[][] {
  const perSegment = options.perSegment ?? 6;
  const startedAt = options.startedAt ?? Date.UTC(2026, 4, 16, 9, 0, 0);

  return LEGS.map((_leg, index) => {
    const shape = legShape(index);
    const points: TrackPoint[] = [];
    // An hour between segments: long enough that no test could mistake it for
    // a sampling interval.
    let elapsed = startedAt + index * 3_600_000;

    for (const [position, from] of shape.entries()) {
      const to = shape[position + 1];
      if (to === undefined) break;
      const stepMs = (haversine(from, to) / perSegment / 1000 / 45) * 3_600_000;

      for (let step = 0; step < perSegment; step += 1) {
        const t = step / perSegment;
        points.push({
          lat: from.lat + (to.lat - from.lat) * t,
          lon: from.lon + (to.lon - from.lon) * t,
          ele: Math.round(from.eleM + (to.eleM - from.eleM) * t),
          time: Math.round(elapsed),
        });
        elapsed += stepMs;
      }
    }

    const end = shape.at(-1);
    if (end !== undefined) {
      points.push({
        lat: end.lat,
        lon: end.lon,
        ele: end.eleM,
        time: Math.round(elapsed),
      });
    }
    return points;
  });
}

// ------------------------------------------------------------- viewports

/**
 * Buxton, zoomed to the town.
 *
 * Firmly inside Derbyshire, so the region picker has an unambiguous answer.
 * That is the point of having it separately from `LOOP_VIEWPORT`.
 */
export const BUXTON_VIEWPORT: Bounds = data.viewports.buxton;

/**
 * The whole square, with a little padding.
 *
 * Deliberately spans Derbyshire, Cheshire and Staffordshire. Geofabrik
 * publishes England by county, so **no county extract covers this view** —
 * which is exactly the case `rankRegions` has to handle honestly: offer the
 * most specific region at the centre, report that it does not cover the
 * viewport, and keep the larger option that does in the list.
 */
export const LOOP_VIEWPORT: Bounds = data.viewports.loop;

/** A wider view, for the "a regional view resolves to something sensible" case. */
export const PEAK_DISTRICT_VIEWPORT: Bounds = data.viewports.peakDistrict;

/**
 * Twenty points along the A537 out of Buxton, sampled from a real snapped
 * route so they lie on the carriageway.
 *
 * Map matching needs a **trace**, not waypoints. Valhalla answers four sparse
 * corridor points with HTTP 400, error 444, "map snap algorithm failed to snap
 * the shape points", and straight-line interpolation between them fails too
 * because it cuts the bends off a road whose bends are the whole character of
 * it. These are about 640 m apart and on the road, which matches.
 *
 * Used by the Electron verification script, which has to prove the in-process
 * engine returns posted speed limits and therefore has to get past map
 * matching first.
 */
export const CAT_AND_FIDDLE_TRACE: { lat: number; lon: number }[] =
  data.traces.catAndFiddle;

/**
 * The same thing on the A515, Buxton south towards Newhaven — 18 km that stay
 * **inside Derbyshire**.
 *
 * This is the one to use against a locally built graph. The A537 crosses the
 * county boundary into Cheshire around the Cat and Fiddle, so a `derbyshire`
 * extract covers only half of it, and a test routing over the border would
 * fail for a reason that has nothing to do with the code. Derbyshire is 44 MB
 * and builds in well under a minute, which makes it the practical choice for
 * the Electron verification and the embedded end-to-end spec.
 */
export const A515_TRACE: { lat: number; lon: number }[] = data.traces.a515;

/** The Geofabrik extract that covers `A515_TRACE` and the eastern leg. */
export const LOCAL_TEST_REGION = 'derbyshire';

/** Where the map should open for these fixtures. */
export const LOOP_CENTRE = {
  lat: (LOOP_VIEWPORT.minLat + LOOP_VIEWPORT.maxLat) / 2,
  lon: (LOOP_VIEWPORT.minLon + LOOP_VIEWPORT.maxLon) / 2,
};

// --------------------------------------------------------------- helpers

/**
 * Great-circle distance in metres.
 *
 * Duplicated from `shared/geo/distance` on purpose: a fixture that computed
 * its expectations with the same function the tests are checking would agree
 * with it by construction, including when both are wrong.
 */
const toRad = (deg: number): number => (deg * Math.PI) / 180;

function haversine(
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

/** Straight-line length of the closed loop, in metres. */
export function loopPerimeterM(): number {
  const shape = loopShape();
  let total = 0;
  for (const [index, point] of shape.entries()) {
    const next = shape[index + 1];
    if (next !== undefined) total += haversine(point, next);
  }
  return total;
}

/** Straight-line distance between two towns, in metres. */
export function betweenTowns(from: TownId, to: TownId): number {
  return haversine(TOWNS[from], TOWNS[to]);
}

/** A road beyond the square, for calibrating the twistiness score. ADR 0018. */
export interface ReferenceRoad {
  label: string;
  from: { name: string; lat: number; lon: number };
  to: { name: string; lat: number; lon: number };
  /** A point on the road the route must pass, so a detour fails the test. */
  passes?: { name: string; lat: number; lon: number };
}

export const REFERENCE_ROADS: { snakePass: ReferenceRoad; m6: ReferenceRoad } = {
  snakePass: data.referenceRoads.snakePass,
  m6: data.referenceRoads.m6,
};
