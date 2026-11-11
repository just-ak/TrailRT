import { describe, expect, it } from 'vitest';
import { haversineDistance } from './distance';
import { gridToOsgb36, gridToWgs84 } from './osgb';

const dms = (d: number, m: number, s: number): number => d + m / 60 + s / 3600;

describe('gridToOsgb36', () => {
  it('reproduces the worked example in the OS coordinate guide (Annex C)', () => {
    // E 651409.903, N 313177.270 → 52°39′27.2531″N, 1°43′04.5177″E on OSGB36.
    const point = gridToOsgb36(651_409.903, 313_177.27);
    expect(point.lat).toBeCloseTo(dms(52, 39, 27.2531), 7);
    expect(point.lon).toBeCloseTo(dms(1, 43, 4.5177), 7);
  });

  it('puts the true origin of the grid at 49°N 2°W', () => {
    const origin = gridToOsgb36(400_000, -100_000);
    expect(origin.lat).toBeCloseTo(49, 9);
    expect(origin.lon).toBeCloseTo(-2, 9);
  });
});

/**
 * Postcode centres from the 2026-11 Code-Point Open release, checked against
 * the WGS84 positions postcodes.io publishes for the same eastings and
 * northings (which it converts with OSTN15). The Helmert transform is quoted
 * by OS at about 5 m; 10 m is the bound the design accepts.
 */
describe('gridToWgs84', () => {
  it.each([
    ['SK17 6AA, Buxton', 406_186, 373_619, 53.259555, -1.908727],
    ['SK17 6BJ, Buxton', 406_031, 373_605, 53.259431, -1.911051],
    ['DE6 1AA, Ashbourne', 417_868, 346_437, 53.01496, -1.735113],
    ['TR18 2AA, Penzance', 147_132, 30_551, 50.121037, -5.538954],
    ['KW1 4AA, Wick', 336_230, 951_308, 58.445375, -3.094157],
  ])('places %s within 10 m', (_name, easting, northing, lat, lon) => {
    const point = gridToWgs84(easting, northing);
    expect(haversineDistance(point, { lat, lon })).toBeLessThan(10);
  });
});
