import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ServiceError } from '../services/errors';
import type { EmbeddedPaths } from '../routing/embedded';
import { extractPlaces, readDataDate } from './extract';
import { ingestPlaces, type IngestRegion, type IngestStats } from './ingest';
import { closePlacesDb, deletePlaces, placesFile } from './store';

/**
 * Builds `places.sqlite` from the extract a routing graph was just built from.
 * Phase 10 design §5.1, ADR 0019 §4.
 *
 * Runs after the graph build, from the same file, before the region pipeline
 * deletes it. Written to a temporary file and moved into place only when
 * complete, so a reader never sees half a snapshot.
 */

export interface BuildPlacesInput {
  paths: EmbeddedPaths;
  /** The original extracts, which carry the OSM data date the merge loses. */
  sources: readonly string[];
  /** The file the graph was built from: the single extract, or the merge. */
  extract: string;
  regions: readonly IngestRegion[];
  regionName: string;
  signal?: AbortSignal;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function buildPlaces(input: BuildPlacesInput): Promise<IngestStats> {
  const tool = input.paths.mergeTool;
  if (!existsSync(tool)) {
    throw new ServiceError(
      'PROVIDER_UNAVAILABLE',
      'This build cannot read place data, because the bundled map tool is missing.',
    );
  }

  // The oldest source decides: a POI list is as old as its stalest county.
  const dates = await Promise.all(input.sources.map((source) => readDataDate(tool, source, input.signal)));
  const known = dates.filter((date): date is string => date !== null).toSorted();
  const dataDate = known[0] ?? today();

  const workDir = join(input.paths.downloadDir, 'places-work');
  const target = placesFile(input.paths);
  const staging = `${target}.incoming`;

  try {
    const geojson = await extractPlaces(tool, input.extract, workDir, input.signal);
    const stats = await ingestPlaces(geojson, staging, {
      regionName: input.regionName,
      regions: input.regions,
      dataDate,
      dateIsDownload: known.length === 0,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    closePlacesDb();
    renameSync(staging, target);
    return stats;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(staging, { force: true });
  }
}

/**
 * Builds place data after a graph build, turning a failure into a warning.
 *
 * Routing is what the user asked for, and it worked, so a place failure does
 * not fail the job. The previous snapshot described the previous graph, so it
 * is removed: search and POIs then say place data is missing and offer a
 * rebuild, rather than answering from the wrong regions.
 */
export async function buildPlacesOrWarn(input: BuildPlacesInput): Promise<string | null> {
  try {
    await buildPlaces(input);
    return null;
  } catch (error) {
    deletePlaces(input.paths);
    if (error instanceof ServiceError && error.code === 'CANCELLED') {
      return 'Place data was not built because the job was cancelled. Rebuild your regions to search places and find POIs.';
    }
    const reason = error instanceof Error ? error.message : String(error);
    return `Routing is ready, but place data could not be built: ${reason}`;
  }
}
