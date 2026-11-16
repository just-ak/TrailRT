import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoundingBox } from '@shared/geo/polygon';
import { tilesCovering } from '@shared/geo/hgt';
import type {
  LoadedRegion,
  RegionCandidate,
  RegionJobProgress,
  RegionMapEntry,
  RegionSize,
} from '@shared/routing/results';
import { buildPlacesOrWarn } from '../places/build';
import { ServiceError } from '../services/errors';
import type { TerrainStore } from '../terrain/terrainStore';
import { mergeToolPresent, readLoadedRegion, type EmbeddedPaths } from './embedded';
import {
  downloadExtract,
  downloadIndex,
  findRegion,
  INDEX_TTL_MS,
  joinRegionNames,
  MAX_REGION_BYTES,
  parseIndex,
  rankRegions,
  regionSize,
  ukRegions,
  type ParsedRegion,
} from './geofabrik';
import { mergeExtracts } from './mergeExtracts';
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

/**
 * Download sizes, for the session. A HEAD per region is cheap but not free, and
 * the picker asks again every time the selection changes.
 */
const sizeCache = new Map<string, number | null>();

export function resetCatalogue(): void {
  cached = null;
  sizeCache.clear();
}

async function sizeOf(
  region: ParsedRegion,
  signal: AbortSignal | undefined,
  size: typeof regionSize,
): Promise<number | null> {
  if (sizeCache.has(region.id)) return sizeCache.get(region.id) ?? null;
  const bytes = await size(region.pbfUrl, signal);
  // Only a known size is remembered; an unknown one is worth asking again.
  if (bytes !== null) sizeCache.set(region.id, bytes);
  return bytes;
}

/** The UK regions for the picker's map, with the loaded ones marked. */
export async function regionMap(
  paths: EmbeddedPaths,
  options: { signal?: AbortSignal } = {},
): Promise<RegionMapEntry[]> {
  const regions = await loadCatalogue(paths, options);
  const loaded = new Set(readLoadedRegion(paths)?.regionIds ?? []);
  return ukRegions(regions, loaded);
}

/** Sizes for a selection, fetched concurrently. Unknown stays null. */
export async function regionSizes(
  paths: EmbeddedPaths,
  regionIds: readonly string[],
  options: { signal?: AbortSignal } = {},
): Promise<RegionSize[]> {
  const regions = await loadCatalogue(paths, options);
  return Promise.all(
    regionIds.map(async (id) => ({
      id,
      sizeBytes: await sizeOf(findRegion(regions, id), options.signal, regionSize),
    })),
  );
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

/** The steps of a download, injectable so the orchestration is testable offline. */
export interface BuildSteps {
  size: typeof regionSize;
  download: typeof downloadExtract;
  merge: typeof mergeExtracts;
  build: typeof importRegion;
  mergeAvailable: (paths: EmbeddedPaths) => boolean;
  /** Phase 10: POIs and place names from the same extract. Returns a warning or null. */
  places: typeof buildPlacesOrWarn;
  /** Phase 14: a downloaded extract still fresh enough to reuse, by its size; null to download. */
  cached: (path: string, now: number) => number | null;
}

/**
 * How long a downloaded region is reused before it is fetched again.
 * Geofabrik refreshes its extracts daily; a month-old one still has the same
 * roads for all but the newest. Phase 14 Requirement 17.1.
 */
export const EXTRACT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** A complete, recent download under its final name, or null. */
export function cachedExtract(path: string, now: number): number | null {
  try {
    const info = statSync(path);
    return info.isFile() && info.size > 0 && now - info.mtimeMs < EXTRACT_MAX_AGE_MS ? info.size : null;
  } catch {
    return null;
  }
}

/** Removes downloads too old to reuse, and any half-written ones. */
function pruneDownloads(dir: string, now: number): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const file = join(dir, name);
    if (name.endsWith('.part') || (name.endsWith('.osm.pbf') && cachedExtract(file, now) === null)) rmSync(file, { force: true });
  }
}

const REAL_STEPS: BuildSteps = {
  size: regionSize,
  download: downloadExtract,
  merge: mergeExtracts,
  build: importRegion,
  mergeAvailable: mergeToolPresent,
  places: buildPlacesOrWarn,
  cached: cachedExtract,
};

/**
 * Downloads regions, merges them when there are several, and builds one graph.
 *
 * Downloading and building are separate steps (Phase 14 Requirement 17.1).
 * Each extract is kept after the build and reused for 30 days, so a build that
 * fails runs again without downloading, and changing the selection downloads
 * only the regions not already here. Until then they were deleted after every
 * build, to save disk; the trade is a few hundred megabytes for not fetching
 * them again. Older downloads are removed when the next job starts.
 *
 * Terrain tiles for the regions are fetched last, and a failure there does not
 * fail the build: the graph is what the user asked for, and a profile can fetch
 * its tiles later. ADR 0018.
 */
export async function downloadAndBuild(
  paths: EmbeddedPaths,
  regionIds: readonly string[],
  options: {
    onProgress?: (progress: RegionJobProgress) => void;
    signal?: AbortSignal;
    terrain?: TerrainStore | null;
    steps?: Partial<BuildSteps>;
  } = {},
): Promise<LoadedRegion> {
  const steps: BuildSteps = { ...REAL_STEPS, ...options.steps };
  const signal = options.signal;
  const withSignal = signal === undefined ? {} : { signal };

  if (regionIds.length === 0) {
    throw new ServiceError('INVALID_REQUEST', 'Choose at least one region.');
  }

  const catalogue = await loadCatalogue(paths, withSignal);
  const chosen = regionIds.map((id) => findRegion(catalogue, id));

  if (chosen.length > 1 && !steps.mergeAvailable(paths)) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'This build cannot combine regions into one map. Choose a single region.',
    );
  }

  // Refused before a byte is downloaded. An unknown size is not counted
  // against the limit; `downloadExtract` checks each file again as it arrives.
  const known = await Promise.all(chosen.map((region) => sizeOf(region, signal, steps.size)));
  const total = known.reduce<number>((sum, bytes) => sum + (bytes ?? 0), 0);
  if (total > MAX_REGION_BYTES) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `That selection is ${(total / 1024 ** 3).toFixed(1)} GB. TrailRT builds up to ${MAX_REGION_BYTES / 1024 ** 3} GB at once — choose fewer regions.`,
    );
  }

  mkdirSync(paths.downloadDir, { recursive: true });
  pruneDownloads(paths.downloadDir, Date.now());
  const extracts = chosen.map((region) => join(paths.downloadDir, `${region.id}.osm.pbf`));
  const merged = join(paths.downloadDir, 'merged.osm.pbf');

  try {
    for (const [index, region] of chosen.entries()) {
      const report = (receivedBytes: number, totalBytes: number | null): void =>
        options.onProgress?.({
          phase: 'downloading',
          receivedBytes,
          totalBytes,
          stage: null,
          regionIndex: index + 1,
          regionCount: chosen.length,
          regionName: region.name,
        });
      // Downloading and building are separate steps (Requirement 17.1): a
      // region downloaded before is reused, so a build that fails is run
      // again without downloading anything.
      const kept = steps.cached(extracts[index] ?? '', Date.now());
      if (kept !== null) {
        options.onProgress?.({
          phase: 'downloading',
          receivedBytes: kept,
          totalBytes: kept,
          stage: null,
          regionIndex: index + 1,
          regionCount: chosen.length,
          regionName: region.name,
          cached: true,
        });
        continue;
      }
      report(0, null);
      await steps.download(region.pbfUrl, extracts[index] ?? '', {
        ...withSignal,
        onProgress: ({ receivedBytes, totalBytes }) => report(receivedBytes, totalBytes),
      });
    }

    let source = extracts[0] ?? '';
    if (extracts.length > 1) {
      options.onProgress?.({
        phase: 'merging',
        receivedBytes: null,
        totalBytes: null,
        stage: null,
      });
      await steps.merge(paths.osmTool, extracts, merged, withSignal);
      source = merged;
    }

    const result = await steps.build({
      paths,
      extractPath: source,
      ...withSignal,
      onProgress: ({ stage }) =>
        options.onProgress?.({
          phase: 'building',
          receivedBytes: null,
          totalBytes: null,
          stage,
        }),
    });

    const names = chosen.map((region) => region.name);

    // Before the extracts are deleted in `finally`: this is the only moment
    // the POIs and place names exist on this machine. Design §5.1.
    options.onProgress?.({
      phase: 'building',
      receivedBytes: null,
      totalBytes: null,
      stage: 'Reading places',
    });
    const placesWarning = await steps.places({
      paths,
      sources: extracts,
      extract: source,
      regions: chosen.map((region) => ({ name: region.name, rings: region.rings })),
      regionName: joinRegionNames(names),
      ...withSignal,
    });

    let terrainWarning: string | null = null;
    if (options.terrain !== undefined && options.terrain !== null) {
      terrainWarning = await fetchTerrain(options.terrain, chosen, options);
    }

    return {
      ...result,
      // The regions' published names read better than a filename, and they
      // are what the user picked.
      regionName: joinRegionNames(names),
      regionIds: chosen.map((region) => region.id),
      terrainWarning,
      placesWarning,
    };
  } finally {
    // The merged file is remade in seconds, so it goes; the downloads stay to
    // be reused (Requirement 17.1). A half-written download never has the
    // final name, and `pruneDownloads` clears it and anything stale.
    rmSync(merged, { force: true });
    for (const file of extracts) rmSync(`${file}.part`, { force: true });
  }
}

/** Terrain for the regions' bounding boxes. Returns a warning, never throws. */
async function fetchTerrain(
  terrain: TerrainStore,
  regions: readonly ParsedRegion[],
  options: {
    onProgress?: (progress: RegionJobProgress) => void;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  const names = [...new Set(regions.flatMap((region) => tilesCovering(region.box)))];
  const wanted = terrain.missing(names);
  if (wanted.length === 0) return null;

  try {
    const outcome = await terrain.download(wanted, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onProgress: ({ done, total }) =>
        options.onProgress?.({
          phase: 'terrain',
          receivedBytes: null,
          totalBytes: null,
          stage: null,
          tilesDone: done,
          tileCount: total,
        }),
    });
    return outcome.failed.length === 0
      ? null
      : `${outcome.failed.length} of ${wanted.length} terrain tiles could not be downloaded. Profiles will offer to fetch them later.`;
  } catch (cause) {
    if (cause instanceof ServiceError && cause.code === 'CANCELLED') throw cause;
    return 'Terrain heights could not be downloaded. Profiles will offer to fetch them later.';
  }
}
