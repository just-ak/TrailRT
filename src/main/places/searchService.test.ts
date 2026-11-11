import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUXTON } from '@fixtures/places';
import { haversineDistance } from '@shared/geo/distance';
import type { PlaceSearchProvider } from '@shared/search/PlaceSearchProvider';
import { parseIndex } from '../routing/geofabrik';
import { embeddedPaths, type EmbeddedPaths } from '../routing/embedded';
import { ingestPlaces } from './ingest';
import { closePostcodesDb, ingestRelease } from './postcodes';
import { createSearchService } from './searchService';
import { closePlacesDb, placesFile } from './store';

/**
 * Search against real data: the Buxton OpenStreetMap excerpt and the
 * Code-Point Open excerpt, both committed under `test-data/`.
 */

let root: string;
let paths: EmbeddedPaths;
let search: PlaceSearchProvider;
let bare: PlaceSearchProvider;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'trailrt-search-'));
  paths = embeddedPaths(join(root, 'user'), join(root, 'resources'));
  mkdirSync(join(root, 'user', 'valhalla'), { recursive: true });

  const index = parseIndex(readFileSync(resolve('test-data/geofabrik-uk.json'), 'utf8'));
  const derbyshire = index.find((region) => region.id === 'derbyshire');
  if (derbyshire === undefined) throw new Error('no Derbyshire');
  await ingestPlaces(resolve('test-data/places-excerpt/buxton.geojsonseq'), placesFile(paths), {
    regionName: 'Derbyshire',
    regions: [{ name: 'Derbyshire', rings: derbyshire.rings }],
    dataDate: '2026-11-08',
    dateIsDownload: false,
  });

  const zip = new JSZip();
  const excerpt = resolve('test-data/codepoint');
  for (const file of files(excerpt)) {
    const path = relative(excerpt, file);
    if (path !== 'README.md') zip.file(path, readFileSync(file));
  }
  const zipPath = join(root, 'codepo.zip');
  writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
  await ingestRelease(zipPath, paths.gazetteerDir, '2026-11');

  search = createSearchService({ paths });
  bare = createSearchService({ paths: embeddedPaths(join(root, 'empty'), join(root, 'resources')) });
});

afterAll(() => {
  closePlacesDb();
  closePostcodesDb();
  rmSync(root, { recursive: true, force: true });
});

const find = (text: string, provider: () => PlaceSearchProvider = () => search) =>
  provider().search(text, BUXTON, 20);

describe('postcode search', () => {
  it.each(['sk176aa', 'SK17 6AA', 'sk17  6aa'])('finds %j at its centre, labelled as not an address', (text) => {
    const { results, message } = find(text);
    expect(message).toBeNull();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'postcode', label: 'SK17 6AA', approximate: false, source: 'codepoint' });
    expect(results[0]?.note).toMatch(/not an address/);
    expect(haversineDistance(results[0] ?? BUXTON, { lat: 53.259555, lon: -1.908727 })).toBeLessThan(10);
  });

  it('finds a sector and an outcode as approximate areas', () => {
    const sector = find('SK17 6').results[0];
    expect(sector).toMatchObject({ kind: 'postcode-area', label: 'SK17 6', approximate: true });
    expect(sector?.note).toMatch(/274 postcodes/);
    expect(sector?.bounds).not.toBeNull();
    expect(find('sk17').results[0]).toMatchObject({ kind: 'postcode-area', label: 'SK17' });
  });

  it('says a well-formed postcode is not in the data, with its date, and offers no neighbour', () => {
    const { results, message } = find('SK17 9ZZ');
    expect(results).toEqual([]);
    expect(message).toBe('SK17 9ZZ was not found in the postcode data dated 2026-10-19.');
  });

  it('says a postcode with no location has none, rather than plotting it at 0, 0', () => {
    expect(find('AB43 1AJ').message).toMatch(/gives no location/);
    expect(find('AB43 1AJ').results).toEqual([]);
  });

  it.each([
    ['BT1 1AA', 'Northern Ireland'],
    ['IM1 1AA', 'the Isle of Man'],
    ['JE2 3AB', 'Jersey'],
    ['GY1 1AA', 'Guernsey'],
  ])('says %s is outside the data, not "not found"', (text, region) => {
    const { message } = find(text);
    expect(message).toBe(`Postcodes in ${region} are not included. The postcode data covers Great Britain only.`);
  });

  it('asks for the data when there is none', () => {
    expect(find('SK17 6AA', () => bare).message).toMatch(/Download it in Settings/);
  });
});

describe('place search', () => {
  it('puts the town first for its own name', () => {
    expect(find('Buxton').results[0]).toMatchObject({ kind: 'place', label: 'Buxton', placeKind: 'town' });
  });

  it('matches from the start of a word as the user types', () => {
    expect(find('harp').results.map((r) => r.label)).toContain('Harpur Hill');
    expect(find('arpur').results.map((r) => r.label)).not.toContain('Harpur Hill');
  });

  it('treats abbreviations as their full form and names the street’s town', () => {
    const street = find('spring gdns').results.find((r) => r.kind === 'street');
    expect(street).toMatchObject({ label: 'Spring Gardens', detail: 'Buxton' });
  });

  it('resolves a mapped house number to its building', () => {
    const { results } = find('63 Spring Gardens');
    expect(results[0]).toMatchObject({ kind: 'address', label: '63 Spring Gardens', detail: 'Buxton', note: null });
  });

  it('falls back to the street for an unmapped number, and says so', () => {
    const { results } = find('999 Spring Gardens');
    expect(results[0]).toMatchObject({ kind: 'street', label: 'Spring Gardens' });
    expect(results[0]?.note).toBe('Only the street was matched. Number 999 is not mapped.');
  });

  it('finds a named POI', () => {
    expect(find('palace hotel').results.find((r) => r.kind === 'poi')).toMatchObject({
      label: 'Palace Hotel',
      detail: 'Accommodation',
    });
  });

  it('names the loaded regions when nothing matches', () => {
    const { results, message } = find('Zzyzx');
    expect(results).toEqual([]);
    expect(message).toBe('No match in your map regions: Derbyshire.');
  });

  it('asks for map regions when there are none', () => {
    expect(find('Buxton', () => bare).message).toMatch(/needs map regions/);
  });

  it('attributes both datasets with their dates', () => {
    const { datasets } = find('Buxton');
    expect(datasets.map((d) => [d.id, d.date])).toEqual([
      ['codepoint', '2026-10-19'],
      ['osm', '2026-11-08'],
    ]);
    expect(datasets[0]?.attribution).toContain('Contains OS data © Crown copyright and database right 2026');
    expect(datasets[1]?.attribution).toContain('© OpenStreetMap contributors, ODbL');
  });
});

describe('status', () => {
  it('reports both datasets', () => {
    expect(search.status()).toEqual({
      postcodes: { kind: 'ready', date: '2026-10-19', release: '2026-11', count: 279, withoutLocation: 2 },
      places: { kind: 'ready', regionNames: ['Derbyshire'], date: '2026-11-08' },
    });
    expect(bare.status()).toEqual({ postcodes: { kind: 'none' }, places: { kind: 'none' } });
  });
});
