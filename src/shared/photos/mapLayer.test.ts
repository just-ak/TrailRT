import { describe, expect, it } from 'vitest';
import type { PhotoMapPoints } from '../domain/linkedFolders';
import { toPixels } from '../geo/cluster';
import {
  BURST_METRES,
  CELL_PX,
  clusterPhotos,
  directionText,
  inBounds,
  isInseparable,
  padBounds,
  viewClusters,
  type Bounds,
} from './mapLayer';

/** Column-wise points, as `photos:mapPoints` sends them. */
function points(coords: readonly [number, number][]): PhotoMapPoints {
  return {
    ids: coords.map((_, i) => `p${i}`),
    lat: Float64Array.from(coords.map(([lat]) => lat)),
    lon: Float64Array.from(coords.map(([, lon]) => lon)),
    folder: new Uint32Array(coords.length),
    folders: ['f'],
    dir: coords.map(() => null),
  };
}

/** A deterministic scatter, so the tests never depend on luck. */
function scatter(n: number, box: Bounds, seed = 1): [number, number][] {
  let s = seed;
  const next = (): number => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
  return Array.from({ length: n }, () => [
    box.south + next() * (box.north - box.south),
    box.west + next() * (box.east - box.west),
  ]);
}

/** The bounds of a map of `width` × `height` px centred on Buxton at `zoom`. */
function viewAt(zoom: number, width = 1200, height = 800): Bounds {
  const centre = toPixels({ lat: 53.259, lon: -1.911 }, zoom);
  const scale = 256 * 2 ** zoom;
  const toLon = (x: number): number => (x / scale) * 360 - 180;
  const toLat = (y: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
  return {
    west: toLon(centre.x - width / 2),
    east: toLon(centre.x + width / 2),
    north: toLat(centre.y - height / 2),
    south: toLat(centre.y + height / 2),
  };
}

// Most of Great Britain: 50,000 photos over many years of travel.
const BRITAIN: Bounds = { south: 50, west: -6, north: 58.5, east: 1.8 };
const MANY = points(scatter(50_000, BRITAIN));

describe('viewport clustering', () => {
  it('draws no more markers than there are screen cells, however many photos there are', () => {
    for (const zoom of [6, 9, 12, 15, 18]) {
      const clusters = viewClusters(MANY, viewAt(zoom), zoom, 19);
      // In view, padded by half a screen on every side: twice the width and height.
      const cells = Math.ceil((2 * 1200) / CELL_PX + 1) * Math.ceil((2 * 800) / CELL_PX + 1);
      expect(clusters.length, `zoom ${zoom}`).toBeLessThanOrEqual(cells);
      // Every photo in the padded view is in exactly one cluster.
      const members = clusters.reduce((sum, c) => sum + c.members.length, 0);
      expect(members).toBe(inBounds(MANY, padBounds(viewAt(zoom))).length);
    }
  });

  it('leaves out what is beyond the padded view', () => {
    const p = points([
      [53.259, -1.911], // Buxton, in view
      [57.27, -6.2], // Skye, far out of view at zoom 12
    ]);
    const clusters = viewClusters(p, viewAt(12), 12, 19);
    expect(clusters.flatMap((c) => c.members)).toEqual([0]);
  });

  it('keeps members in index order, which is taken-time order', () => {
    const p = points([
      [53.259, -1.911],
      [53.25901, -1.91101],
      [53.25902, -1.91102],
    ]);
    const [cluster] = clusterPhotos(p, [0, 1, 2], 10, 19);
    expect(cluster?.members).toEqual([0, 1, 2]);
  });

  it(`re-clusters 50,000 photos within the design's 50 ms at every zoom`, () => {
    for (const zoom of [5, 8, 11, 14, 17]) {
      const view = viewAt(zoom);
      viewClusters(MANY, view, zoom, 19); // warm
      const times: number[] = [];
      for (let run = 0; run < 5; run += 1) {
        const start = performance.now();
        viewClusters(MANY, view, zoom, 19);
        times.push(performance.now() - start);
      }
      const median = times.toSorted((a, b) => a - b)[2] ?? Infinity;
      expect(median, `zoom ${zoom}: ${median.toFixed(1)} ms`).toBeLessThan(50);
    }
  });
});

describe('bursts (Requirement 5.3)', () => {
  const buxton: [number, number] = [53.259, -1.911];
  // About 0.3 m north of it: the same spot to any phone's GPS.
  const sameSpot: [number, number] = [53.259_003, -1.911];
  // About 11 m north: a step or two away.
  const nearby: [number, number] = [53.259_1, -1.911];

  it('cannot separate photos less than a metre apart, at any zoom', () => {
    const p = points([buxton, sameSpot, buxton]);
    expect(BURST_METRES).toBe(1);
    expect(isInseparable(p, [0, 1, 2], 12, 19)).toBe(true);
  });

  it('can separate photos a few metres apart, until the map is at its maximum zoom', () => {
    const p = points([buxton, nearby]);
    expect(isInseparable(p, [0, 1], 17, 19)).toBe(false);
    expect(isInseparable(p, [0, 1], 19, 19)).toBe(true);
  });

  it('never calls one photo a burst', () => {
    expect(isInseparable(points([buxton]), [0], 19, 19)).toBe(false);
  });

  it('marks the cluster, so clicking it opens the first photo instead of zooming', () => {
    const p = points([buxton, sameSpot, nearby]);
    const atStreet = clusterPhotos(p, [0, 1, 2], 14, 19);
    expect(atStreet).toHaveLength(1);
    expect(atStreet[0]?.inseparable).toBe(false); // zooming in will split off the third
    const burstOnly = clusterPhotos(p, [0, 1], 14, 19);
    expect(burstOnly[0]?.inseparable).toBe(true);
  });
});

describe('bounds', () => {
  it('pads by half a screen on each side, and never past the poles', () => {
    expect(padBounds({ south: 50, west: -2, north: 52, east: 0 })).toEqual({ south: 49, west: -3, north: 53, east: 1 });
    expect(padBounds({ south: -89, west: 0, north: 89, east: 10 }).south).toBe(-90);
  });

  it('finds points across the antimeridian, where Leaflet bounds run past 180°', () => {
    const p = points([
      [-17.7, 178.4], // Fiji, east of 180°
      [-17.7, -179.9], // just past it
      [-17.7, 170], // outside
    ]);
    expect(inBounds(p, { south: -20, north: -15, west: 175, east: 185 })).toEqual([0, 1]);
  });
});

describe('directionText', () => {
  it('says which north a bearing is from', () => {
    expect(directionText(271.25, 'T')).toBe('271° true');
    expect(directionText(45.5, 'M')).toBe('46° magnetic');
    expect(directionText(359.6, null)).toBe('0°');
  });
});
