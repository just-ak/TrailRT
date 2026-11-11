import type { LatLon } from './distance';

/**
 * Grid clustering for map markers. Phase 10 Requirement 6.6.
 *
 * Points are projected to Web Mercator pixels at the map's zoom and grouped by
 * screen cell, so a cluster means "these would overlap on screen". Pure and
 * cheap: a few thousand POIs cluster in well under a millisecond, so it is
 * simply recomputed on every zoom. No library is needed for this.
 */

export interface Clustered<T> {
  key: string;
  lat: number;
  lon: number;
  members: T[];
}

const TILE = 256;

/** Web Mercator pixel coordinates at a zoom level. */
export function toPixels(point: LatLon, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, point.lat)) * Math.PI) / 180);
  return {
    x: ((point.lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export function clusterPoints<T extends LatLon>(points: readonly T[], zoom: number, cellPx = 56): Clustered<T>[] {
  const cells = new Map<string, T[]>();
  for (const point of points) {
    const { x, y } = toPixels(point, zoom);
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, [point]);
    else cell.push(point);
  }
  return [...cells.entries()].map(([key, members]) => ({
    key,
    lat: members.reduce((sum, p) => sum + p.lat, 0) / members.length,
    lon: members.reduce((sum, p) => sum + p.lon, 0) / members.length,
    members,
  }));
}
