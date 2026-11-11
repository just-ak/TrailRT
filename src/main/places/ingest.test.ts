import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUXTON } from '@fixtures/places';
import { haversineDistance } from '@shared/geo/distance';
import { parseIndex } from '../routing/geofabrik';
import { ingestPlaces, representativePoint, type IngestStats } from './ingest';
import { readMeta } from './store';

/**
 * The ingest against a real excerpt of OpenStreetMap round Buxton
 * (`test-data/places-excerpt/`, ODbL). Derbyshire's outline comes from the
 * Geofabrik index fixture, so counties are assigned the way the app does it.
 */

const FIXTURE = resolve('test-data/places-excerpt/buxton.geojsonseq');

let dir: string;
let db: Database.Database;
let stats: IngestStats;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-places-'));
  const file = join(dir, 'places.sqlite');
  const index = parseIndex(readFileSync(resolve('test-data/geofabrik-uk.json'), 'utf8'));
  const derbyshire = index.find((region) => region.id === 'derbyshire');
  if (derbyshire === undefined) throw new Error('fixture index has no Derbyshire');
  stats = await ingestPlaces(FIXTURE, file, {
    regionName: 'Derbyshire',
    regions: [{ name: 'Derbyshire', rings: derbyshire.rings }],
    dataDate: '2026-11-08',
    dateIsDownload: false,
  });
  db = new Database(file, { readonly: true });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface PoiRow {
  osm: string;
  category: string;
  kind: string;
  name: string | null;
  county: string | null;
  lat: number;
  lon: number;
  tags: string;
}

function poi(osm: string): PoiRow[] {
  return db.prepare('SELECT * FROM poi WHERE osm = ?').all(osm) as PoiRow[];
}

function kinds(token: string): unknown[] {
  return db.prepare('SELECT DISTINCT kind FROM token WHERE token = ? ORDER BY kind').all(token);
}

function count(table: 'poi' | 'street' | 'address'): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function square(x: number, size: number): [number, number][] {
  return [
    [x, 0],
    [x + size, 0],
    [x + size, size],
    [x, size],
    [x, 0],
  ];
}

/** A GeoJSON-lines record, without its leading record-separator character. */
function parseRecord(line: string): { geometry: { type: string } } {
  return JSON.parse(line.startsWith('\u001e') ? line.slice(1) : line) as { geometry: { type: string } };
}

describe('ingestPlaces', () => {
  it('keeps the Palace Hotel once, as an area, at its centroid', () => {
    // osmium exports this way as both a LineString and a MultiPolygon.
    const raw = readFileSync(FIXTURE, 'utf8')
      .split('\n')
      .filter((line) => line.includes('"@id":117882931'));
    expect(raw).toHaveLength(2);

    const rows = poi('way/117882931');
    expect(rows).toHaveLength(1);
    const hotel = rows[0];
    expect(hotel).toMatchObject({ category: 'accommodation', kind: 'hotel', name: 'Palace Hotel' });
    // The centroid, not a corner: within the building, a few tens of metres
    // from every vertex rather than on one.
    const polygon = raw.map(parseRecord).find((feature) => feature.geometry.type !== 'LineString');
    const centre = representativePoint(polygon?.geometry as never);
    expect(centre).not.toBeNull();
    expect(haversineDistance(centre ?? BUXTON, hotel ?? BUXTON)).toBeLessThan(0.01);
  });

  it('keeps a hotel mapped as a multipolygon relation', () => {
    expect(poi('relation/16879689')).toMatchObject([{ name: 'Buxton Crescent Hotel and Spa', kind: 'hotel' }]);
  });

  it('keeps only the attributes the UI shows', () => {
    const tags = JSON.parse(poi('relation/16879689')[0]?.tags ?? '{}') as Record<string, string>;
    expect(tags).toMatchObject({ phone: '+44 1298 808 999', 'addr:street': 'The Crescent' });
    expect(tags).not.toHaveProperty('building');
    expect(tags).not.toHaveProperty('tourism');
  });

  it('assigns the county from the region outline', () => {
    expect(poi('way/117882931')[0]?.county).toBe('Derbyshire');
  });

  it('finds the three fuel stations and the eleven settlements', () => {
    const fuel = db.prepare("SELECT name FROM poi WHERE category = 'fuel' ORDER BY name").all() as { name: string }[];
    expect(fuel.map((f) => f.name)).toEqual(['Essar Rockbay Service Station', 'Esso Buxton Express', 'Morrisons']);
    const places = db.prepare('SELECT name, kind FROM place ORDER BY name').all() as { name: string; kind: string }[];
    expect(places).toContainEqual({ name: 'Buxton', kind: 'town' });
    expect(places).toContainEqual({ name: 'Fairfield', kind: 'suburb' });
    expect(places).toHaveLength(11);
  });

  it('makes one street per name per settlement, not one per way', () => {
    const ways = readFileSync(FIXTURE, 'utf8')
      .split('\n')
      .filter((line) => line.includes('"highway"') && line.includes('"name":"Spring Gardens"')).length;
    expect(ways).toBeGreaterThan(1);
    const rows = db.prepare("SELECT settlement FROM street WHERE name = 'Spring Gardens'").all();
    expect(rows).toEqual([{ settlement: 'Buxton' }]);
  });

  it('keeps addressed buildings, keyed by folded street', () => {
    const row = db
      .prepare("SELECT number, lat, lon FROM address WHERE street_key = 'spring gardens' AND number = '63'")
      .get() as { number: string; lat: number; lon: number } | undefined;
    expect(row?.number).toBe('63');
    expect(haversineDistance(row ?? { lat: 0, lon: 0 }, BUXTON)).toBeLessThan(1000);
    const range = db.prepare("SELECT 1 FROM address WHERE street_key = 'spring gardens' AND number = '20-22'").get();
    expect(range).toBeDefined();
  });

  it('indexes names as folded tokens', () => {
    // Buxton the town (1) and POIs named after it (3); Spring Gardens the street (2).
    expect(kinds('buxton')).toEqual([{ kind: 1 }, { kind: 3 }]);
    expect(kinds('spring')).toContainEqual({ kind: 2 });
    expect(kinds('Spring')).toEqual([]);
  });

  it('records what the data is and where it covers', () => {
    const meta = readMeta(db);
    expect(meta).toMatchObject({
      schema: 1,
      dataDate: '2026-11-08',
      dateIsDownload: false,
      regionName: 'Derbyshire',
      regionNames: ['Derbyshire'],
      poiCount: stats.pois,
    });
    expect(meta?.coverage.length).toBeGreaterThan(0);
  });

  it('reports what it kept', () => {
    expect(stats.pois).toBe(count('poi'));
    expect(stats.streets).toBe(count('street'));
    expect(stats.addresses).toBe(count('address'));
    // 280 parking features are in the excerpt; private and unnamed kerbside
    // bays are excluded, so far fewer than the raw feature count survive.
    expect(stats.pois).toBeGreaterThan(150);
    expect(stats.streets).toBeGreaterThan(10);
    expect(stats.addresses).toBeGreaterThan(100);
    expect(stats.places).toBe(11);
  });
});

describe('representativePoint', () => {
  it('takes the largest part of a multipolygon', () => {
    const point = representativePoint({
      type: 'MultiPolygon',
      coordinates: [[square(0, 0.001)], [square(1, 0.01)]],
    });
    expect(point?.lon).toBeCloseTo(1.005, 9);
    expect(point?.lat).toBeCloseTo(0.005, 9);
  });
});
