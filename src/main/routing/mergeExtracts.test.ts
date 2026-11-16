import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mergeExtracts } from './mergeExtracts';

/**
 * The real `trailrt-osm merge` on small hand-written extracts. Skipped when the
 * tool is absent, as `resources/valhalla/` is a build artefact. ADR 0023.
 *
 * The output is read back through `trailrt-osm places`, the tool's other half,
 * so the test needs nothing else installed.
 */

const TOOL = resolve('resources/valhalla/bin/trailrt-osm');

function osm(nodes: readonly string[]): string {
  return `<?xml version='1.0' encoding='UTF-8'?>\n<osm version="0.6">\n${nodes.join('\n')}\n</osm>\n`;
}

function hotel(id: number, version: number, name: string): string {
  return (
    `  <node id="${String(id)}" version="${String(version)}" lat="53.26" lon="-1.91">` +
    `<tag k="tourism" v="hotel"/><tag k="name" v="${name}"/></node>`
  );
}

function hotels(file: string): { id: number; name: string }[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const properties = (JSON.parse(line) as { properties: Record<string, string | number> }).properties;
      return { id: Number(properties['@id']), name: String(properties.name) };
    });
}

describe.skipIf(!existsSync(TOOL))('trailrt-osm merge, for real', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'trailrt-merge-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps each object once, at its newest version, in order', async () => {
    // Two overlapping counties downloaded on different days: node 2 is in
    // both, and the second has a newer edit of it.
    const a = join(dir, 'a.osm');
    const b = join(dir, 'b.osm');
    writeFileSync(a, osm([hotel(1, 1, 'West'), hotel(2, 3, 'Old name'), hotel(4, 1, 'Shared')]));
    writeFileSync(b, osm([hotel(2, 4, 'New name'), hotel(3, 1, 'East'), hotel(4, 1, 'Shared')]));
    const merged = join(dir, 'merged.osm.pbf');

    await mergeExtracts(TOOL, [a, b], merged);

    const exported = join(dir, 'merged.geojsonseq');
    const read = spawnSync(TOOL, ['places', merged, exported, 'n/tourism=hotel'], { encoding: 'utf8' });
    expect(read.status).toBe(0);
    expect(hotels(exported)).toEqual([
      { id: 1, name: 'West' },
      { id: 2, name: 'New name' },
      { id: 3, name: 'East' },
      { id: 4, name: 'Shared' },
    ]);
  });

  it('refuses an unsorted extract rather than writing a broken one', async () => {
    const unsorted = join(dir, 'unsorted.osm');
    writeFileSync(unsorted, osm([hotel(9, 1, 'Later'), hotel(5, 1, 'Earlier')]));
    const other = join(dir, 'other.osm');
    writeFileSync(other, osm([hotel(1, 1, 'Fine')]));

    await expect(mergeExtracts(TOOL, [unsorted, other], join(dir, 'never.osm.pbf'))).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      detail: expect.stringContaining('not sorted') as unknown,
    });
  });

  it('refuses a filter expression it does not understand', () => {
    const input = join(dir, 'one.osm');
    writeFileSync(input, osm([hotel(1, 1, 'Only')]));
    const run = spawnSync(TOOL, ['places', input, join(dir, 'x.geojsonseq'), 'nwr/name=*Hotel'], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('unsupported expression');
  });
});
