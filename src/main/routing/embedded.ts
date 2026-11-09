import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { RoutingProvider } from '@shared/routing/RoutingProvider';
import type { LoadedRegion } from '@shared/routing/results';
import { ServiceError } from '../services/errors';
import {
  createValhallaProviderWith,
  EMBEDDED_PROVIDER_ID,
  type ValhallaTransport,
} from './valhalla';

/**
 * The routing engine embedded in the application — ADR 0013.
 *
 * Valhalla runs **in this process** through its N-API addon, so there is no
 * server, no port, no child process and no network request. Which in turn means
 * no endpoint to configure and no consent to ask for: nothing leaves the
 * machine, so there is nothing to get permission to send.
 *
 * ## Two things have to be present
 *
 * 1. The **addon**, shipped in the app bundle. Absent only in a checkout where
 *    `npm run build:valhalla` has not been run.
 * 2. A **graph**, built from an OpenStreetMap extract the user chose. The
 *    engine is inert without one, and that is a normal first-run state rather
 *    than an error — it is reported as something to do, not something broken.
 *
 * These are reported separately because the remedies are completely different:
 * a missing addon is a broken build, a missing graph is a user action.
 */

/** Where the graph and generated config live, under the app's data directory. */
export interface EmbeddedPaths {
  addon: string;
  tileDir: string;
  configFile: string;
  configTemplate: string;
  /** Describes which extract produced the current graph. */
  regionFile: string;
  /** Cached Geofabrik region index, so the picker is not a 3.6 MB fetch each time. */
  indexFile: string;
  /** Where a downloaded extract is staged before the graph is built. */
  downloadDir: string;
  /**
   * `osmium`, bundled beside the Valhalla tools, which merges several extracts
   * into one before building. Valhalla aborts on overlapping extracts, and
   * neighbouring regions always overlap. Absent in a build without it, which
   * then offers single regions only. ADR 0018.
   */
  mergeTool: string;
  /** Downloaded terrain tiles, gzipped HGT. ADR 0018. */
  terrainDir: string;
}

/**
 * Resolves the on-disk layout.
 *
 * `userDataDir` is passed in rather than read from `electron.app` so this
 * module stays testable without an Electron runtime — the same reason the rest
 * of `main/` takes its database handle as an argument.
 */
export function embeddedPaths(
  userDataDir: string,
  resourcesDir: string,
): EmbeddedPaths {
  const root = join(resourcesDir, 'valhalla');
  return {
    addon: join(root, 'valhalla_node.node'),
    configTemplate: join(root, 'config.template.json'),
    tileDir: join(userDataDir, 'valhalla', 'tiles'),
    configFile: join(userDataDir, 'valhalla', 'config.json'),
    regionFile: join(userDataDir, 'valhalla', 'region.json'),
    indexFile: join(userDataDir, 'valhalla', 'geofabrik-index.json'),
    downloadDir: join(userDataDir, 'valhalla', 'downloads'),
    mergeTool: join(root, 'bin', 'osmium'),
    terrainDir: join(userDataDir, 'terrain'),
  };
}

export function addonPresent(paths: EmbeddedPaths): boolean {
  return existsSync(paths.addon);
}

/** Whether this build can combine several regions into one graph. */
export function mergeToolPresent(paths: EmbeddedPaths): boolean {
  return existsSync(paths.mergeTool);
}

/**
 * Whether a usable routing graph exists.
 *
 * Checks for actual tile files rather than just the directory, because
 * `valhalla_build_tiles` creates the directory before it has written anything.
 * Treating an empty directory as a graph would turn a cancelled import into a
 * provider that claims to work and then matches nothing.
 */
export function graphPresent(paths: EmbeddedPaths): boolean {
  if (!existsSync(paths.tileDir)) return false;
  try {
    // Tiles are nested by hierarchy level, so the level directories are the
    // cheap signal: `0`, `1`, `2`.
    return readdirSync(paths.tileDir).some((entry) => /^\d+$/.test(entry));
  } catch {
    return false;
  }
}

export type EmbeddedState =
  | { usable: true }
  | { usable: false; reason: 'no-addon' | 'no-graph'; message: string };

export function embeddedState(paths: EmbeddedPaths): EmbeddedState {
  if (!addonPresent(paths)) {
    return {
      usable: false,
      reason: 'no-addon',
      message:
        'The built-in routing engine is missing from this build. Run "npm run build:valhalla" and repackage.',
    };
  }
  if (!graphPresent(paths)) {
    return {
      usable: false,
      reason: 'no-graph',
      message:
        'The built-in routing engine has no map data yet. Import an OpenStreetMap region to enable snapping and speed limits.',
    };
  }
  return { usable: true };
}

// ------------------------------------------------------------------- config

/**
 * Builds the config Valhalla needs, pointing at this installation's tiles.
 *
 * Derived from a template generated at build time by `valhalla_build_config`
 * rather than hand-written. Valhalla's config has a large surface with
 * defaults that matter, and inventing a minimal one by hand is how you get
 * subtly wrong costing behaviour that nothing warns you about.
 *
 * `tile_extract` is removed deliberately. The generated template names a
 * `tiles.tar` that we never produce, and Valhalla logs a scary-looking error
 * about the missing file on every startup before falling back to the directory.
 */
export function buildConfig(paths: EmbeddedPaths): string {
  if (!existsSync(paths.configTemplate)) {
    throw new ServiceError(
      'PROVIDER_UNAVAILABLE',
      'The built-in routing engine is missing its configuration template. Rebuild with "npm run build:valhalla".',
    );
  }

  const template = JSON.parse(readFileSync(paths.configTemplate, 'utf8')) as {
    mjolnir?: Record<string, unknown>;
  };

  const mjolnir: Record<string, unknown> = { ...template.mjolnir };
  mjolnir.tile_dir = paths.tileDir;
  delete mjolnir.tile_extract;
  delete mjolnir.traffic_extract;

  const timezone = join(paths.tileDir, 'timezones.sqlite');
  const admin = join(paths.tileDir, 'admins.sqlite');
  if (existsSync(timezone)) mjolnir.timezone = timezone;
  else delete mjolnir.timezone;
  if (existsSync(admin)) mjolnir.admin = admin;
  else delete mjolnir.admin;

  return JSON.stringify({ ...template, mjolnir });
}

// ----------------------------------------------------------------- provider

interface ValhallaAddon {
  VALHALLA_VERSION: string;
  Actor: new (configJson: string) => {
    route(json: string): Promise<string>;
    traceAttributes(json: string): Promise<string>;
  };
}

/**
 * The addon is loaded once per process and kept.
 *
 * Loading pulls in 113 dylibs and roughly 38 MB, so it is deferred until
 * something actually routes — a user who never snaps a route never pays for it.
 * Caching matters more than it looks: Valhalla's own actor cache is keyed on the
 * config string, so rebuilding the actor would re-read the graph.
 */
let cachedAddon: ValhallaAddon | null = null;
let cachedActor: InstanceType<ValhallaAddon['Actor']> | null = null;
let cachedConfig: string | null = null;

/** For tests, and for after a region import replaces the graph. */
export function resetEmbeddedEngine(): void {
  cachedActor = null;
  cachedConfig = null;
}

function loadAddon(paths: EmbeddedPaths): ValhallaAddon {
  if (cachedAddon !== null) return cachedAddon;

  // `createRequire` because this file is ESM and a `.node` addon can only be
  // loaded through CommonJS resolution.
  const require = createRequire(import.meta.url);
  try {
    cachedAddon = require(paths.addon) as ValhallaAddon;
  } catch (cause) {
    throw new ServiceError(
      'PROVIDER_UNAVAILABLE',
      'The built-in routing engine could not be loaded.',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  return cachedAddon;
}

function actorFor(paths: EmbeddedPaths): InstanceType<ValhallaAddon['Actor']> {
  const config = buildConfig(paths);
  if (cachedActor !== null && cachedConfig === config) return cachedActor;

  const addon = loadAddon(paths);
  mkdirSync(paths.tileDir, { recursive: true });
  // The constructor takes the config's JSON *content*, not a path. Passing a
  // path fails with the unhelpful "Failed to load config".
  cachedActor = new addon.Actor(config);
  cachedConfig = config;
  return cachedActor;
}

export function embeddedVersion(paths: EmbeddedPaths): string | null {
  try {
    return loadAddon(paths).VALHALLA_VERSION;
  } catch {
    return null;
  }
}

/**
 * The embedded provider.
 *
 * Shares every line of request construction and response translation with the
 * HTTP adapter — only the transport differs. So the km→m and km/h→m/s
 * conversions, the "absent speed limit stays null, never 0" rule and the
 * unmatched-leg handling are all the same code, already verified against both
 * a loopback server and a live instance.
 */
export function createEmbeddedProvider(paths: EmbeddedPaths): RoutingProvider {
  const transport: ValhallaTransport = async <T>(
    path: string,
    body: unknown,
  ): Promise<T> => {
    const actor = actorFor(paths);

    let raw: string;
    try {
      switch (path) {
        case '/route':
          raw = await actor.route(JSON.stringify(body));
          break;
        case '/trace_attributes':
          raw = await actor.traceAttributes(JSON.stringify(body));
          break;
        default:
          throw new ServiceError(
            'INVALID_REQUEST',
            `The built-in routing engine has no action for "${path}".`,
          );
      }
    } catch (cause) {
      if (cause instanceof ServiceError) throw cause;

      /*
       * The actor throws for an unroutable request as well as for a real
       * failure, and classifying it as PROVIDER_ERROR is what lets the adapter
       * keep a straight line for that one leg instead of aborting the whole
       * snap. Misclassifying it as PROVIDER_UNAVAILABLE would make one
       * unreachable point fail an entire route.
       */
      throw new ServiceError(
        'PROVIDER_ERROR',
        'The built-in routing engine could not complete that request.',
        cause instanceof Error ? cause.message : String(cause),
      );
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new ServiceError(
        'PROVIDER_ERROR',
        'The built-in routing engine returned a response that could not be read.',
      );
    }
  };

  return createValhallaProviderWith(transport, {
    id: EMBEDDED_PROVIDER_ID,
    name: 'Built-in (Valhalla)',
    // Nothing to allowlist. The CSP gains no entry for the embedded engine,
    // which is the clearest possible statement that it makes no requests.
    origins: [],
    attribution: 'Routing by Valhalla · Road data © OpenStreetMap contributors',
  });
}

// ------------------------------------------------------------------- region

/**
 * Which extract produced the current graph.
 *
 * A file beside the graph rather than a row in the settings table, for two
 * reasons. It is not a user preference, so it does not belong in a table typed
 * by a union of preference keys. And keeping it next to the tiles means
 * deleting the graph takes its label with it — there is no way to end up
 * showing "Switzerland, built on 3 March" for a directory that no longer
 * exists.
 *
 * The graph remains the source of truth for whether routing *works*; this is
 * only the label for it, which is why an unreadable file is treated as absent
 * rather than as an error.
 */
export function readLoadedRegion(paths: EmbeddedPaths): LoadedRegion | null {
  if (!graphPresent(paths)) return null;
  try {
    const parsed = JSON.parse(
      readFileSync(paths.regionFile, 'utf8'),
    ) as Partial<LoadedRegion>;
    if (
      typeof parsed.regionName !== 'string' ||
      typeof parsed.tileCount !== 'number' ||
      typeof parsed.builtAt !== 'number'
    ) {
      return null;
    }
    return {
      regionName: parsed.regionName,
      // A record written before several regions could be combined has no ids.
      // Reported as none rather than refused: the graph itself is fine, the
      // picker just cannot pre-select what it was built from.
      regionIds: Array.isArray(parsed.regionIds)
        ? parsed.regionIds.filter((id): id is string => typeof id === 'string')
        : [],
      tileCount: parsed.tileCount,
      builtAt: parsed.builtAt,
      graphBytes: typeof parsed.graphBytes === 'number' ? parsed.graphBytes : 0,
    };
  } catch {
    return null;
  }
}

export function writeLoadedRegion(
  paths: EmbeddedPaths,
  region: LoadedRegion,
): void {
  mkdirSync(join(paths.regionFile, '..'), { recursive: true });
  writeFileSync(paths.regionFile, JSON.stringify(region, null, 2), 'utf8');
}
