import { describe, expect, it } from 'vitest';
import {
  distanceForIndex,
  indexForDistance,
  selectionRanges,
} from './profilePoints';

/** Every point sampled: index i at i × 100 m. */
const FULL = Array.from({ length: 11 }, (_, i) => ({ index: i, distanceM: i * 100 }));

/** Thinned: every tenth point of a 101-point line, 10 m apart. */
const THINNED = Array.from({ length: 11 }, (_, i) => ({
  index: i * 10,
  distanceM: i * 100,
}));

describe('distanceForIndex', () => {
  it('reads a sampled point exactly', () => {
    expect(distanceForIndex(FULL, 0)).toBe(0);
    expect(distanceForIndex(FULL, 7)).toBe(700);
    expect(distanceForIndex(FULL, 10)).toBe(1000);
  });

  it('interpolates a point that was thinned out', () => {
    expect(distanceForIndex(THINNED, 15)).toBe(150);
    expect(distanceForIndex(THINNED, 99)).toBe(990);
  });

  it('clamps an index outside the profile to its ends', () => {
    expect(distanceForIndex(FULL, -3)).toBe(0);
    expect(distanceForIndex(FULL, 500)).toBe(1000);
  });

  it('returns null when there is nothing to read', () => {
    expect(distanceForIndex([], 3)).toBeNull();
  });
});

describe('indexForDistance', () => {
  it('finds the nearest point', () => {
    expect(indexForDistance(FULL, 0)).toBe(0);
    expect(indexForDistance(FULL, 340)).toBe(3);
    expect(indexForDistance(FULL, 360)).toBe(4);
  });

  it('resolves to a source index between thinned samples', () => {
    expect(indexForDistance(THINNED, 150)).toBe(15);
    expect(indexForDistance(THINNED, 1000)).toBe(100);
  });

  it('round-trips with distanceForIndex', () => {
    for (const index of [0, 13, 57, 100]) {
      const distance = distanceForIndex(THINNED, index);
      expect(indexForDistance(THINNED, distance ?? -1)).toBe(index);
    }
  });

  it('copes with a repeated distance (two points in one place)', () => {
    const stacked = [
      { index: 0, distanceM: 0 },
      { index: 1, distanceM: 50 },
      { index: 2, distanceM: 50 },
      { index: 3, distanceM: 100 },
    ];
    expect(indexForDistance(stacked, 50)).not.toBeNull();
  });

  it('returns null when there is nothing to read', () => {
    expect(indexForDistance([], 3)).toBeNull();
  });
});

describe('selectionRanges', () => {
  it('turns one run of consecutive points into one range', () => {
    expect(selectionRanges(FULL, [2, 3, 4, 5])).toEqual([
      { startM: 200, endM: 500 },
    ]);
  });

  it('splits separate runs, in order, whatever order they were given in', () => {
    expect(selectionRanges(FULL, [8, 1, 2, 9])).toEqual([
      { startM: 100, endM: 200 },
      { startM: 800, endM: 900 },
    ]);
  });

  it('gives a single point a zero-width range for the chart to widen', () => {
    expect(selectionRanges(FULL, [6])).toEqual([{ startM: 600, endM: 600 }]);
  });

  it('ignores duplicates', () => {
    expect(selectionRanges(FULL, [3, 3, 4])).toEqual([
      { startM: 300, endM: 400 },
    ]);
  });

  it('is empty with no selection or no samples', () => {
    expect(selectionRanges(FULL, [])).toEqual([]);
    expect(selectionRanges([], [1])).toEqual([]);
  });
});
