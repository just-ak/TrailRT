import { describe, expect, it } from 'vitest';
import type { BoundingBox } from '@shared/geo/polygon';
import { downloadIndex, parseIndex, rankRegions, regionSize, findRegion } from './geofabrik';

/**
 * Region matching against the **real** Geofabrik index.
 *
 * Skipped unless `TRAILRT_LIVE_GEOFABRIK=1`, so the default suite stays
 * offline. `geofabrik.test.ts` covers the ranking logic against hand-built
 * geometry; what this adds is confidence that the real index still parses and
 * that the real polygons still rank the way the design assumes.
 *
 *   TRAILRT_LIVE_GEOFABRIK=1 npx vitest run src/main/routing/geofabrik.live.test.ts
 *
 * Worth having because the assumptions here are about someone else's data:
 * that `index-v1.json` carries MultiPolygon geometry and a `pbf` URL per
 * region, that regions nest, and that `-latest.osm.pbf` answers a HEAD with a
 * size after one same-origin redirect. Any of those could change upstream
 * without warning.
 */

const live = process.env.TRAILRT_LIVE_GEOFABRIK === '1';

const box = (
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
): BoundingBox => ({ minLat, minLon, maxLat, maxLon });

describe.runIf(live)('Geofabrik index, live', () => {
  it('parses the published index', async () => {
    const regions = parseIndex(await downloadIndex());

    // 554 at the time of writing; asserting a floor rather than the number
    // keeps this from failing every time Geofabrik adds a region.
    expect(regions.length).toBeGreaterThan(400);
    expect(regions.every((r) => r.pbfUrl.startsWith('https://'))).toBe(true);
    expect(regions.every((r) => r.rings.length > 0)).toBe(true);
    // Nesting is what makes "most specific first" meaningful.
    expect(regions.some((r) => r.parent !== null)).toBe(true);
  }, 120_000);

  it('picks real regions for real viewports', async () => {
    const regions = parseIndex(await downloadIndex());

    const pick = (b: BoundingBox) => rankRegions(regions, b).map((r) => r.id);

    // A small country, viewed close in. This is the case that exposed
    // centre-based ranking: by full coverage it would pick `alps`.
    expect(pick(box(47.12, 9.5, 47.16, 9.54))[0]).toBe('liechtenstein');

    // A regional view inside one country.
    expect(pick(box(46.4, 7.5, 47.0, 8.5))[0]).toBe('switzerland');

    // Geofabrik publishes sub-country regions, and the most specific wins.
    expect(pick(box(51.4, -0.3, 51.6, 0.05))[0]).toBe('greater-london');

    // A continent-scale view still resolves, to the continent.
    expect(pick(box(40, -5, 55, 20))).toContain('europe');
  }, 120_000);

  /*
   * `-latest.osm.pbf` is a 307 to a dated filename, so a size is only
   * obtainable by following that redirect. If this breaks, the picker silently
   * stops showing download sizes — which is the one number a user needs before
   * committing to a multi-hundred-megabyte download.
   */
  it('reports a download size through the dated-file redirect', async () => {
    const regions = parseIndex(await downloadIndex());
    const size = await regionSize(findRegion(regions, 'liechtenstein').pbfUrl);

    expect(size).not.toBeNull();
    // A few MB. Generous bounds: it grows with OSM, but not to a gigabyte.
    expect(size ?? 0).toBeGreaterThan(1_000_000);
    expect(size ?? 0).toBeLessThan(100_000_000);
  }, 120_000);
});
