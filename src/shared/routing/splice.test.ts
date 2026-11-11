import { describe, expect, it } from 'vitest';
import type { LatLon } from '../geo/distance';
import {
  checkBoundaries,
  flattenLegsWithBoundaries,
  legOfSegment,
  legShapes,
  spliceLegs,
} from './splice';

const p = (lat: number, lon: number): LatLon => ({ lat, lon });

/** Three legs that meet exactly at their joins. */
const JOINED = [
  { shape: [p(0, 0), p(0, 1), p(0, 2)] },
  { shape: [p(0, 2), p(1, 2), p(2, 2)] },
  { shape: [p(2, 2), p(2, 3)] },
];

describe('flattenLegsWithBoundaries', () => {
  it('shares the vertex where legs meet and records it as the boundary', () => {
    const { points, boundaries } = flattenLegsWithBoundaries(JOINED);
    expect(points).toEqual([p(0, 0), p(0, 1), p(0, 2), p(1, 2), p(2, 2), p(2, 3)]);
    expect(boundaries).toEqual([0, 2, 4, 5]);
    expect(checkBoundaries(points.length, boundaries, 4)).toBe(true);
  });

  it('keeps both vertices where legs do not meet, giving the step to the later leg', () => {
    const { points, boundaries } = flattenLegsWithBoundaries([
      { shape: [p(0, 0), p(0, 1)] },
      { shape: [p(0, 1.5), p(0, 2)] },
    ]);
    expect(points).toEqual([p(0, 0), p(0, 1), p(0, 1.5), p(0, 2)]);
    expect(boundaries).toEqual([0, 1, 3]);
    // The later leg includes the step from its predecessor's end.
    expect(legShapes(points, boundaries)[1]).toEqual([p(0, 1), p(0, 1.5), p(0, 2)]);
  });

  it('round-trips: flattening the extracted legs gives back the same shape', () => {
    const flat = flattenLegsWithBoundaries(JOINED);
    const again = flattenLegsWithBoundaries(
      legShapes(flat.points, flat.boundaries).map((shape) => ({ shape })),
    );
    expect(again).toEqual(flat);
  });
});

describe('checkBoundaries', () => {
  it('rejects every way a boundary list can be wrong', () => {
    expect(checkBoundaries(6, [0, 2, 4, 5], 4)).toBe(true);
    expect(checkBoundaries(6, [0, 2, 4], 4)).toBe(false); // wrong count
    expect(checkBoundaries(6, [1, 2, 4, 5], 4)).toBe(false); // not starting at 0
    expect(checkBoundaries(6, [0, 2, 4, 4], 4)).toBe(false); // not ending at last
    expect(checkBoundaries(6, [0, 4, 2, 5], 4)).toBe(false); // decreasing
    expect(checkBoundaries(6, [0, null, 4, 5], 4)).toBe(false); // unknown
    expect(checkBoundaries(6, [0, 2.5, 4, 5], 4)).toBe(false); // not an index
  });
});

describe('legOfSegment', () => {
  it('maps a clicked segment to its leg', () => {
    const boundaries = [0, 2, 4, 5];
    expect(legOfSegment(boundaries, 1)).toBe(0);
    expect(legOfSegment(boundaries, 2)).toBe(0);
    expect(legOfSegment(boundaries, 3)).toBe(1);
    expect(legOfSegment(boundaries, 5)).toBe(2);
  });
});

describe('spliceLegs', () => {
  const flat = flattenLegsWithBoundaries(JOINED);

  it('replaces a middle leg and leaves the others point for point', () => {
    const result = spliceLegs(flat.points, flat.boundaries, 1, 2, [
      { shape: [p(0, 2), p(0.5, 2.5)] },
      { shape: [p(0.5, 2.5), p(2, 2)] },
    ]);
    const legs = legShapes(result.points, result.boundaries);
    expect(legs[0]).toEqual(JOINED[0]?.shape);
    expect(legs[3]).toEqual(JOINED[2]?.shape);
    expect(result.boundaries).toHaveLength(5);
    expect(checkBoundaries(result.points.length, result.boundaries, 5)).toBe(true);
  });

  it('replaces the first and the last legs', () => {
    const first = spliceLegs(flat.points, flat.boundaries, 0, 1, [
      { shape: [p(-1, 0), p(0, 2)] },
    ]);
    expect(first.points[0]).toEqual(p(-1, 0));
    expect(legShapes(first.points, first.boundaries).slice(1)).toEqual(
      legShapes(flat.points, flat.boundaries).slice(1),
    );

    const last = spliceLegs(flat.points, flat.boundaries, 2, 3, [
      { shape: [p(2, 2), p(3, 3)] },
    ]);
    expect(last.points.at(-1)).toEqual(p(3, 3));
    expect(legShapes(last.points, last.boundaries).slice(0, 2)).toEqual(
      legShapes(flat.points, flat.boundaries).slice(0, 2),
    );
  });

  it('drops the leading or trailing leg when the replacement is empty', () => {
    const noStart = spliceLegs(flat.points, flat.boundaries, 0, 1, []);
    expect(noStart.points[0]).toEqual(p(0, 2));
    expect(noStart.boundaries).toEqual([0, 2, 3]);

    const noEnd = spliceLegs(flat.points, flat.boundaries, 2, 3, []);
    expect(noEnd.points.at(-1)).toEqual(p(2, 2));
    expect(noEnd.boundaries).toEqual([0, 2, 4]);
  });

  it('refuses to leave a gap in the middle or to remove every leg', () => {
    expect(() => spliceLegs(flat.points, flat.boundaries, 1, 2, [])).toThrow(RangeError);
    expect(() => spliceLegs(flat.points, flat.boundaries, 0, 3, [])).toThrow(RangeError);
  });

  it('keeps a genuine step at a seam rather than smoothing it away', () => {
    const result = spliceLegs(flat.points, flat.boundaries, 1, 2, [
      { shape: [p(0, 2.1), p(2, 2)] }, // starts 0.1° from the old join
    ]);
    expect(result.points).toContainEqual(p(0, 2));
    expect(result.points).toContainEqual(p(0, 2.1));
  });

  /**
   * The property the whole phase rests on: splicing is exactly re-flattening.
   *
   * Random legs, with roughly half the joins exact and half stepped, random
   * replacement ranges and random replacements. The splice must equal
   * flattening the kept legs around the replacement — points and boundaries,
   * exactly.
   */
  it('is exactly equivalent to re-flattening, over random routes', () => {
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const randomLeg = (start: LatLon): LatLon[] => {
      const out = [random() < 0.5 ? start : p(start.lat + 0.001, start.lon)];
      const count = 1 + Math.floor(random() * 5);
      for (let i = 0; i < count; i += 1) {
        const last = out.at(-1) as LatLon;
        out.push(p(last.lat + random() * 0.01, last.lon + random() * 0.01));
      }
      return out;
    };
    const randomLegs = (count: number, start: LatLon): { shape: LatLon[] }[] => {
      const legs: { shape: LatLon[] }[] = [];
      let at = start;
      for (let i = 0; i < count; i += 1) {
        const shape = randomLeg(at);
        legs.push({ shape });
        at = shape.at(-1) as LatLon;
      }
      return legs;
    };

    for (let trial = 0; trial < 300; trial += 1) {
      const legs = randomLegs(1 + Math.floor(random() * 6), p(53, -2));
      const original = flattenLegsWithBoundaries(legs);
      const kept = legShapes(original.points, original.boundaries).map((shape) => ({ shape }));

      const from = Math.floor(random() * legs.length);
      const to = from + 1 + Math.floor(random() * (legs.length - from));
      const startAt = from === 0 ? p(53, -2) : (kept[from - 1]?.shape.at(-1) as LatLon);
      const replacement = randomLegs(1 + Math.floor(random() * 3), startAt);

      const spliced = spliceLegs(original.points, original.boundaries, from, to, replacement);
      const direct = flattenLegsWithBoundaries([
        ...kept.slice(0, from),
        ...replacement,
        ...kept.slice(to),
      ]);

      expect(spliced).toEqual(direct);
      expect(
        checkBoundaries(spliced.points.length, spliced.boundaries, spliced.boundaries.length),
      ).toBe(true);
    }
  });
});
