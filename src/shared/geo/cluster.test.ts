import { describe, expect, it } from 'vitest';
import { A515_TRACE, BUXTON, LEEK } from '@fixtures/places';
import { clusterPoints, toPixels } from './cluster';

describe('clusterPoints', () => {
  const points = A515_TRACE.map((p, i) => ({ lat: p.lat, lon: p.lon, id: i }));

  it('groups points that would overlap on screen, and separates them as you zoom in', () => {
    const far = clusterPoints(points, 8);
    // Vertices 0 and 1 are 49 m apart, which still shares a cell at zoom 15.
    const near = clusterPoints(points, 18);
    expect(far.length).toBeLessThan(near.length);
    expect(near.length).toBe(points.length);
    expect(far.flatMap((c) => c.members).length).toBe(points.length);
  });

  it('puts a cluster at the middle of its members', () => {
    const [only] = clusterPoints([BUXTON, LEEK], 1);
    expect(only?.members).toHaveLength(2);
    expect(only?.lat).toBeCloseTo((BUXTON.lat + LEEK.lat) / 2, 9);
  });

  it('projects to Web Mercator pixels', () => {
    expect(toPixels({ lat: 0, lon: 0 }, 0)).toEqual({ x: 128, y: 128 });
    expect(clusterPoints([], 10)).toEqual([]);
  });
});
