import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { PlaceDataState } from '@shared/poi/PoiProvider';
import type { Ring } from '@shared/geo/polygon';
import { graphPresent, readLoadedRegion, type EmbeddedPaths } from '../routing/embedded';

/**
 * `places.sqlite`: POIs, settlements, streets and addressed buildings from the
 * routing regions' extract. Phase 10 design §5.2.
 *
 * It lives beside the routing tiles and is replaced when they are, so it
 * always describes the same data as the graph. It is a cache of the extract:
 * rebuildable, not backed up, never the only copy of anything.
 *
 * Opened read-only and kept open; `closePlacesDb` drops the handle before a
 * rebuild replaces the file.
 */

export const PLACES_SCHEMA = 1;

export const PLACES_DDL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE poi (
  id INTEGER PRIMARY KEY,
  osm TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT,
  county TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  tags TEXT NOT NULL
);
CREATE TABLE place (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  county TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL
);
CREATE TABLE street (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  street_key TEXT NOT NULL,
  settlement TEXT,
  county TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL
);
CREATE TABLE address (
  id INTEGER PRIMARY KEY,
  street_key TEXT NOT NULL,
  number TEXT NOT NULL,
  name TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL
);
CREATE TABLE token (token TEXT NOT NULL, kind INTEGER NOT NULL, ref INTEGER NOT NULL);
`;

/** Indexes are created after the bulk insert, which is several times faster. */
export const PLACES_INDEXES = `
CREATE INDEX idx_poi_lat ON poi (lat, lon);
CREATE INDEX idx_street_key ON street (street_key);
CREATE INDEX idx_address ON address (street_key, number);
CREATE INDEX idx_token ON token (token);
`;

/** `token.kind` values. */
export const TOKEN_KIND = { place: 1, street: 2, poi: 3 } as const;

export interface PlacesMeta {
  schema: number;
  dataDate: string;
  dateIsDownload: boolean;
  regionName: string;
  regionNames: string[];
  /** Outer rings of the area the data covers. */
  coverage: Ring[];
  builtAt: number;
  poiCount: number;
}

export function placesFile(paths: EmbeddedPaths): string {
  return join(dirname(paths.tileDir), 'places.sqlite');
}

let cached: { file: string; db: Database.Database } | null = null;

/** The open places database, or null when there is none or it is unusable. */
export function placesDb(paths: EmbeddedPaths): Database.Database | null {
  const file = placesFile(paths);
  if (cached !== null && cached.file === file) return cached.db;
  closePlacesDb();
  if (!existsSync(file)) return null;
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    const meta = readMeta(db);
    if (meta === null || meta.schema !== PLACES_SCHEMA) {
      db.close();
      return null;
    }
    cached = { file, db };
    return db;
  } catch {
    return null;
  }
}

export function closePlacesDb(): void {
  if (cached === null) return;
  try {
    cached.db.close();
  } catch {
    /* already closed */
  }
  cached = null;
}

/** Removes the snapshot, for when it no longer matches the graph. */
export function deletePlaces(paths: EmbeddedPaths): void {
  closePlacesDb();
  rmSync(placesFile(paths), { force: true });
}

export function readMeta(db: Database.Database): PlacesMeta | null {
  try {
    const rows = db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
    const map = new Map(rows.map((row) => [row.key, row.value]));
    const get = (key: string): string => {
      const value = map.get(key);
      if (value === undefined) throw new Error(`meta.${key} missing`);
      return value;
    };
    return {
      schema: Number(get('schema')),
      dataDate: get('data_date'),
      dateIsDownload: get('date_is_download') === '1',
      regionName: get('region_name'),
      regionNames: JSON.parse(get('region_names')) as string[],
      coverage: JSON.parse(get('coverage')) as Ring[],
      builtAt: Number(get('built_at')),
      poiCount: Number(get('poi_count')),
    };
  } catch {
    return null;
  }
}

/** What place data there is, for the POI panel, search box and Settings. */
export function placesState(paths: EmbeddedPaths): PlaceDataState {
  const db = placesDb(paths);
  const meta = db === null ? null : readMeta(db);
  if (meta !== null) {
    return {
      kind: 'ready',
      regionName: meta.regionName,
      regionNames: meta.regionNames,
      dataDate: meta.dataDate,
      dateIsDownload: meta.dateIsDownload,
      poiCount: meta.poiCount,
    };
  }
  if (!graphPresent(paths)) return { kind: 'none' };
  const loaded = readLoadedRegion(paths);
  // A graph built before Phase 10, or whose place build failed. Never shown
  // as "no POIs": the data was simply not captured (Requirement 5.4).
  return {
    kind: 'missing',
    regionName: loaded?.regionName ?? 'your map regions',
    canRebuild: (loaded?.regionIds?.length ?? 0) > 0,
  };
}
