import { describe, expect, it } from 'vitest';
import { TOWNS } from '@fixtures/places';
import { createZoneResolver, resolveTimeZone, ZONE_POLYGONS } from './timeZones';
import { isValidZone } from './zoned';

/**
 * The places that decide a stop's zone. Coordinates are the same ones the UK
 * boundary tests use, so the two stay in step.
 */
describe('resolveTimeZone', () => {
  it.each([
    ['Buxton', TOWNS.buxton.lat, TOWNS.buxton.lon],
    ['Ashbourne', TOWNS.ashbourne.lat, TOWNS.ashbourne.lon],
    ['Belfast', 54.597, -5.93],
    ['Lerwick, Shetland', 60.155, -1.145],
  ])('puts %s in Europe/London', (_name, lat, lon) => {
    expect(resolveTimeZone({ lat, lon })).toBe('Europe/London');
  });

  it.each([
    ['Dublin', 53.35, -6.26],
    ['Douglas, Isle of Man', 54.15, -4.48],
    ['St Helier, Jersey', 49.19, -2.11],
    ['Calais', 50.95, 1.85],
  ])('does not know %s, rather than guessing London', (_name, lat, lon) => {
    expect(resolveTimeZone({ lat, lon })).toBeNull();
  });

  it('only names zones the runtime knows', () => {
    for (const entry of ZONE_POLYGONS) expect(isValidZone(entry.zone)).toBe(true);
  });

  it('checks the table in order, so a nested polygon can override', () => {
    const resolve = createZoneResolver([
      {
        zone: 'Europe/Dublin',
        rings: [
          [
            [-2, 53],
            [-1.8, 53],
            [-1.8, 53.4],
            [-2, 53.4],
            [-2, 53],
          ],
        ],
        source: 'test',
      },
      ...ZONE_POLYGONS,
    ]);
    expect(resolve(TOWNS.buxton)).toBe('Europe/Dublin');
    expect(resolve(TOWNS.ashbourne)).toBe('Europe/London');
  });
});
