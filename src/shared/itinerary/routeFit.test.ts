import { describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import { ROUTE_FIT_M, routeFit } from './routeFit';

/** Phase 14 task 11: a route replaces a drive only when its ends are at the stops. */

const near = (at: { lat: number; lon: number }, metresNorth: number) => ({ lat: at.lat + metresNorth / 111_320, lon: at.lon });

describe('whether a route joins two stops', () => {
  it('fits when both ends are within a kilometre of the stops beside them', () => {
    const fit = routeFit({ start: near(BUXTON, 200), end: near(LEEK, 400) }, BUXTON, LEEK);
    expect(fit.fits).toBe(true);
    expect(fit.startM).toBeCloseTo(200, -1);
    expect(fit.endM).toBeCloseTo(400, -1);
  });

  it('does not fit when either end is further, or there is no stop on one side', () => {
    expect(routeFit({ start: near(BUXTON, ROUTE_FIT_M + 50), end: LEEK }, BUXTON, LEEK).fits).toBe(false);
    expect(routeFit({ start: BUXTON, end: ASHBOURNE }, BUXTON, LEEK).fits).toBe(false);
    expect(routeFit({ start: BUXTON, end: LEEK }, null, LEEK)).toEqual({ startM: null, endM: 0, fits: false });
  });
});
