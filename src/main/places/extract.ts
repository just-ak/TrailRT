import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { osmiumPoiFilters } from '@shared/poi/categories';
import { PLACE_KINDS } from '@shared/search/PlaceSearchProvider';
import { ServiceError } from '../services/errors';
import { toolExitError } from '../routing/toolExit';

/**
 * Pulling place data out of an OpenStreetMap extract with the bundled
 * `osmium`. Phase 10 design §5.1.
 *
 * Two one-shot child processes, killable on cancel, like the merge step:
 *
 * 1. `osmium tags-filter` keeps POIs, settlements, named roads and addressed
 *    buildings: 113 MB → 47 MB for the three Buxton counties, in 1.6 s.
 * 2. `osmium export -f geojsonseq` builds their geometry, areas included, so a
 *    hotel mapped as a building outline is not lost (Requirement 5.2). 4.1 s,
 *    1.2 M features. The file is streamed by the ingest and then deleted.
 *
 * The filter is generated from `shared/poi/categories.ts`, so the build and
 * the search classify with the same table.
 */

/** Every expression the place build filters by. */
export function placeFilters(): string[] {
  return [
    ...osmiumPoiFilters(),
    `n/place=${PLACE_KINDS.join(',')}`,
    // All highways: the name test happens at ingest, because tags-filter
    // cannot express "has a name" together with "is a highway".
    'w/highway',
    'nwr/addr:housenumber',
  ];
}

function runOsmium(tool: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
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
        `osmium ${args[0] ?? ''} exited ${String(code)}: ${tail.trim()}`,
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
 * Read from each **source** extract: `osmium merge` does not carry the
 * timestamp into its output (measured), so the merged file has none. Null when
 * the header has no timestamp, which is true of some hand-made extracts.
 */
export async function readDataDate(tool: string, extract: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const out = await runOsmium(
      tool,
      ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', extract],
      signal,
    );
    const match = /^(\d{4}-\d{2}-\d{2})T/.exec(out.trim());
    return match?.[1] ?? null;
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'CANCELLED') throw error;
    return null;
  }
}

/** Filters and exports an extract. Returns the path of the GeoJSON lines file. */
export async function extractPlaces(
  tool: string,
  extract: string,
  workDir: string,
  signal?: AbortSignal,
): Promise<string> {
  mkdirSync(workDir, { recursive: true });
  const filtered = join(workDir, 'places.osm.pbf');
  const exported = join(workDir, 'places.geojsonseq');

  await runOsmium(
    tool,
    ['tags-filter', extract, ...placeFilters(), '-o', filtered, '--overwrite', '--no-progress'],
    signal,
  );
  await runOsmium(
    tool,
    [
      'export',
      filtered,
      '-f',
      'geojsonseq',
      // Element type and id, so a POI can say where it came from (Req 8.3).
      '-a',
      'type,id',
      '-o',
      exported,
      '--overwrite',
      '--no-progress',
    ],
    signal,
  );
  return exported;
}
