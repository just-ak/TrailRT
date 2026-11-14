import type { PhotoMapPoints } from '../domain/linkedFolders';
import { toPixels } from '../geo/cluster';
import { haversineDistance } from '../geo/distance';

/**
 * Photos on the map, clustered by what is in view. Phase 11, design §9.2 and
 * §9.3.
 *
 * The POI layer clusters every point it has; that is fine for a few thousand
 * POIs and not for 50,000 photos, which at high zoom would become 50,000 DOM
 * markers. Here only the points inside the view (padded by half a screen)
 * are clustered, by 56 px screen cell, so the number of markers is bounded by
 * the screen, not the library (Requirement 5.2).
 *
 * Works on the column-wise points directly, by index, so 50,000 points are
 * never turned into 50,000 objects. Pure: no Leaflet here.
 */

export const CELL_PX = 56;
/** Members closer together than this are one place: a burst (Requirement 5.3). */
export const BURST_METRES = 1;

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface PhotoCluster {
  key: string;
  lat: number;
  lon: number;
  /** Indices into the points, in taken-time order (the points are sent that way). */
  members: number[];
  /**
   * Cannot be split by zooming in: the members span less than a metre, or
   * the map is already at its maximum zoom. Clicking opens the first member
   * and the preview steps through the rest.
   */
  inseparable: boolean;
}

/** The bounds grown by `fraction` of their size on every side, so panning a little draws nothing new. */
export function padBounds(bounds: Bounds, fraction = 0.5): Bounds {
  const dLat = (bounds.north - bounds.south) * fraction;
  const dLon = (bounds.east - bounds.west) * fraction;
  return {
    south: Math.max(-90, bounds.south - dLat),
    north: Math.min(90, bounds.north + dLat),
    west: bounds.west - dLon,
    east: bounds.east + dLon,
  };
}

function lonInside(lon: number, west: number, east: number): boolean {
  if (east - west >= 360) return true;
  // Leaflet's bounds may run past ±180 after panning round the world.
  const span = east - west;
  const offset = (((lon - west) % 360) + 360) % 360;
  return offset <= span;
}

/** The indices of the points inside the bounds. */
export function inBounds(points: PhotoMapPoints, bounds: Bounds): number[] {
  const inside: number[] = [];
  for (let i = 0; i < points.lat.length; i += 1) {
    const lat = points.lat[i] ?? Number.NaN;
    if (lat < bounds.south || lat > bounds.north) continue;
    if (lonInside(points.lon[i] ?? Number.NaN, bounds.west, bounds.east)) inside.push(i);
  }
  return inside;
}

/** Whether these members could ever be told apart on this map. */
export function isInseparable(points: PhotoMapPoints, members: readonly number[], zoom: number, maxZoom: number): boolean {
  if (members.length < 2) return false;
  if (zoom >= maxZoom) return true;
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const i of members) {
    const lat = points.lat[i] ?? 0;
    const lon = points.lon[i] ?? 0;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  return haversineDistance({ lat: south, lon: west }, { lat: north, lon: east }) < BURST_METRES;
}

/** Clusters the given points by screen cell at this zoom. */
export function clusterPhotos(
  points: PhotoMapPoints,
  indices: readonly number[],
  zoom: number,
  maxZoom: number,
  cellPx = CELL_PX,
): PhotoCluster[] {
  const cells = new Map<string, number[]>();
  for (const i of indices) {
    const { x, y } = toPixels({ lat: points.lat[i] ?? 0, lon: points.lon[i] ?? 0 }, zoom);
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, [i]);
    else cell.push(i);
  }
  const clusters: PhotoCluster[] = [];
  for (const [key, members] of cells) {
    let lat = 0;
    let lon = 0;
    for (const i of members) {
      lat += points.lat[i] ?? 0;
      lon += points.lon[i] ?? 0;
    }
    // Indices were visited in ascending order, which is taken-time order.
    clusters.push({
      key,
      lat: lat / members.length,
      lon: lon / members.length,
      members,
      inseparable: isInseparable(points, members, zoom, maxZoom),
    });
  }
  return clusters;
}

/** Clusters what is in view (padded by half a screen) at this zoom. */
export function viewClusters(points: PhotoMapPoints, view: Bounds, zoom: number, maxZoom: number): PhotoCluster[] {
  return clusterPhotos(points, inBounds(points, padBounds(view)), zoom, maxZoom);
}

/** Every member at the same index position as `id`, or -1. Small helper for selection. */
export function indexOfPhoto(points: PhotoMapPoints, id: string): number {
  return points.ids.indexOf(id);
}

/** "true north" or "magnetic north", for a direction's hint (design §9.4). */
export function directionText(degrees: number, ref: 'T' | 'M' | null): string {
  const rounded = Math.round(degrees) % 360;
  return ref === 'M' ? `${rounded}° magnetic` : ref === 'T' ? `${rounded}° true` : `${rounded}°`;
}
