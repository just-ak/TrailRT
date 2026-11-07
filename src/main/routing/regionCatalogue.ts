import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoundingBox } from '@shared/geo/polygon';
import type {
  LoadedRegion,
  RegionCandidate,
  RegionJobProgress,
} from '@shared/routing/results';
import { ServiceError } from '../services/errors';
import type { EmbeddedPaths } from './embedded';
import {
  downloadExtract,
  downloadIndex,
  findRegion,
  INDEX_TTL_MS,
  MAX_REGION_BYTES,
  parseIndex,
  rankRegions,
  regionSize,
  type ParsedRegion,
} from './geofabrik';
import { importRegion } from './regionImport';

/**
 * Finding, fetching and building a map region for the embedded engine.
 *
 * Sits between the Geofabrik index (`geofabrik.ts`, which knows the wire
 * format) and the tile builder (`regionImport.ts`, which knows the graph), so
 * neither has to know about the other.
 *
 * The point of all of it is that a user should not have to understand
 * OpenStreetMap distribution to get routing working. They look at the map,
 * press a button, and pick from a short list of real options with real sizes.
 */

/** Parsed index, held for the process lifetime — 554 polygons is not cheap to re-parse. */
let cached: { regions: ParsedRegion[]; loadedAt: number } | null = null;

export function resetCatalogue(): void {
  cached = null;
}

/**
 * The region index, from cache when it is fresh enough.
 *
 * Two layers: a parsed copy in memory for repeated ranking within a session,
 * and the raw JSON on disk so a restart does not re-download 3.6 MB. The disk
 * copy is used even when stale if the network fails, because a week-old index
 * is far better than no region picker at all.
 */
export async function loadCatalogue(
  paths: EmbeddedPaths,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
): Promise<ParsedRegion[]> {
  if (cached !== null && options.forceRefresh !== true) return cached.regions;

  const fresh =
    !options.forceRefresh &&
    existsSync(paths.indexFile) &&
    Date.now() - statSync(paths.indexFile).mtimeMs < INDEX_TTL_MS;

  if (fresh) {
    try {
      const regions = parseIndex(readFileSync(paths.indexFile, 'utf8'));
      cached = { regions, loadedAt: Date.now() };
      return regions;
    } catch {
      // Corrupt cache, fall through and re-download rather than fail.
    }
  }

  let raw: string;
  try {
    raw = await downloadIndex(options.signal);
  } catch (cause) {
    // Offline with a stale copy is a perfectly good position to be in.
    if (existsSync(paths.indexFile)) {
      try {
        const regions = parseIndex(readFileSync(paths.indexFile, 'utf8'));
        cached = { regions, loadedAt: Date.now() };
        return regions;
      } catch {
        /* unusable cache; report the original failure */
      }
    }
    throw cause instanceof ServiceError
      ? cause
      : new ServiceError(
          'PROVIDER_UNAVAILABLE',
          'The list of downloadable regions could not be fetched. Check your connection, or import a .osm.pbf file instead.',
        );
  }

  const regions = parseIndex(raw);
  mkdirSync(join(paths.indexFile, '..'), { recursive: true });
  writeFileSync(paths.indexFile, raw, 'utf8');
  cached = { regions, loadedAt: Date.now() };
  return regions;
}

/**
 * Candidate extracts for a viewport, with their download sizes.
 *
 * Sizes are fetched concurrently because each is a HEAD request with a
 * redirect to follow, and doing six sequentially would add a visible pause to
 * opening the picker. A size that cannot be determined stays null rather than
 * excluding the region.
 */
export async function suggestRegions(
  paths: EmbeddedPaths,
  viewport: BoundingBox,
  options: { signal?: AbortSignal } = {},
): Promise<RegionCandidate[]> {
  const regions = await loadCatalogue(paths, options);
  const ranked = rankRegions(regions, viewport);

  if (ranked.length === 0) {
    throw new ServiceError(
      'NOT_FOUND',
      'No downloadable region covers the centre of the visible map. Pan to land, or import a .osm.pbf file.',
    );
  }

  const sizes = await Promise.all(
    ranked.map((candidate) =>
      regionSize(findRegion(regions, candidate.id).pbfUrl, options.signal),
    ),
  );

  return ranked.map((candidate, index) => {
    const sizeBytes = sizes[index] ?? null;
    return {
      ...candidate,
      sizeBytes,
      // Known to be too big. An unknown size is not marked: refusing a region
      // because a server omitted a header would block a download that might
      // have been fine, and `downloadExtract` checks again anyway.
      tooLarge: sizeBytes !== null && sizeBytes > MAX_REGION_BYTES,
    };
  });
}

/**
 * Downloads a region and builds a graph from it.
 *
 * The extract is deleted afterwards. It is the raw input, often several times
 * the size of the graph it produces, and keeping it would mean every user
 * silently carrying a few hundred megabytes they have no use for. Re-importing
 * means re-downloading, which is the right trade for disk.
 */
export async function downloadAndBuild(
  paths: EmbeddedPaths,
  regionId: string,
  options: {
    onProgress?: (progress: RegionJobProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<LoadedRegion> {
  const regions = await loadCatalogue(paths, options);
  const region = findRegion(regions, regionId);

  mkdirSync(paths.downloadDir, { recursive: true });
  const extractPath = join(paths.downloadDir, `${region.id}.osm.pbf`);

  try {
    options.onProgress?.({
      phase: 'downloading',
      receivedBytes: 0,
      totalBytes: null,
      stage: null,
    });

    await downloadExtract(region.pbfUrl, extractPath, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onProgress: ({ receivedBytes, totalBytes }) =>
        options.onProgress?.({
          phase: 'downloading',
          receivedBytes,
          totalBytes,
          stage: null,
        }),
    });

    const result = await importRegion({
      paths,
      extractPath,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onProgress: ({ stage }) =>
        options.onProgress?.({
          phase: 'building',
          receivedBytes: null,
          totalBytes: null,
          stage,
        }),
    });

    // The region's published name reads better than a filename, and it is what
    // the user picked from the list.
    return { ...result, regionName: region.name };
  } finally {
    // Always, including on failure or cancellation: a partial download is
    // useless and would otherwise sit in the user's data directory forever.
    rmSync(extractPath, { force: true });
  }
}
