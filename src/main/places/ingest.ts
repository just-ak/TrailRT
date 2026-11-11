import { createReadStream, rmSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import type { LatLon } from '@shared/geo/distance';
import { pointInRings, ringsBoundingBox, type BoundingBox, type Ring } from '@shared/geo/polygon';
import { compactTags } from '@shared/poi/attributes';
import { classifyTags, type Classification } from '@shared/poi/categories';
import { PLACE_KINDS, type PlaceKind } from '@shared/search/PlaceSearchProvider';
import { foldText, tokenise } from '@shared/search/text';
import { ServiceError } from '../services/errors';
import { PLACES_DDL, PLACES_INDEXES, PLACES_SCHEMA, TOKEN_KIND } from './store';

/**
 * GeoJSON lines from `osmium export` → `places.sqlite`. Phase 10 design §5.
 *
 * Streams the file and never holds it: for three counties it is 459 MB and
 * 1.2 M features. What is kept is small: 35 k POIs, 2.6 k places, 64 k
 * street rows, 574 k addressed buildings (design §0).
 *
 * ## Three things the data does that this has to handle
 *
 * 1. **A closed way is emitted twice**, as a LineString and as a polygon. The
 *    Palace Hotel in Buxton is both. POIs and addresses are therefore keyed by
 *    `type/id`, and the area wins over the line.
 * 2. **Areas need a point.** An area POI takes the centroid of its outer
 *    ring, not its first vertex, which is a corner of the building.
 * 3. **A road is many ways.** Each named way is assigned to its nearest
 *    settlement, and ways with the same name in the same settlement become
 *    one street (Requirement 11.10).
 */

export interface IngestRegion {
  name: string;
  rings: Ring[];
}

export interface IngestOptions {
  regionName: string;
  /** The Geofabrik regions, for counties and coverage. Empty for an imported file. */
  regions: readonly IngestRegion[];
  dataDate: string;
  dateIsDownload: boolean;
  signal?: AbortSignal;
}

export interface IngestStats {
  pois: number;
  places: number;
  streets: number;
  addresses: number;
  bytes: number;
}

/** Roads people do not search for by name. Footpaths and tracks have names, but not addresses. */
const NOT_STREETS = new Set([
  'footway',
  'path',
  'cycleway',
  'bridleway',
  'steps',
  'corridor',
  'proposed',
  'construction',
  'platform',
  'bus_stop',
  'elevator',
  'raceway',
  'abandoned',
  'disused',
]);

/** Settlements a street can belong to. Localities are fields and moors, not addresses. */
const SETTLEMENTS = new Set<PlaceKind>(['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood']);

type Geometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] };

interface Feature {
  geometry: Geometry;
  properties: Record<string, string>;
}

/** Area-weighted centroid of a ring; its vertex mean when the ring is degenerate. */
function ringCentroid(ring: readonly [number, number][]): [number, number] {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i] ?? [0, 0];
    const [x1, y1] = ring[i + 1] ?? [0, 0];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-18) {
    const n = Math.max(ring.length, 1);
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

function ringArea(ring: readonly [number, number][]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i] ?? [0, 0];
    const [x1, y1] = ring[i + 1] ?? [0, 0];
    area += x0 * y1 - x1 * y0;
  }
  return Math.abs(area / 2);
}

/** A representative point, as lat/lon. */
export function representativePoint(geometry: Geometry): LatLon | null {
  let lonLat: [number, number] | undefined;
  switch (geometry.type) {
    case 'Point':
      lonLat = geometry.coordinates;
      break;
    case 'LineString':
      lonLat = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
      break;
    case 'Polygon': {
      const outer = geometry.coordinates[0];
      if (outer !== undefined) lonLat = ringCentroid(outer);
      break;
    }
    case 'MultiPolygon': {
      // The largest part: a hotel with an annexe is where the main building is.
      let best: [number, number][] | undefined;
      let bestArea = -1;
      for (const polygon of geometry.coordinates) {
        const outer = polygon[0];
        if (outer === undefined) continue;
        const area = ringArea(outer);
        if (area > bestArea) {
          bestArea = area;
          best = outer;
        }
      }
      if (best !== undefined) lonLat = ringCentroid(best);
      break;
    }
  }
  if (lonLat === undefined || !Number.isFinite(lonLat[0]) || !Number.isFinite(lonLat[1])) return null;
  return { lat: lonLat[1], lon: lonLat[0] };
}

const isArea = (geometry: Geometry): boolean =>
  geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';

/** Finds the county a point is in, from the regions' rings. */
function countyFinder(regions: readonly IngestRegion[]): (point: LatLon) => string | null {
  const boxed = regions
    .map((region) => ({ ...region, box: ringsBoundingBox(region.rings) }))
    .filter((region): region is IngestRegion & { box: BoundingBox } => region.box !== null);
  return (point) => {
    for (const region of boxed) {
      const { box } = region;
      if (point.lat < box.minLat || point.lat > box.maxLat || point.lon < box.minLon || point.lon > box.maxLon) {
        continue;
      }
      if (pointInRings(region.rings, point)) return region.name;
    }
    return null;
  };
}

interface Settlement extends LatLon {
  name: string;
}

/** Nearest-settlement lookup on a 0.05° grid, searched outwards to about 20 km. */
function settlementFinder(settlements: readonly Settlement[]): (point: LatLon) => string | null {
  const CELL = 0.05;
  const grid = new Map<string, Settlement[]>();
  for (const s of settlements) {
    const key = `${Math.floor(s.lat / CELL)}:${Math.floor(s.lon / CELL)}`;
    const list = grid.get(key);
    if (list === undefined) grid.set(key, [s]);
    else list.push(s);
  }
  return (point) => {
    const row = Math.floor(point.lat / CELL);
    const col = Math.floor(point.lon / CELL);
    const cos = Math.cos((point.lat * Math.PI) / 180);
    let best: Settlement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let reach = 1; reach <= 4; reach += 1) {
      for (let r = row - reach; r <= row + reach; r += 1) {
        for (let c = col - reach; c <= col + reach; c += 1) {
          for (const s of grid.get(`${r}:${c}`) ?? []) {
            const d = (s.lat - point.lat) ** 2 + ((s.lon - point.lon) * cos) ** 2;
            if (d < bestDistance) {
              bestDistance = d;
              best = s;
            }
          }
        }
      }
      // A ring further out can only hold something nearer if this one was empty.
      if (best !== null) break;
    }
    const found = best as Settlement | null;
    return found === null ? null : found.name;
  };
}

function parseLine(raw: string): Feature | null {
  const line = raw.charCodeAt(0) === 0x1e ? raw.slice(1) : raw;
  if (line.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(line) as Partial<Feature>;
    if (parsed.geometry === undefined || parsed.properties === undefined) return null;
    return parsed as Feature;
  } catch {
    return null;
  }
}

export async function ingestPlaces(
  geojsonPath: string,
  outPath: string,
  options: IngestOptions,
): Promise<IngestStats> {
  const countyOf = countyFinder(options.regions);

  rmSync(outPath, { force: true });
  const db = new Database(outPath);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.exec(PLACES_DDL);

  const insertAddress = db.prepare(
    'INSERT INTO address (street_key, number, name, lat, lon) VALUES (?, ?, ?, ?, ?)',
  );

  // Pass 1: stream. Addresses go straight to the database: there are far
  // more of them than anything else, and the line form of a building is
  // skipped, so none arrives twice. POIs are held to collapse duplicates.
  const pois = new Map<string, { classification: Classification; point: LatLon; area: boolean; tags: Record<string, string> }>();
  const places: { kind: PlaceKind; name: string; point: LatLon }[] = [];
  const ways: { name: string; point: LatLon }[] = [];
  let addressCount = 0;

  let lines = 0;
  db.exec('BEGIN');
  const input = createInterface({ input: createReadStream(geojsonPath) });
  try {
    for await (const raw of input) {
      lines += 1;
      if (lines % 5000 === 0 && options.signal?.aborted === true) {
        input.close();
        throw new ServiceError('CANCELLED', 'Reading place data was cancelled.');
      }
      const feature = parseLine(raw);
      if (feature === null) continue;
      const tags = feature.properties;
      const osm = `${tags['@type'] ?? '?'}/${tags['@id'] ?? '?'}`;
      const point = representativePoint(feature.geometry);
      if (point === null) continue;
      const area = isArea(feature.geometry);

      // A highway that also carries amenity=parking is a car park drawn as a road area.
      const classification = feature.geometry.type === 'LineString' && tags.highway !== undefined ? null : classifyTags(tags);
      if (classification !== null) {
        const existing = pois.get(osm);
        if (existing === undefined || (area && !existing.area)) {
          pois.set(osm, { classification, point, area, tags: compactTags(tags) });
        }
      }

      const placeKind = tags.place as PlaceKind | undefined;
      if (
        placeKind !== undefined &&
        PLACE_KINDS.includes(placeKind) &&
        feature.geometry.type === 'Point' &&
        (tags.name ?? '').length > 0
      ) {
        places.push({ kind: placeKind, name: tags.name ?? '', point });
      }

      if (
        feature.geometry.type === 'LineString' &&
        tags.highway !== undefined &&
        !NOT_STREETS.has(tags.highway) &&
        (tags.name ?? '').trim().length > 0
      ) {
        ways.push({ name: (tags.name ?? '').trim(), point });
      }

      const number = tags['addr:housenumber'];
      const street = tags['addr:street'] ?? tags['addr:place'];
      if (number !== undefined && street !== undefined && feature.geometry.type !== 'LineString') {
        insertAddress.run(
          foldText(street),
          number.replaceAll(/\s+/g, '').toLowerCase(),
          tags['addr:housename'] ?? null,
          point.lat,
          point.lon,
        );
        addressCount += 1;
      }
    }
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    rmSync(outPath, { force: true });
    throw error;
  }

  // Pass 2: streets, one per name per settlement.
  const settlementOf = settlementFinder(
    places.filter((p) => SETTLEMENTS.has(p.kind)).map((p) => ({ name: p.name, lat: p.point.lat, lon: p.point.lon })),
  );
  const streets = new Map<string, { name: string; settlement: string | null; points: LatLon[] }>();
  for (const way of ways) {
    const settlement = settlementOf(way.point);
    const key = `${foldText(way.name)}|${settlement ?? ''}`;
    const group = streets.get(key);
    if (group === undefined) streets.set(key, { name: way.name, settlement, points: [way.point] });
    else group.points.push(way.point);
  }

  // Pass 3: everything else.
  try {
    const insertPoi = db.prepare(
      'INSERT INTO poi (osm, category, kind, name, county, lat, lon, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertPlace = db.prepare('INSERT INTO place (kind, name, county, lat, lon) VALUES (?, ?, ?, ?, ?)');
    const insertStreet = db.prepare(
      'INSERT INTO street (name, street_key, settlement, county, lat, lon) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertToken = db.prepare('INSERT INTO token (token, kind, ref) VALUES (?, ?, ?)');
    const tokens = (text: string, kind: number, ref: number | bigint): void => {
      for (const token of new Set(tokenise(text))) insertToken.run(token, kind, ref);
    };

    {
      for (const [osm, poi] of pois) {
        const name = poi.tags.name ?? null;
        const result = insertPoi.run(
          osm,
          poi.classification.category,
          poi.classification.kind,
          name,
          countyOf(poi.point),
          poi.point.lat,
          poi.point.lon,
          JSON.stringify(poi.tags),
        );
        if (name !== null) tokens(name, TOKEN_KIND.poi, result.lastInsertRowid);
      }
      for (const place of places) {
        const result = insertPlace.run(place.kind, place.name, countyOf(place.point), place.point.lat, place.point.lon);
        tokens(place.name, TOKEN_KIND.place, result.lastInsertRowid);
      }
      for (const street of streets.values()) {
        // The way nearest the group's middle stands for the street.
        const n = street.points.length;
        const mean = {
          lat: street.points.reduce((s, p) => s + p.lat, 0) / n,
          lon: street.points.reduce((s, p) => s + p.lon, 0) / n,
        };
        let point = street.points[0] ?? mean;
        let best = Number.POSITIVE_INFINITY;
        for (const p of street.points) {
          const d = (p.lat - mean.lat) ** 2 + (p.lon - mean.lon) ** 2;
          if (d < best) {
            best = d;
            point = p;
          }
        }
        const result = insertStreet.run(
          street.name,
          foldText(street.name),
          street.settlement,
          countyOf(point),
          point.lat,
          point.lon,
        );
        tokens(street.name, TOKEN_KIND.street, result.lastInsertRowid);
      }

      const coverage =
        options.regions.length > 0
          ? options.regions.flatMap((region) => region.rings)
          : dataBoxRing([...pois.values()].map((p) => p.point).concat(places.map((p) => p.point), ways.map((w) => w.point)));

      const meta: Record<string, string> = {
        schema: String(PLACES_SCHEMA),
        data_date: options.dataDate,
        date_is_download: options.dateIsDownload ? '1' : '0',
        region_name: options.regionName,
        region_names: JSON.stringify(options.regions.map((r) => r.name)),
        coverage: JSON.stringify(coverage),
        built_at: String(Date.now()),
        poi_count: String(pois.size),
      };
      const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(meta)) insertMeta.run(key, value);
    }
    db.exec('COMMIT');

    db.exec(PLACES_INDEXES);
    db.exec('VACUUM');
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
    rmSync(outPath, { force: true });
    throw error;
  }
  db.close();

  return {
    pois: pois.size,
    places: places.length,
    streets: streets.size,
    addresses: addressCount,
    bytes: statSync(outPath).size,
  };
}

/**
 * For an imported file, which names no region: the data's own bounding box.
 * Coarse, but it is only used to say "outside your data" for stretches far
 * from anything in it.
 */
function dataBoxRing(points: readonly LatLon[]): Ring[] {
  if (points.length === 0) return [];
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return [
    [
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat],
    ],
  ];
}
