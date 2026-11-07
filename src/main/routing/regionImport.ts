import { spawn } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { ServiceError } from '../services/errors';
import {
  buildConfig,
  resetEmbeddedEngine,
  type EmbeddedPaths,
} from './embedded';

/**
 * Turning an OpenStreetMap extract into a routing graph.
 *
 * This is the one place the application runs a child process. `valhalla_build_tiles`
 * is a one-shot CLI invoked when a user imports a region, never while routing —
 * the engine itself is in-process (ADR 0013). So there is no daemon to
 * supervise, only a build that either finishes or does not.
 *
 * ## Why not do this in-process too
 *
 * Tile building is a batch job that memory-maps large temporary files and can
 * take minutes on a big extract. Running it inside the main process would block
 * or balloon the process the UI depends on. A child process can also be killed
 * cleanly if the user cancels, which is not true of a native call already in
 * flight.
 */

export interface RegionProgress {
  /** Coarse stage name, suitable for a progress line. */
  stage: string;
  /** 0-100 when known, otherwise null — most stages give no percentage. */
  percent: number | null;
}

export interface RegionResult {
  regionName: string;
  tileCount: number;
  builtAt: number;
  /** Bytes on disk for the finished graph. */
  graphBytes: number;
}

/**
 * Stage names, matched against Valhalla's log output.
 *
 * Deliberately coarse. Valhalla logs a great deal at INFO and most of it is
 * meaningless to a user; these are the phases that take long enough to be worth
 * naming. Anything unrecognised leaves the previous stage showing rather than
 * flickering through internals.
 */
const STAGES: readonly { match: RegExp; stage: string }[] = [
  { match: /parsing ways/i, stage: 'Reading roads' },
  { match: /parsing relations/i, stage: 'Reading relations' },
  { match: /parsing nodes/i, stage: 'Reading junctions' },
  { match: /constructing edges/i, stage: 'Building the road graph' },
  { match: /building tiles|graphbuilder/i, stage: 'Building tiles' },
  { match: /enhancing/i, stage: 'Adding road attributes' },
  { match: /validating|graphvalidator/i, stage: 'Validating' },
  { match: /cleaning|cleanup/i, stage: 'Cleaning up' },
];

/** Upper bound on an extract we will accept, with a reason rather than a crash. */
const MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024;

export interface ImportRegionOptions {
  paths: EmbeddedPaths;
  /** Path to a `.osm.pbf` chosen by the user through a dialog. */
  extractPath: string;
  onProgress?: (progress: RegionProgress) => void;
  signal?: AbortSignal;
}

/**
 * Builds a graph, replacing whatever was there.
 *
 * Replacing rather than merging is deliberate: Valhalla has no notion of
 * incrementally adding a region to an existing tile set, and a half-merged
 * graph would route wrongly at the seam in ways that are very hard to notice.
 * One region at a time, stated plainly in the UI.
 */
export async function importRegion(
  options: ImportRegionOptions,
): Promise<RegionResult> {
  const { paths, extractPath } = options;

  let extractSize: number;
  try {
    const stat = statSync(extractPath);
    if (!stat.isFile()) throw new Error('not a file');
    extractSize = stat.size;
  } catch {
    throw new ServiceError(
      'INVALID_REQUEST',
      'That file could not be read. Choose an OpenStreetMap .osm.pbf extract.',
    );
  }

  if (extractSize > MAX_EXTRACT_BYTES) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `That extract is ${(extractSize / 1024 ** 3).toFixed(1)} GB. TrailRT builds graphs up to ${MAX_EXTRACT_BYTES / 1024 ** 3} GB — use a country or region extract rather than a continent.`,
    );
  }

  const tool = join(paths.addon, '..', 'bin', 'valhalla_build_tiles');

  /*
   * The graph is built into a staging directory and swapped in on success.
   *
   * Building in place would leave a half-written graph behind if the import
   * failed or was cancelled, and `graphPresent` would then report it as usable.
   * The user would get a provider that routes in some places and silently
   * matches nothing in others.
   */
  const staging = `${paths.tileDir}.incoming`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  const stagingPaths: EmbeddedPaths = { ...paths, tileDir: staging };
  const configPath = join(staging, 'config.json');
  mkdirSync(join(paths.configFile, '..'), { recursive: true });
  writeFileSync(configPath, buildConfig(stagingPaths), 'utf8');

  await runTool(tool, ['-c', configPath, extractPath], options);

  const tileCount = countTiles(staging);
  if (tileCount === 0) {
    rmSync(staging, { recursive: true, force: true });
    throw new ServiceError(
      'PROVIDER_ERROR',
      'No routing tiles were produced. The file may not be a valid OpenStreetMap extract, or it may contain no roads.',
    );
  }

  // Swap in. The old graph goes only once the new one is known good.
  rmSync(paths.tileDir, { recursive: true, force: true });
  mkdirSync(join(paths.tileDir, '..'), { recursive: true });
  renameSync(staging, paths.tileDir);

  // The config records the final tile directory, not the staging one.
  writeFileSync(paths.configFile, buildConfig(paths), 'utf8');

  // The cached actor holds the previous graph open; a new region would
  // otherwise not take effect until restart.
  resetEmbeddedEngine();

  return {
    regionName: basename(extractPath).replace(/\.osm\.pbf$/i, ''),
    tileCount,
    builtAt: Date.now(),
    graphBytes: directoryBytes(paths.tileDir),
  };
}

function runTool(
  tool: string,
  args: readonly string[],
  options: ImportRegionOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, [...args], {
      // The tools find their libraries through @loader_path, so no
      // DYLD_* environment manipulation is needed — and setting it would be
      // stripped by the hardened runtime anyway.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastStage = '';
    let tail = '';

    const onLine = (line: string): void => {
      tail = `${tail}${line}\n`.slice(-4000);
      for (const { match, stage } of STAGES) {
        if (match.test(line) && stage !== lastStage) {
          lastStage = stage;
          options.onProgress?.({ stage, percent: null });
          return;
        }
      }
    };

    const consume = (stream: NodeJS.ReadableStream): void => {
      let buffer = '';
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) onLine(line);
      });
    };
    if (child.stdout !== null) consume(child.stdout);
    if (child.stderr !== null) consume(child.stderr);

    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (cause) => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(
        new ServiceError(
          'PROVIDER_UNAVAILABLE',
          'The tile builder could not be started. This build may be missing it.',
          cause.message,
        ),
      );
    });

    child.on('close', (code, signal) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (signal !== null) {
        reject(new ServiceError('CANCELLED', 'The region import was cancelled.'));
        return;
      }
      if (code !== 0) {
        reject(
          new ServiceError(
            'PROVIDER_ERROR',
            'Building the routing graph failed.',
            // The tail, not the whole log: it is megabytes, and the useful
            // part of a failure is always at the end.
            tail.slice(-1500),
          ),
        );
        return;
      }
      resolve();
    });
  });
}

function countTiles(dir: string): number {
  let count = 0;
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(current, entry.name));
      else if (entry.name.endsWith('.gph')) count += 1;
    }
  };
  walk(dir);
  return count;
}

function directoryBytes(dir: string): number {
  let total = 0;
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += statSync(full).size;
        } catch {
          /* raced with a delete; not worth failing a size report over */
        }
      }
    }
  };
  walk(dir);
  return total;
}
