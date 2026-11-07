/**
 * Proves the bundled Valhalla addon works inside Electron, not merely under
 * host Node.
 *
 * The addon is compiled against host Node's headers but has to run in
 * Electron's bundled Node, which is a different version with a different
 * module ABI. Valhalla's bindings are N-API (node-addon-api 8.5,
 * NAPI_VERSION=8), and N-API is ABI-stable across both — the same reasoning
 * ADR 0010 applies to better-sqlite3. "Should be stable" is not evidence, so
 * this runs under the real Electron runtime and reports what it finds.
 *
 * It checks the two things the feature actually needs:
 *
 *   1. `route`, which backs snap-to-road.
 *   2. `traceAttributes`, which is the only source of posted speed limits.
 *
 * The second is the one worth guarding. A build that routes but returns no
 * speed limits would pass a naive smoke test and fail the requirement.
 *
 *   npm run verify:valhalla
 *
 * Expects a graph built by scripts/build-valhalla.sh plus a test region. Set
 * VALHALLA_CONFIG and VALHALLA_ADDON to point elsewhere.
 */
import { app } from 'electron';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const CACHE =
  process.env.TRAILRT_VALHALLA_CACHE ??
  path.join(homedir(), '.cache/trailrt-valhalla');

const ADDON =
  process.env.VALHALLA_ADDON ??
  path.join(CACHE, 'build/src/bindings/nodejs/lib/valhalla_node.node');

const CONFIG =
  process.env.VALHALLA_CONFIG ?? path.join(CACHE, 'work/valhalla.json');

/** A stretch of road through Vaduz, inside the Liechtenstein test extract. */
const SHAPE = [
  { lat: 47.1385, lon: 9.5215 },
  { lat: 47.1402, lon: 9.5222 },
  { lat: 47.1421, lon: 9.5231 },
  { lat: 47.144, lon: 9.524 },
];

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  app.exit(1);
};

app.whenReady().then(async () => {
  console.log(`electron : ${process.versions.electron}`);
  console.log(
    `node     : ${process.versions.node} (modules ABI ${process.versions.modules}, N-API ${process.versions.napi})`,
  );

  if (!existsSync(ADDON)) {
    fail(`addon not found at ${ADDON}\n  run scripts/build-valhalla.sh first`);
    return;
  }
  if (!existsSync(CONFIG)) {
    fail(`config not found at ${CONFIG}\n  build a test graph first`);
    return;
  }

  try {
    const valhalla = require(ADDON);
    console.log(`loaded   : Valhalla ${valhalla.VALHALLA_VERSION}`);

    // The constructor takes the config's JSON *content*, not a path — it
    // parses the string directly. Passing a path fails with the unhelpful
    // "Failed to load config".
    const actor = new valhalla.Actor(readFileSync(CONFIG, 'utf8'));

    // --- 1. routing, which backs snap-to-road
    const routeStarted = Date.now();
    const route = JSON.parse(
      await actor.route(
        JSON.stringify({
          locations: [SHAPE[0], SHAPE.at(-1)],
          costing: 'auto',
          directions_options: { units: 'kilometers' },
        }),
      ),
    );
    const leg = route.trip?.legs?.[0];
    if (leg === undefined || typeof leg.shape !== 'string') {
      fail('route returned no leg geometry');
      return;
    }
    if (route.trip.units !== 'kilometers') {
      // The adapter converts km to metres on this assumption. If the engine
      // ever answered in miles the distances would be silently 1.6x wrong.
      fail(`expected kilometres, got "${route.trip.units}"`);
      return;
    }
    console.log(
      `route    : ${leg.summary.length} km, ${leg.shape.length} shape chars, ${Date.now() - routeStarted} ms`,
    );

    // --- 2. road attributes, the only source of posted speed limits
    const traceStarted = Date.now();
    const trace = JSON.parse(
      await actor.traceAttributes(
        JSON.stringify({
          shape: SHAPE.map((point) => ({ ...point, type: 'via' })),
          costing: 'auto',
          shape_match: 'map_snap',
          directions_options: { units: 'kilometers' },
          filters: {
            attributes: [
              'edge.length',
              'edge.speed_limit',
              'edge.road_class',
              'edge.surface',
              'edge.begin_shape_index',
              'edge.end_shape_index',
              'shape',
              'matched.type',
            ],
            action: 'include',
          },
        }),
      ),
    );

    const edges = trace.edges ?? [];
    if (edges.length === 0) {
      fail('traceAttributes matched no edges');
      return;
    }

    const withLimit = edges.filter((edge) => edge.speed_limit !== undefined);
    const classes = new Set(
      edges.map((edge) => edge.road_class).filter((value) => value !== undefined),
    );

    console.log(
      `match    : ${edges.length} edges, ${withLimit.length} with a posted limit, ${classes.size} road classes, ${Date.now() - traceStarted} ms`,
    );

    if (withLimit.length === 0) {
      fail(
        'no edge carried a posted speed limit — the graph may have been built without them',
      );
      return;
    }

    // Absent must stay absent. A 0 here would land in the lowest speed band
    // rather than the Unknown one, turning a data gap into a measurement.
    if (withLimit.some((edge) => edge.speed_limit === 0)) {
      fail('an edge reported a speed limit of 0, which must be absent instead');
      return;
    }

    console.log('PASS: in-process routing and posted speed limits both work.');
    app.exit(0);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
});
