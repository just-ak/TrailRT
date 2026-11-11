import { describe, expect, it } from 'vitest';
import type { BoundingBox } from '@shared/geo/polygon';
import {
  BUXTON_VIEWPORT,
  LOOP_VIEWPORT,
  PEAK_DISTRICT_VIEWPORT,
  TOWNS,
} from '@fixtures/places';
import {
  downloadIndex,
  parseIndex,
  rankRegions,
  regionSize,
  findRegion,
} from './geofabrik';

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
 *
 * ## The Buxton loop is the interesting case, not a convenient one
 *
 * Geofabrik publishes England by **county**, and the four corners of the test
 * loop fall in three of them:
 *
 *   Buxton        Derbyshire
 *   Macclesfield  Cheshire
 *   Leek          Staffordshire
 *   Ashbourne     Derbyshire
 *
 * So no county extract covers the square. That is precisely the situation
 * `rankRegions` was designed around and the reason `coversViewport` is
 * *reported* rather than used as a filter: ranking by "smallest region that
 * fully contains the view" would offer `england` for a view of one town, while
 * ranking by the centre and labelling coverage lets the user choose. Both
 * halves of that are asserted below against live data.
 */

const live = process.env.TRAILRT_LIVE_GEOFABRIK === '1';

/** A tight box around one point, as zooming in on a town produces. */
const around = (place: { lat: number; lon: number }): BoundingBox => ({
  minLat: place.lat - 0.01,
  maxLat: place.lat + 0.01,
  minLon: place.lon - 0.01,
  maxLon: place.lon + 0.01,
});

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

  it('picks the county for a town-sized view of Buxton', async () => {
    const regions = parseIndex(await downloadIndex());
    const ranked = rankRegions(regions, BUXTON_VIEWPORT);

    expect(ranked[0]?.id).toBe('derbyshire');
    // A whole county comfortably contains a view of one town, so this one is
    // both most specific *and* covering. The unambiguous case.
    expect(ranked[0]?.coversViewport).toBe(true);
    // The larger options stay in the list for a user who wants more road.
    expect(ranked.map((r) => r.id)).toContain('england');
    expect(ranked.map((r) => r.id)).toContain('great-britain');
  }, 120_000);

  /**
   * Each corner resolves to its own county, which is what makes the loop a
   * three-county square rather than a claim in a comment.
   */
  it('places each corner of the loop in its real county', async () => {
    const regions = parseIndex(await downloadIndex());
    const top = (place: { lat: number; lon: number }) =>
      rankRegions(regions, around(place))[0]?.id;

    expect(top(TOWNS.buxton)).toBe('derbyshire');
    expect(top(TOWNS.macclesfield)).toBe('cheshire');
    expect(top(TOWNS.leek)).toBe('staffordshire');
    expect(top(TOWNS.ashbourne)).toBe('derbyshire');
  }, 120_000);

  /**
   * The case the design exists for.
   *
   * The whole square spans three counties, so the region at its centre cannot
   * cover it. The honest answer is to rank that region first anyway and say it
   * does not cover the view, while keeping the one that does in the list.
   */
  it('reports that no county covers the whole square, and offers one that does', async () => {
    const regions = parseIndex(await downloadIndex());
    const ranked = rankRegions(regions, LOOP_VIEWPORT);

    const first = ranked[0];
    expect(first).toBeDefined();
    // The loop's centre lands in Staffordshire, between Buxton and Leek.
    expect(first?.id).toBe('staffordshire');
    // Not covering — stated, not hidden.
    expect(first?.coversViewport).toBe(false);

    // And something that does cover it is still on offer, so the user is not
    // left with only an option that would leave them unable to route the
    // western half of their own ride.
    const covering = ranked.find((r) => r.coversViewport);
    expect(covering?.id).toBe('england');

    console.info(
      `[live] loop view: ${ranked.map((r) => `${r.id}${r.coversViewport ? ' (covers)' : ''}`).join(' > ')}`,
    );
  }, 120_000);

  it('resolves a regional view of the Peak District to a county', async () => {
    const regions = parseIndex(await downloadIndex());
    const ranked = rankRegions(regions, PEAK_DISTRICT_VIEWPORT);

    expect(ranked[0]?.id).toBe('derbyshire');
    expect(ranked.find((r) => r.coversViewport)?.id).toBe('england');
  }, 120_000);

  /*
   * `-latest.osm.pbf` is a 307 to a dated filename, so a size is only
   * obtainable by following that redirect. If this breaks, the picker silently
   * stops showing download sizes — which is the one number a user needs before
   * committing to a multi-hundred-megabyte download.
   */
  it('reports a download size through the dated-file redirect', async () => {
    const regions = parseIndex(await downloadIndex());
    const size = await regionSize(findRegion(regions, 'derbyshire').pbfUrl);

    expect(size).not.toBeNull();
    // Tens of megabytes for an English county. Generous bounds: it grows with
    // OSM, but a county is not a gigabyte.
    expect(size ?? 0).toBeGreaterThan(1_000_000);
    expect(size ?? 0).toBeLessThan(500_000_000);

    console.info(
      `[live] derbyshire extract is ${((size ?? 0) / 1e6).toFixed(1)} MB`,
    );
  }, 120_000);
});
