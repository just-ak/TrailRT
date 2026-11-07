import type { LatLon } from './distance';

/**
 * Point-in-polygon and bounding-box helpers.
 *
 * Added for matching a map viewport against published region boundaries, but
 * kept general and pure — no provider, no network, no assumptions about where
 * the polygons came from. Lives in `shared/geo/` with the rest of the geometry
 * maths so it is unit-testable without Electron.
 *
 * Deliberately planar rather than spherical. These polygons are coarse
 * administrative outlines spanning degrees, and the question asked of them is
 * "which country am I looking at" — an answer that does not change for want of
 * great-circle edges. `distance.ts` is where sphere-accurate maths belongs.
 */

/** A closed ring of `[lon, lat]` pairs, as GeoJSON orders them. */
export type Ring = readonly (readonly [number, number])[];

export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/**
 * Whether a point falls inside a ring.
 *
 * Ray casting: count the edges a ray from the point crosses, odd means inside.
 * The `(y1 > lat) !== (y2 > lat)` test is what keeps a vertex exactly level
 * with the ray from being counted twice — the usual cause of a point just
 * outside a border reading as inside.
 */
export function pointInRing(ring: Ring, point: LatLon): boolean {
  let inside = false;
  const count = ring.length;

  for (let i = 0; i < count; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % count];
    if (a === undefined || b === undefined) continue;

    const [ax, ay] = a;
    const [bx, by] = b;

    if (ay > point.lat !== by > point.lat) {
      const x = ax + ((point.lat - ay) / (by - ay)) * (bx - ax);
      if (point.lon < x) inside = !inside;
    }
  }

  return inside;
}

/**
 * Whether a point falls inside any of a set of rings.
 *
 * Holes are not modelled. A region's outer rings are what matter here, and
 * treating a hole as solid would at worst suggest a slightly larger extract —
 * whereas handling holes wrongly could exclude the enclave a user is actually
 * looking at. Over-inclusion is the safe direction.
 */
export function pointInRings(rings: readonly Ring[], point: LatLon): boolean {
  return rings.some((ring) => pointInRing(ring, point));
}

export function ringsBoundingBox(rings: readonly Ring[]): BoundingBox | null {
  let minLat = Number.POSITIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let seen = false;

  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      seen = true;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }

  return seen ? { minLat, minLon, maxLat, maxLon } : null;
}

/**
 * Area of a bounding box in square degrees.
 *
 * A proxy for "how big is this region", used only to rank candidates against
 * each other. Square degrees are not a real area — a degree of longitude
 * shrinks towards the poles — but the comparison is between nested regions at
 * similar latitudes, where the distortion cancels. Converting to km² would add
 * arithmetic without changing a single ordering.
 */
export function boundingBoxArea(box: BoundingBox): number {
  return (box.maxLat - box.minLat) * (box.maxLon - box.minLon);
}

export function boundingBoxCentre(box: BoundingBox): LatLon {
  return {
    lat: (box.minLat + box.maxLat) / 2,
    lon: (box.minLon + box.maxLon) / 2,
  };
}

export function boundingBoxCorners(box: BoundingBox): LatLon[] {
  return [
    { lat: box.minLat, lon: box.minLon },
    { lat: box.minLat, lon: box.maxLon },
    { lat: box.maxLat, lon: box.minLon },
    { lat: box.maxLat, lon: box.maxLon },
  ];
}

/** Whether every corner of `box` falls inside the rings. */
export function ringsContainBox(
  rings: readonly Ring[],
  box: BoundingBox,
): boolean {
  return boundingBoxCorners(box).every((corner) =>
    pointInRings(rings, corner),
  );
}
