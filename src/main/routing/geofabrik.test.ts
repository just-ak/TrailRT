import { describe, expect, it } from 'vitest';
import type { BoundingBox } from '@shared/geo/polygon';
import {
  findRegion,
  joinRegionNames,
  parseIndex,
  rankRegions,
  ukRegions,
} from './geofabrik';
import { ServiceError } from '../services/errors';

/**
 * Matching a viewport to a downloadable extract.
 *
 * Uses a hand-built index rather than the real 3.6 MB one: the shapes here are
 * deliberately arranged to reproduce the cases that broke the first attempt,
 * which a real-world fixture would only do by luck. Geometry is simple boxes,
 * which is enough because the ranking is about containment and relative size.
 */

/** A square region, as the real index would express it. */
const square = (
  id: string,
  parent: string | null,
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
) => ({
  type: 'Feature',
  properties: {
    id,
    name: id,
    ...(parent === null ? {} : { parent }),
    urls: { pbf: `https://download.geofabrik.de/${id}-latest.osm.pbf` },
  },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    ],
  },
});

/*
 * Nested like the real index: a continent, a bundle spanning two countries, two
 * countries, and a city inside one of them.
 *
 *   continent   0..40 lon, 0..40 lat
 *   bundle     10..30 lon, 10..30 lat
 *   alpha      10..20 lon, 10..20 lat
 *   beta       20..30 lon, 10..20 lat
 *   citadel    14..16 lon, 14..16 lat   (inside alpha)
 */
const INDEX = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    square('continent', null, 0, 0, 40, 40),
    square('bundle', 'continent', 10, 10, 30, 30),
    square('alpha', 'continent', 10, 10, 20, 20),
    square('beta', 'continent', 20, 10, 30, 20),
    square('citadel', 'alpha', 14, 14, 16, 16),
  ],
});

const box = (
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
): BoundingBox => ({ minLon, minLat, maxLon, maxLat });

describe('parseIndex', () => {
  it('reads regions with geometry and a pbf url', () => {
    const regions = parseIndex(INDEX);

    expect(regions).toHaveLength(5);
    const alpha = regions.find((r) => r.id === 'alpha');
    expect(alpha?.parent).toBe('continent');
    expect(alpha?.pbfUrl).toMatch(/alpha-latest\.osm\.pbf$/);
    expect(alpha?.area).toBeCloseTo(100, 5);
  });

  /*
   * The index legitimately contains entries we cannot use. Failing the whole
   * parse over one would make the feature brittle against an upstream
   * addition that has nothing to do with us.
   */
  it('skips unusable entries instead of failing', () => {
    const withJunk = JSON.stringify({
      features: [
        { properties: { id: 'no-geometry', urls: { pbf: 'https://x/y.pbf' } } },
        { properties: { id: 'no-url' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        JSON.parse(JSON.stringify(square('usable', null, 0, 0, 1, 1))),
      ],
    });

    const regions = parseIndex(withJunk);

    expect(regions.map((r) => r.id)).toEqual(['usable']);
  });

  it('refuses an index with nothing usable rather than returning empty', () => {
    expect(() => parseIndex(JSON.stringify({ features: [] }))).toThrow(
      ServiceError,
    );
  });

  it('reports unreadable JSON as a provider error', () => {
    expect(() => parseIndex('{ truncated')).toThrow(/could not be read/i);
  });
});

describe('rankRegions', () => {
  const regions = parseIndex(INDEX);

  it('puts the most specific region first', () => {
    // A view sitting squarely inside the city.
    const ranked = rankRegions(regions, box(14.4, 14.4, 15.6, 15.6));

    expect(ranked.map((r) => r.id)).toEqual([
      'citadel',
      'alpha',
      'bundle',
      'continent',
    ]);
    expect(ranked[0]?.coversViewport).toBe(true);
  });

  /*
   * The case that broke the first attempt.
   *
   * Ranking by "smallest region that fully contains the view" picks `bundle`
   * here, because the viewport spills over the city's edge — so a user zoomed
   * to a small country is offered a multi-country bundle instead. Ranking by
   * the centre gives the city, with the larger options still listed.
   */
  it('prefers the specific region even when the view spills over its edge', () => {
    // Centred on the city but wider than it.
    const ranked = rankRegions(regions, box(13, 13, 17, 17));

    expect(ranked[0]?.id).toBe('citadel');
    expect(ranked[0]?.coversViewport).toBe(false);
    // The option that does cover the view is still offered, just not first.
    expect(ranked.find((r) => r.coversViewport)?.id).toBe('alpha');
  });

  /*
   * A view spanning a border. Neither country covers it, and the honest answer
   * is to offer both the country at the centre and the bundle that spans them,
   * labelled so the user can choose.
   */
  it('labels coverage for a view spanning two regions', () => {
    // Centre lands in beta, but the view reaches well into alpha.
    const ranked = rankRegions(regions, box(18, 14, 24, 16));

    expect(ranked[0]?.id).toBe('beta');
    expect(ranked[0]?.coversViewport).toBe(false);
    expect(ranked.find((r) => r.coversViewport)?.id).toBe('bundle');
  });

  it('returns nothing when the centre is outside every region', () => {
    // Open ocean, well away from the continent.
    expect(rankRegions(regions, box(60, 60, 61, 61))).toEqual([]);
  });

  it('leaves sizes unset for the caller to fill in', () => {
    const ranked = rankRegions(regions, box(14.4, 14.4, 15.6, 15.6));

    // Sizes need a network round trip per region, which is the caller's job —
    // and so is deciding which are too large, since that depends on the size.
    expect(ranked.every((r) => r.sizeBytes === null)).toBe(true);
    expect(ranked.every((r) => !r.tooLarge)).toBe(true);
  });

  it('caps the list so the picker stays readable', () => {
    const ranked = rankRegions(regions, box(14.4, 14.4, 15.6, 15.6), 2);

    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.id)).toEqual(['citadel', 'alpha']);
  });
});

describe('findRegion', () => {
  const regions = parseIndex(INDEX);

  it('finds a region by id', () => {
    expect(findRegion(regions, 'beta').pbfUrl).toMatch(/beta-latest/);
  });

  it('explains an id that is no longer in the index', () => {
    // Regions do get renamed and removed upstream, and a cached index can
    // name one that no longer exists.
    expect(() => findRegion(regions, 'atlantis')).toThrow(/no longer/i);
  });
});

describe('ukRegions (ADR 0018)', () => {
  const uk = parseIndex(
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        square('europe', null, -20, 30, 40, 70),
        square('united-kingdom', 'europe', -9, 49, 2, 61),
        square('england', 'united-kingdom', -6, 49.5, 2, 56),
        square('derbyshire', 'england', -2.04, 52.69, -1.16, 53.55),
        square('cheshire', 'england', -3.13, 52.94, -1.97, 53.49),
        square('scotland', 'united-kingdom', -9, 54.6, 0, 61),
        square('wales', 'united-kingdom', -5.6, 51.3, -2.6, 53.5),
        square('ireland-and-northern-ireland', 'europe', -11, 51.3, -5.4, 55.5),
        square('isle-of-man', 'europe', -4.9, 54, -4.3, 54.5),
        square('france', 'europe', -5, 42, 8, 51),
      ],
    }),
  );

  it('offers English counties, Scotland, Wales and the island of Ireland, and nothing else', () => {
    const ids = ukRegions(uk, new Set()).map((r) => r.id);
    expect(ids.toSorted()).toEqual(
      ['cheshire', 'derbyshire', 'ireland-and-northern-ireland', 'scotland', 'wales'],
    );
  });

  it('says that Northern Ireland only comes with the Republic', () => {
    const ireland = ukRegions(uk, new Set()).find(
      (r) => r.id === 'ireland-and-northern-ireland',
    );
    expect(ireland?.note).toMatch(/only published together with the Republic/i);
  });

  it('marks the loaded regions', () => {
    const loaded = ukRegions(uk, new Set(['derbyshire']));
    expect(loaded.find((r) => r.id === 'derbyshire')?.loaded).toBe(true);
    expect(loaded.find((r) => r.id === 'cheshire')?.loaded).toBe(false);
  });

  it('rounds rings for drawing only', () => {
    const derbyshire = ukRegions(uk, new Set()).find((r) => r.id === 'derbyshire');
    expect(derbyshire?.rings[0]?.[0]).toEqual([-2.04, 52.69]);
  });
});

describe('joinRegionNames', () => {
  it('reads naturally for one, three and many', () => {
    expect(joinRegionNames(['Derbyshire'])).toBe('Derbyshire');
    expect(joinRegionNames(['Derbyshire', 'Cheshire', 'Staffordshire'])).toBe(
      'Derbyshire, Cheshire and Staffordshire',
    );
    expect(joinRegionNames(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B and 4 more');
  });
});
