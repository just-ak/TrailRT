/**
 * Proves the **packaged** app can build a routing graph.
 *
 *   node scripts/verify-package.mjs [path/to/TrailRT.app]
 *
 * Dev builds cannot catch this class of failure. electron-builder re-signs
 * every bundled binary with the hardened runtime, and only then does the kernel
 * enforce what the tools are allowed to do. The 0.1.0 DMG shipped a
 * valhalla_build_tiles that was killed ("Code Signature Invalid / Invalid
 * Page") on the first way it parsed, because its LuaJIT needs
 * allow-unsigned-executable-memory. Every dev and unit check passed, because
 * none of them ran the re-signed binary.
 *
 * So this runs the bundled tools themselves, out of the .app, on a tiny
 * synthetic extract:
 *
 * 1. checks the LuaJIT tools carry their entitlement;
 * 2. converts a hand-written .osm to .pbf with the bundled osmium;
 * 3. builds tiles from it with the bundled valhalla_build_tiles, which parses
 *    ways and so calls into LuaJIT.
 *
 * The coordinates are invented (test-data rule: no real GPS data). Only "did
 * the process survive and write a tile" is asserted.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const app = resolve(process.argv[2] ?? 'release/mac-arm64/TrailRT.app');
const root = join(app, 'Contents', 'Resources', 'valhalla');
const failures = [];

function countTiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true, recursive: true }).filter(
      (entry) => entry.isFile() && entry.name.endsWith('.gph'),
    ).length;
  } catch {
    return 0;
  }
}

function check(ok, message) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
}

// 1. Entitlements on the tools that run LuaJIT.
for (const tool of ['valhalla_build_tiles', 'valhalla_build_admins']) {
  const xml = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', join(root, 'bin', tool)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  check(
    xml.includes('com.apple.security.cs.allow-unsigned-executable-memory'),
    `${tool} has allow-unsigned-executable-memory`,
  );
}

const work = mkdtempSync(join(tmpdir(), 'trailrt-verify-package-'));
try {
  // 2. A synthetic extract: a grid of streets.
  //
  // It has to be thousands of ways, not one. LuaJIT interprets cold code and
  // only compiles a function once it is hot, and it is the compiled code that
  // the kernel kills. One way builds fine with the broken 0.1.0 signing —
  // measured — so a small fixture would pass exactly the build it must fail.
  const SIDE = 60; // 60 x 60 nodes, 2 x 60 x 59 = 7080 ways
  const HIGHWAYS = ['residential', 'tertiary', 'secondary', 'unclassified', 'service', 'primary'];
  const id = (row, col) => row * SIDE + col + 1;
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6" generator="trailrt-verify-package">'];
  for (let row = 0; row < SIDE; row += 1) {
    for (let col = 0; col < SIDE; col += 1) {
      lines.push(
        `  <node id="${id(row, col)}" version="1" lat="${(10 + row * 0.001).toFixed(4)}" lon="${(10 + col * 0.001).toFixed(4)}"/>`,
      );
    }
  }
  let way = 0;
  const addWay = (a, b) => {
    way += 1;
    lines.push(
      `  <way id="${way}" version="1"><nd ref="${a}"/><nd ref="${b}"/>` +
        `<tag k="highway" v="${HIGHWAYS[way % HIGHWAYS.length]}"/>` +
        `<tag k="maxspeed" v="${20 + (way % 5) * 10} mph"/>` +
        `<tag k="name" v="Synthetic ${way}"/></way>`,
    );
  };
  for (let row = 0; row < SIDE; row += 1) {
    for (let col = 0; col < SIDE - 1; col += 1) {
      addWay(id(row, col), id(row, col + 1));
      addWay(id(col, row), id(col + 1, row));
    }
  }
  lines.push('</osm>', '');
  writeFileSync(join(work, 'synthetic.osm'), lines.join('\n'));
  const pbf = join(work, 'synthetic.osm.pbf');
  const convert = spawnSync(join(root, 'bin', 'osmium'), ['cat', join(work, 'synthetic.osm'), '-o', pbf, '--overwrite'], {
    encoding: 'utf8',
  });
  check(convert.status === 0, `bundled osmium runs (status ${convert.status}, signal ${convert.signal})`);

  // 3. The tile build. Mirrors buildConfig() in src/main/routing/embedded.ts:
  // the template with this tile_dir, and the files we never ship removed.
  const template = JSON.parse(readFileSync(join(root, 'config.template.json'), 'utf8'));
  const tiles = join(work, 'tiles');
  const mjolnir = { ...template.mjolnir, tile_dir: tiles };
  for (const key of ['tile_extract', 'traffic_extract', 'timezone', 'admin']) delete mjolnir[key];
  const config = join(work, 'config.json');
  writeFileSync(config, JSON.stringify({ ...template, mjolnir }));

  const build = spawnSync(join(root, 'bin', 'valhalla_build_tiles'), ['-c', config, pbf], {
    encoding: 'utf8',
    cwd: work,
  });
  check(
    build.status === 0,
    `bundled valhalla_build_tiles runs (status ${build.status}, signal ${build.signal})`,
  );

  const gph = countTiles(tiles);
  check(gph > 0, `tile build wrote ${gph} tile(s)`);
  if (build.status !== 0) console.log((build.stdout + build.stderr).split('\n').slice(-15).join('\n'));
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} packaged-app check(s) failed for ${app}`);
  process.exit(1);
}
console.log(`\nPackaged app can build routing graphs: ${app}`);
