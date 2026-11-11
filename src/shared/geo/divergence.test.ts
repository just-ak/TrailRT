import { describe, expect, it } from 'vitest';
import type { LatLon } from './distance';
import { haversineDistance } from './distance';
import { distanceToLineM, farthestFrom, overlap } from './divergence';
import { reversalAt } from './reversal';

/** Buxton market place, as the origin for metre offsets. */
const ORIGIN = { lat: 53.2588, lon: -1.9115 };

/** A point `east` and `north` metres from ORIGIN. */
function at(east: number, north: number): LatLon {
  const k = 6_371_008.8 * (Math.PI / 180);
  return {
    lat: ORIGIN.lat + north / k,
    lon: ORIGIN.lon + east / (k * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  };
}

/** A straight east-west line, `length` metres long, `north` metres up. */
function eastward(length: number, north = 0, step = 50): LatLon[] {
  const out: LatLon[] = [];
  for (let x = 0; x <= length; x += step) out.push(at(x, north));
  return out;
}

describe('overlap', () => {
  it('is 1 for identical lines', () => {
    const line = eastward(2000);
    expect(overlap(line, line)).toBe(1);
  });

  it('is 0 for lines far apart', () => {
    expect(overlap(eastward(2000), eastward(2000, 500))).toBe(0);
  });

  it('treats a parallel line inside the tolerance as the same road and outside it as not', () => {
    expect(overlap(eastward(2000), eastward(2000, 20), 25)).toBe(1);
    expect(overlap(eastward(2000), eastward(2000, 30), 25)).toBe(0);
  });

  it('is not fooled by containment', () => {
    // A short line lying along part of a long one is fully covered by it, but
    // they are not the same route.
    const long = eastward(4000);
    const short = eastward(1000);
    expect(overlap(short, long)).toBeCloseTo(0.25, 1);
  });

  it('measures a partial departure by length', () => {
    // Same road for 3 km, then 1 km on a road 200 m north.
    const a = eastward(4000);
    const b = [...eastward(3000), ...eastward(1000, 200).map((_, i) => at(3000 + i * 50, 200))];
    const value = overlap(a, b);
    expect(value).toBeGreaterThan(0.7);
    expect(value).toBeLessThan(0.8);
  });

  it('ignores vertex density: the same road at different spacing agrees', () => {
    expect(overlap(eastward(2000, 0, 10), eastward(2000, 0, 400))).toBe(1);
  });
});

describe('farthestFrom', () => {
  it('finds the segment of the candidate farthest from the reference', () => {
    // The reference runs straight; the candidate bulges 300 m north in the middle.
    const reference = eastward(2000);
    const candidate = [at(0, 0), at(500, 100), at(1000, 300), at(1500, 100), at(2000, 0)];
    const hit = farthestFrom(candidate, reference);
    expect(hit).not.toBeNull();
    // Segments 1 and 2 both touch the 300 m apex; their midpoints are 200 m out.
    expect([1, 2]).toContain(hit?.segmentIndex);
    expect(hit?.distanceM).toBeCloseTo(200, 0);
  });

  it('returns a segment midpoint, never a vertex', () => {
    const reference = eastward(2000);
    const candidate = [at(0, 0), at(1000, 400), at(2000, 0)];
    const hit = farthestFrom(candidate, reference);
    const vertexHit = candidate.some(
      (v) => hit !== null && haversineDistance(v, hit.midpoint) < 1,
    );
    expect(vertexHit).toBe(false);
    // And it lies on the candidate.
    expect(distanceToLineM(hit?.midpoint as LatLon, candidate)).toBeLessThan(0.5);
  });

  it('is null for a candidate with no segments', () => {
    expect(farthestFrom([at(0, 0)], eastward(100))).toBeNull();
  });
});

describe('reversalAt', () => {
  it('flags an out-and-back spur', () => {
    // East 1 km to the apex, then straight back west along the same road.
    const out = eastward(1000);
    const back = out.slice(0, -1).toReversed();
    const shape = [...out, ...back];
    expect(reversalAt(shape, out.length - 1)).toBe(true);
  });

  it('does not flag a right-angle turn', () => {
    const shape = [...eastward(1000), ...[1, 2, 3, 4, 5, 6].map((k) => at(1000, k * 50))];
    expect(reversalAt(shape, 20)).toBe(false);
  });

  it('does not flag a hairpin whose arms are separated', () => {
    // Up 400 m, across 60 m, back down: a switchback, not a retrace.
    const up = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => at(0, k * 50));
    const down = [8, 7, 6, 5, 4, 3, 2, 1, 0].map((k) => at(60, k * 50));
    const shape = [...up, at(30, 420), ...down];
    expect(reversalAt(shape, up.length)).toBe(false);
  });

  it('is false at the ends and when the route is too short to judge', () => {
    const shape = eastward(1000);
    expect(reversalAt(shape, 0)).toBe(false);
    expect(reversalAt(shape, shape.length - 1)).toBe(false);
    expect(reversalAt(eastward(100), 1)).toBe(false);
  });
});
