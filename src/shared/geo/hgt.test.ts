import { describe, expect, it } from 'vitest';
import {
  gainLoss,
  HGT_VOID,
  hgtSize,
  sampleHgt,
  tileNameFor,
  tileOrigin,
  tilesCovering,
  tilesFor,
} from './hgt';

/** A synthetic tile whose height is a function of row and column. */
function grid(size: number, height: (x: number, y: number) => number): DataView {
  const view = new DataView(new ArrayBuffer(size * size * 2));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) view.setInt16((y * size + x) * 2, height(x, y), false);
  }
  return view;
}

describe('tile naming', () => {
  it('names a tile by its south-west corner in every hemisphere', () => {
    expect(tileNameFor(53.2588, -1.911)).toBe('N53W002'); // Buxton
    expect(tileNameFor(48.85, 2.35)).toBe('N48E002');
    expect(tileNameFor(-33.87, 151.21)).toBe('S34E151');
    expect(tileNameFor(-0.5, -78.5)).toBe('S01W079');
    expect(tileNameFor(0, 0)).toBe('N00E000');
  });

  it('round-trips a name to its origin, and rejects nonsense', () => {
    expect(tileOrigin('N53W002')).toEqual({ lat: 53, lon: -2 });
    expect(tileOrigin('S34E151')).toEqual({ lat: -34, lon: 151 });
    expect(tileOrigin('../../etc')).toBeNull();
    expect(tileOrigin('N95E000')).toBeNull();
  });

  it('lists every tile a box touches', () => {
    expect(
      tilesCovering({ minLat: 52.9, minLon: -2.2, maxLat: 53.3, maxLon: -1.7 }).toSorted(),
    ).toEqual(['N52W002', 'N52W003', 'N53W002', 'N53W003']);
  });

  it('deduplicates the tiles a line needs', () => {
    expect(
      tilesFor([
        { lat: 53.1, lon: -1.9 },
        { lat: 53.2, lon: -1.8 },
        { lat: 52.9, lon: -1.8 },
      ]),
    ).toEqual(['N53W002', 'N52W002']);
  });
});

describe('hgtSize', () => {
  it('accepts exactly the two published grid sizes', () => {
    expect(hgtSize(3601 * 3601 * 2)).toBe(3601);
    expect(hgtSize(1201 * 1201 * 2)).toBe(1201);
    expect(hgtSize(3601 * 3601 * 2 - 2)).toBeNull(); // truncated download
    expect(hgtSize(0)).toBeNull();
  });
});

describe('sampleHgt', () => {
  const size = 11; // a tenth of a degree per cell keeps the arithmetic readable
  const origin = { lat: 53, lon: -2 };

  it('reads a grid point exactly, top row being the north edge', () => {
    const view = grid(size, (x, y) => x * 10 + y);
    // North-west corner is row 0, column 0.
    expect(sampleHgt(view, size, origin, { lat: 54, lon: -2 })).toBe(0);
    // South-east corner is the last row and column.
    expect(sampleHgt(view, size, origin, { lat: 53, lon: -1 })).toBe(110);
  });

  it('interpolates bilinearly between samples', () => {
    const view = grid(size, (x) => x * 100);
    // Halfway between columns 2 and 3.
    expect(sampleHgt(view, size, origin, { lat: 53.5, lon: -2 + 0.25 })).toBeCloseTo(250, 6);
  });

  it('returns null next to a void, not a crater', () => {
    const view = grid(size, (x, y) => (x === 5 && y === 5 ? HGT_VOID : 200));
    expect(sampleHgt(view, size, origin, { lat: 53.48, lon: -1.52 })).toBeNull();
    expect(sampleHgt(view, size, origin, { lat: 53.2, lon: -1.8 })).toBe(200);
  });

  it('returns null outside the tile', () => {
    const view = grid(size, () => 1);
    expect(sampleHgt(view, size, origin, { lat: 54.01, lon: -1.5 })).toBeNull();
    expect(sampleHgt(view, size, origin, { lat: 53.5, lon: -2.01 })).toBeNull();
  });
});

describe('gainLoss', () => {
  it('ignores noise below the threshold', () => {
    // A flat road through a noisy model: a 2.8 m swing, forever. Without the
    // threshold this would be 280 m of imaginary climbing.
    const noisy = Array.from({ length: 200 }, (_, i) => 300 + (i % 2 === 0 ? 1.4 : -1.4));
    expect(gainLoss(noisy, 3)).toEqual({ gainM: 0, lossM: 0 });
  });

  it('counts a real climb and descent in full', () => {
    const hill = [100, 110, 130, 160, 150, 120, 100];
    expect(gainLoss(hill, 3)).toEqual({ gainM: 60, lossM: 60 });
  });

  it('skips gaps and is null with no heights at all', () => {
    expect(gainLoss([100, null, 120], 3)).toEqual({ gainM: 20, lossM: 0 });
    expect(gainLoss([null, null], 3)).toBeNull();
  });
});
