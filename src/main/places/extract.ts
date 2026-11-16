import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { poiFilterExpressions } from '@shared/poi/categories';
import { PLACE_KINDS } from '@shared/search/PlaceSearchProvider';
import { ServiceError } from '../services/errors';
import { toolExitError } from '../routing/toolExit';

/**
 * Pulling place data out of an OpenStreetMap extract with the bundled
 * `trailrt-osm` (libosmium; ADR 0023). Phase 10 design §5.1.
 *
 * One one-shot child process, killable on cancel, like the merge step.
 * `trailrt-osm places` keeps POIs, settlements, named roads and addressed
 * buildings, and writes their geometry as GeoJSON lines, areas included, so a
 * hotel mapped as a building outline is not lost (Requirement 5.2). The file
 * is streamed by the ingest and then deleted.
 *
 * It replaced `osmium tags-filter` followed by `osmium export`, and writes the
 * same features those did for everything the filter selects — checked line by
 * line on the Derbyshire extract, and the ingest builds the same rows from
 * either. It leaves out what the filter does not select: tags-filter also
 * passed on every tagged node of a matching way, such as crossings, which the
 * ingest then discarded. On Derbyshire it takes 1.9 s and 130 MB, where the
 * filter alone peaked at 2.1 GB.
 *
 * The filter is generated from `shared/poi/categories.ts`, so the build and
 * the search classify with the same table.
 */

/** Every expression the place build filters by. */
export function placeFilters(): string[] {
  return [
    ...poiFilterExpressions(),
    `n/place=${PLACE_KINDS.join(',')}`,
    // All highways: the name test happens at ingest, because tags-filter
    // cannot express "has a name" together with "is a highway".
    'w/highway',
    'nwr/addr:housenumber',
  ];
}

function runTool(tool: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let tail = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out = `${out}${chunk.toString('utf8')}`.slice(-100_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      tail = `${tail}${chunk.toString('utf8')}`.slice(-1500);
    });

    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (cause) => {
      signal?.removeEventListener('abort', onAbort);
      reject(
        new ServiceError(
          'PROVIDER_UNAVAILABLE',
          'The tool that reads place data could not be started. This build may be missing it.',
          cause.message,
        ),
      );
    });

    child.on('close', (code, killed) => {
      signal?.removeEventListener('abort', onAbort);
      const failure = toolExitError(
        { code, signal: killed, aborted: signal?.aborted === true },
        {
          cancelled: 'Reading place data was cancelled.',
          failed: 'Place data could not be read from the map extract.',
          name: 'The place reader',
        },
        `trailrt-osm ${args[0] ?? ''} exited ${String(code)}: ${tail.trim()}`,
      );
      if (failure !== null) {
        reject(failure);
        return;
      }
      resolve(out);
    });
  });
}

/**
 * The date of the OSM data in an extract, `YYYY-MM-DD`, from its PBF header.
 *
 * Read from each **source** extract: the merge does not carry the timestamp
 * into its output, so the merged file has none. Null when the header has no
 * timestamp, which is true of some hand-made extracts.
 */
export async function readDataDate(tool: string, extract: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const out = await runTool(tool, ['data-date', extract], signal);
    const match = /^(\d{4}-\d{2}-\d{2})T/.exec(out.trim());
    return match?.[1] ?? null;
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'CANCELLED') throw error;
    return null;
  }
}

/** Filters and exports an extract in one pass. Returns the path of the GeoJSON lines file. */
export async function extractPlaces(
  tool: string,
  extract: string,
  workDir: string,
  signal?: AbortSignal,
): Promise<string> {
  mkdirSync(workDir, { recursive: true });
  const exported = join(workDir, 'places.geojsonseq');
  // Each feature carries its element type and id, so a POI can say where it
  // came from (Req 8.3).
  await runTool(tool, ['places', extract, exported, ...placeFilters()], signal);
  return exported;
}
