import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import JSZip from 'jszip';
import { it } from 'vitest';
import { ingestPlaces } from '../../src/main/places/ingest';
import { ingestRelease } from '../../src/main/places/postcodes';
import { parseIndex } from '../../src/main/routing/geofabrik';

/**
 * Writes `valhalla/places.sqlite` and `gazetteer/postcodes.sqlite` under
 * TRAILRT_SEED_DIR, built from `test-data/places-excerpt/` and
 * `test-data/codepoint/`, exactly as the app builds them from real downloads.
 */

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

it('builds the seed', async () => {
  const out = process.env.TRAILRT_SEED_DIR;
  if (out === undefined || out.length === 0) throw new Error('TRAILRT_SEED_DIR is not set');

  mkdirSync(join(out, 'valhalla'), { recursive: true });
  const index = parseIndex(readFileSync(resolve('test-data/geofabrik-uk.json'), 'utf8'));
  const derbyshire = index.find((region) => region.id === 'derbyshire');
  if (derbyshire === undefined) throw new Error('no Derbyshire in the index fixture');
  await ingestPlaces(resolve('test-data/places-excerpt/buxton.geojsonseq'), join(out, 'valhalla', 'places.sqlite'), {
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
  const zipPath = join(out, 'codepo.zip');
  writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
  await ingestRelease(zipPath, join(out, 'gazetteer'), '2026-11');
});
