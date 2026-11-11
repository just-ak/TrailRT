import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUXTON } from '@fixtures/places';
import type { PlaceSearchProvider } from '@shared/search/PlaceSearchProvider';
import { embeddedPaths } from '../routing/embedded';
import { closePostcodesDb, ingestRelease } from './postcodes';
import { createSearchService } from './searchService';
import { closePlacesDb, placesFile } from './store';

/**
 * Non-functional requirement 2: results for each typed character within
 * 100 ms, on the three-county Buxton region set plus every postcode in Great
 * Britain. Needs the real data, so it is opt-in:
 *
 *   TRAILRT_LIVE_SEARCH=<dir> npm run verify:search
 *
 * where `<dir>` holds `places.sqlite` (built from Derbyshire, Cheshire and
 * Staffordshire) and `codepo_gb.zip` (the Code-Point Open release).
 */

const source = process.env.TRAILRT_LIVE_SEARCH ?? '';
const enabled = source.length > 0 && existsSync(join(source, 'places.sqlite')) && existsSync(join(source, 'codepo_gb.zip'));

describe.skipIf(!enabled)('search latency on full data', () => {
  let root: string;
  let search: PlaceSearchProvider;
  let ingestMs = 0;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'trailrt-search-live-'));
    const paths = embeddedPaths(join(root, 'user'), join(root, 'resources'));
    mkdirSync(join(root, 'user', 'valhalla'), { recursive: true });
    copyFileSync(join(source, 'places.sqlite'), placesFile(paths));
    const started = Date.now();
    const meta = await ingestRelease(join(source, 'codepo_gb.zip'), paths.gazetteerDir, 'live');
    ingestMs = Date.now() - started;
    console.log(
      `postcodes: ${meta.count} (${meta.withoutLocation} without location), ingest ${ingestMs} ms, ` +
        `${(statSync(join(paths.gazetteerDir, 'postcodes.sqlite')).size / 1048576).toFixed(1)} MB`,
    );
    search = createSearchService({ paths });
  }, 300_000);

  afterAll(() => {
    closePlacesDb();
    closePostcodesDb();
    rmSync(root, { recursive: true, force: true });
  });

  it('answers every keystroke within 100 ms', () => {
    const typed = ['SK17 6AA', 'Spring Gardens', '63 Spring Gardens', 'Macclesfield', 'Cat and Fiddle', 'DE45 1', 'st johns rd'];
    let worst = 0;
    for (const phrase of typed) {
      for (let length = 1; length <= phrase.length; length += 1) {
        const started = performance.now();
        search.search(phrase.slice(0, length), BUXTON, 20);
        worst = Math.max(worst, performance.now() - started);
      }
    }
    console.log(`worst keystroke: ${worst.toFixed(1)} ms`);
    expect(worst).toBeLessThan(100);
  });
});
