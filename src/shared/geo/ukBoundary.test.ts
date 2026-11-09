import { describe, expect, it } from 'vitest';
import { TOWNS } from '@fixtures/places';
import { inUk } from './ukBoundary';

/**
 * The places that decide whether UK speed-limit law applies.
 *
 * The interesting cases are the ones a bounding box gets wrong: the Republic
 * of Ireland shares an island with Northern Ireland, and the Isle of Man and
 * the Channel Islands sit inside any box round Great Britain but make their
 * own law.
 */
describe('inUk', () => {
  it.each([
    ['Buxton', TOWNS.buxton.lat, TOWNS.buxton.lon],
    ['Macclesfield', TOWNS.macclesfield.lat, TOWNS.macclesfield.lon],
    ['Belfast', 54.597, -5.93],
    ['Enniskillen', 54.344, -7.639],
    ['Lerwick, Shetland', 60.155, -1.145],
    ['Penzance', 50.118, -5.537],
  ])('places %s inside', (_name, lat, lon) => {
    expect(inUk({ lat, lon })).toBe(true);
  });

  it.each([
    ['Dublin', 53.35, -6.26],
    ['Dundalk', 54.0, -6.4],
    ['Letterkenny', 54.95, -7.73],
    ['Douglas, Isle of Man', 54.15, -4.48],
    ['St Helier, Jersey', 49.19, -2.11],
    ['Calais', 50.95, 1.85],
  ])('places %s outside', (_name, lat, lon) => {
    expect(inUk({ lat, lon })).toBe(false);
  });
});
