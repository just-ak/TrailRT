import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUXTON } from '@fixtures/places';
import { createTerrainStore, tileUrl } from './terrainStore';

/**
 * A synthetic 1201 × 1201 tile (the 3″ size, a third of the memory of a 1″
 * one) where every sample is 300 m, so any lookup inside it reads 300.
 */
function flatTile(height: number): Buffer {
  const size = 1201;
  const bytes = Buffer.alloc(size * size * 2);
  for (let i = 0; i < size * size; i += 1) bytes.writeInt16BE(height, i * 2);
  return gzipSync(bytes);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-terrain-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const route = routes[url];
    return route === undefined ? new Response('', { status: 500 }) : route();
  }) as typeof fetch;
}

describe('terrain store', () => {
  it('names the S3 key the way the dataset lays it out', () => {
    expect(tileUrl('N53W002')).toBe(
      'https://elevation-tiles-prod.s3.amazonaws.com/skadi/N53/N53W002.hgt.gz',
    );
  });

  it('reports missing tiles rather than inventing heights', () => {
    const store = createTerrainStore(dir);
    const { values, missingTiles } = store.elevations([BUXTON]);
    expect(values).toEqual([null]);
    expect(missingTiles).toEqual(['N53W002']);
  });

  it('downloads, validates and then samples a tile', async () => {
    const store = createTerrainStore(dir, {
      fetchImpl: fakeFetch({
        [tileUrl('N53W002')]: () => new Response(flatTile(300)),
      }),
    });
    const outcome = await store.download(['N53W002']);
    expect(outcome.downloaded).toEqual(['N53W002']);
    expect(store.missing(['N53W002'])).toEqual([]);
    expect(store.elevations([BUXTON]).values[0]).toBe(300);
  });

  it('records open sea once and does not ask again', async () => {
    let calls = 0;
    const store = createTerrainStore(dir, {
      fetchImpl: fakeFetch({
        [tileUrl('N55W012')]: () => {
          calls += 1;
          return new Response('AccessDenied', { status: 403 });
        },
      }),
    });
    expect((await store.download(['N55W012'])).sea).toEqual(['N55W012']);
    await store.download(['N55W012']);
    expect(calls).toBe(1);
    // A point at sea is a gap, and not reported as something to download.
    const atSea = store.elevations([{ lat: 55.5, lon: -11.5 }]);
    expect(atSea.values).toEqual([null]);
    expect(atSea.missingTiles).toEqual([]);
  });

  it('rejects a tile of the wrong size and caches nothing', async () => {
    const store = createTerrainStore(dir, {
      fetchImpl: fakeFetch({
        [tileUrl('N53W002')]: () => new Response(gzipSync(Buffer.alloc(1000))),
      }),
    });
    const outcome = await store.download(['N53W002']);
    expect(outcome.failed).toEqual(['N53W002']);
    expect(existsSync(join(dir, 'N53W002.hgt.gz'))).toBe(false);
  });

  it('removes a corrupt cached tile so it can be fetched again', () => {
    writeFileSync(join(dir, 'N53W002.hgt.gz'), 'not gzip');
    const store = createTerrainStore(dir);
    const { missingTiles } = store.elevations([BUXTON]);
    expect(missingTiles).toEqual(['N53W002']);
    expect(existsSync(join(dir, 'N53W002.hgt.gz'))).toBe(false);
  });

  it('refuses a malformed tile name rather than building a path from it', async () => {
    let calls = 0;
    const store = createTerrainStore(dir, {
      fetchImpl: (async () => {
        calls += 1;
        return new Response('');
      }) as typeof fetch,
    });
    await store.download(['../../etc/passwd']);
    expect(calls).toBe(0);
  });
});
