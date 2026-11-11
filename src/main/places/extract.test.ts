import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractPlaces, placeFilters, readDataDate } from './extract';
import { ingestPlaces } from './ingest';

/**
 * The real tools on a real excerpt: `tiny.osm` is the OpenStreetMap data
 * round Buxton's Palace Hotel (ODbL; see `test-data/places-excerpt/`).
 *
 * Skipped when the bundled `osmium` is absent, as the live tests are:
 * `resources/valhalla/` is a build artefact and is not committed. It proves
 * what no fake can, which is that the filter expressions the app generates
 * are ones osmium accepts.
 */

const TOOL = resolve('resources/valhalla/bin/osmium');
const TINY = resolve('test-data/places-excerpt/tiny.osm');

describe('placeFilters', () => {
  it('selects POIs, settlements, roads and addresses', () => {
    const filters = placeFilters();
    expect(filters.some((f) => f.startsWith('nwr/tourism='))).toBe(true);
    expect(filters).toContain('w/highway');
    expect(filters.find((f) => f.startsWith('n/place='))).toContain('hamlet');
    expect(filters).toContain('nwr/addr:housenumber');
  });
});

describe.skipIf(!existsSync(TOOL))('osmium, for real', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'trailrt-osmium-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('extracts and ingests the Palace Hotel once, as an area', async () => {
    const geojson = await extractPlaces(TOOL, TINY, join(dir, 'work'));
    const out = join(dir, 'places.sqlite');
    await ingestPlaces(geojson, out, { regionName: 'Test', regions: [], dataDate: '2026-11-08', dateIsDownload: false });
    const db = new Database(out, { readonly: true });
    try {
      const rows = db.prepare("SELECT osm, kind FROM poi WHERE name = 'Palace Hotel'").all();
      expect(rows).toEqual([{ osm: 'way/117882931', kind: 'hotel' }]);
    } finally {
      db.close();
    }
  });

  it('reads no data date from a file whose header has none', async () => {
    expect(await readDataDate(TOOL, TINY)).toBeNull();
    expect(await readDataDate(TOOL, join(dir, 'missing.osm.pbf'))).toBeNull();
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractPlaces(TOOL, TINY, join(dir, 'cancelled'), controller.signal)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });
});
