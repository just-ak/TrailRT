import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { LatLon } from '@shared/geo/distance';
import { hgtSize, sampleHgt, tileNameFor, tileOrigin } from '@shared/geo/hgt';
import { ServiceError } from '../services/errors';

/**
 * Terrain tiles: download, cache, and height lookup. ADR 0018.
 *
 * Heights come from the open **Terrain Tiles** dataset on the AWS Registry of
 * Open Data, in its `skadi` layout: one gzipped SRTM-style HGT file per degree
 * square. About 7 MB each compressed and 26 MB unpacked, so they are kept
 * **gzipped** on disk — a county needs one to four of them — and unpacked into
 * memory only when sampled, with a small LRU so a long route does not hold a
 * whole country in RAM.
 *
 * Terrain heights are a derived value. Nothing here writes to a route or a
 * track; the profile asks for heights when it is drawn and throws them away.
 */

/** The only host this module talks to. Main process only; the renderer CSP is untouched. */
export const TERRAIN_HOST = 'elevation-tiles-prod.s3.amazonaws.com';

/** Typical compressed size of a 1″ tile over land, for "about N MB" before a download. */
export const APPROX_TILE_BYTES = 7.5 * 1024 * 1024;

/** Unpacked tiles held in memory. Four 1″ tiles is about 100 MB. */
const DEFAULT_CACHE_TILES = 4;

const USER_AGENT = 'TrailRT/0.1.0 (+https://github.com/trailrt/trailrt)';

export function tileUrl(name: string): string {
  // The directory is the latitude part of the name: skadi/N53/N53W002.hgt.gz.
  return `https://${TERRAIN_HOST}/skadi/${name.slice(0, 3)}/${name}.hgt.gz`;
}

export interface TerrainSource {
  /**
   * Heights for each point, null where unknown. `missingTiles` names tiles that
   * would answer but are not downloaded — distinct from open sea, where there
   * is no tile to download and the height is simply null.
   */
  elevations(points: readonly LatLon[]): {
    values: (number | null)[];
    missingTiles: string[];
  };
}

export interface TerrainDownloadProgress {
  done: number;
  total: number;
}

export interface TerrainDownloadOutcome {
  downloaded: string[];
  /** Tiles the dataset has no file for: open sea. Recorded so they are not asked for again. */
  sea: string[];
  /** Tiles that failed for any other reason. Retried next time. */
  failed: string[];
}

export interface TerrainStore extends TerrainSource {
  /** Which of these tiles still need downloading. */
  missing(names: readonly string[]): string[];
  download(
    names: readonly string[],
    options?: {
      onProgress?: (progress: TerrainDownloadProgress) => void;
      signal?: AbortSignal;
    },
  ): Promise<TerrainDownloadOutcome>;
}

interface LoadedTile {
  view: DataView;
  size: number;
  origin: { lat: number; lon: number };
}

/**
 * Creates a store over a directory.
 *
 * `fetchImpl` is injectable so the download path is testable without a
 * network: the tests serve a synthetic tile and a 403 for open sea.
 */
export function createTerrainStore(
  dir: string,
  options: { fetchImpl?: typeof fetch; cacheTiles?: number } = {},
): TerrainStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheTiles = options.cacheTiles ?? DEFAULT_CACHE_TILES;
  /** Insertion-ordered, so the first key is the least recently used. */
  const cache = new Map<string, LoadedTile>();

  const gzPath = (name: string): string => join(dir, `${name}.hgt.gz`);
  const seaPath = (name: string): string => join(dir, `${name}.none`);
  const isSea = (name: string): boolean => existsSync(seaPath(name));
  const isPresent = (name: string): boolean => existsSync(gzPath(name));

  function load(name: string): LoadedTile | null {
    const hit = cache.get(name);
    if (hit !== undefined) {
      cache.delete(name);
      cache.set(name, hit);
      return hit;
    }
    const origin = tileOrigin(name);
    if (origin === null || !isPresent(name)) return null;

    let bytes: Buffer;
    try {
      bytes = gunzipSync(readFileSync(gzPath(name)));
    } catch {
      // A corrupt file is removed so the next download replaces it, rather
      // than leaving a tile that silently answers nothing forever.
      rmSync(gzPath(name), { force: true });
      return null;
    }
    const size = hgtSize(bytes.byteLength);
    if (size === null) {
      rmSync(gzPath(name), { force: true });
      return null;
    }

    const tile: LoadedTile = {
      view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      size,
      origin,
    };
    cache.set(name, tile);
    while (cache.size > cacheTiles) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return tile;
  }

  return {
    elevations(points) {
      const missing = new Set<string>();
      // Resolved once per tile per call, not once per point: a long recording
      // is hundreds of thousands of points over a handful of tiles, and a disk
      // check per point would cost more than the sampling.
      // Loaded tiles are not held here — they go through the LRU, whose hit
      // path is two Map operations — so a route crossing many tiles still
      // keeps at most `cacheTiles` unpacked in memory.
      const absent = new Map<string, 'sea' | 'missing'>();
      const resolve = (name: string): LoadedTile | 'sea' | 'missing' => {
        const known = absent.get(name);
        if (known !== undefined) return known;
        if (isSea(name)) {
          absent.set(name, 'sea');
          return 'sea';
        }
        const tile = load(name);
        if (tile === null) {
          absent.set(name, 'missing');
          return 'missing';
        }
        return tile;
      };

      const values = points.map((point) => {
        const name = tileNameFor(point.lat, point.lon);
        const tile = resolve(name);
        if (tile === 'sea') return null;
        if (tile === 'missing') {
          missing.add(name);
          return null;
        }
        return sampleHgt(tile.view, tile.size, tile.origin, point);
      });
      return { values, missingTiles: [...missing] };
    },

    missing(names) {
      return names.filter((name) => !isSea(name) && !isPresent(name));
    },

    async download(names, downloadOptions = {}) {
      const wanted = names.filter(
        (name) => tileOrigin(name) !== null && !isSea(name) && !isPresent(name),
      );
      const outcome: TerrainDownloadOutcome = { downloaded: [], sea: [], failed: [] };
      mkdirSync(dir, { recursive: true });

      for (const [index, name] of wanted.entries()) {
        downloadOptions.onProgress?.({ done: index, total: wanted.length });
        if (downloadOptions.signal?.aborted === true) {
          throw new ServiceError('CANCELLED', 'The terrain download was cancelled.');
        }

        let response: Response;
        try {
          response = await fetchImpl(tileUrl(name), {
            // S3 serves these directly. A redirect would mean the bucket moved,
            // and following it would let the response decide where we fetch from.
            redirect: 'error',
            credentials: 'omit',
            headers: { 'User-Agent': USER_AGENT },
            ...(downloadOptions.signal === undefined
              ? {}
              : { signal: downloadOptions.signal }),
          });
        } catch {
          outcome.failed.push(name);
          continue;
        }

        // The bucket answers 403 for a key that does not exist, which for this
        // dataset means a square with no land in it.
        if (response.status === 403 || response.status === 404) {
          writeFileSync(seaPath(name), '', 'utf8');
          outcome.sea.push(name);
          continue;
        }
        if (!response.ok) {
          outcome.failed.push(name);
          continue;
        }

        const gz = Buffer.from(await response.arrayBuffer());
        let valid = false;
        try {
          valid = hgtSize(gunzipSync(gz).byteLength) !== null;
        } catch {
          valid = false;
        }
        if (!valid) {
          outcome.failed.push(name);
          continue;
        }

        // Written aside and renamed, so a half-written file never sits under
        // the name the lookup trusts.
        const temp = `${gzPath(name)}.part`;
        writeFileSync(temp, gz);
        renameSync(temp, gzPath(name));
        outcome.downloaded.push(name);
      }

      downloadOptions.onProgress?.({ done: wanted.length, total: wanted.length });
      return outcome;
    },
  };
}
