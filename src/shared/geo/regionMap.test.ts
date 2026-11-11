import { describe, expect, it } from 'vitest';
import { BUXTON, LEEK } from '@fixtures/places';
import { ENGLAND_WALES_VIEW, projection, projectRegions, UK_VIEW } from './regionMap';

describe('projection', () => {
  const project = projection(UK_VIEW, 400, 600);

  it('puts north at the top and east to the right', () => {
    const [bx, by] = project(BUXTON.lon, BUXTON.lat);
    const [lx, ly] = project(LEEK.lon, LEEK.lat);
    // Leek is south and a little west of Buxton.
    expect(ly).toBeGreaterThan(by);
    expect(lx).toBeLessThan(bx);
  });

  it('keeps the whole view inside the box', () => {
    for (const [lon, lat] of [
      [UK_VIEW.minLon, UK_VIEW.minLat],
      [UK_VIEW.maxLon, UK_VIEW.maxLat],
    ] as const) {
      const [x, y] = project(lon, lat);
      expect(x).toBeGreaterThanOrEqual(-0.001);
      expect(x).toBeLessThanOrEqual(400.001);
      expect(y).toBeGreaterThanOrEqual(-0.001);
      expect(y).toBeLessThanOrEqual(600.001);
    }
  });

  it('draws England larger in the England and Wales view', () => {
    const whole = projection(UK_VIEW, 400, 600);
    const close = projection(ENGLAND_WALES_VIEW, 400, 600);
    const span = (p: typeof whole) => p(-1, 53)[0] - p(-2, 53)[0];
    expect(span(close)).toBeGreaterThan(span(whole) * 1.3);
  });
});

describe('projectRegions', () => {
  it('produces one closed path per ring and a label inside the box', () => {
    const [region] = projectRegions(
      [
        {
          id: 'derbyshire',
          rings: [
            [
              [-2.0, 52.7],
              [-1.2, 52.7],
              [-1.2, 53.5],
              [-2.0, 53.5],
            ],
          ],
        },
      ],
      UK_VIEW,
      400,
      600,
    );
    expect(region?.d.startsWith('M')).toBe(true);
    expect(region?.d.endsWith('Z')).toBe(true);
    expect(region?.d.match(/L/g)).toHaveLength(3);
    const project = projection(UK_VIEW, 400, 600);
    const [x, y] = project(-1.6, 53.1);
    expect(region?.labelX).toBeCloseTo(x, 0);
    expect(region?.labelY).toBeCloseTo(y, 0);
  });
});
