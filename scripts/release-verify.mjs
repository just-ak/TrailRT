// SPDX-License-Identifier: MIT
/**
 * Run by semantic-release (release.config.mjs) before a release is tagged.
 *
 *   node scripts/release-verify.mjs <next-version>            checks only
 *   node scripts/release-verify.mjs <next-version> --assets   then stages the assets
 *
 * Fails, so nothing is tagged or published, when:
 *
 * - the version semantic-release worked out from the commits is not the one
 *   in package.json, which is the one the DMG was built as. That happens when
 *   commits landed after `npm run release:prepare`, or the DMG was committed
 *   by hand. The fix is to run `npm run release:prepare` again;
 * - the DMG for that version is missing, or fails scripts/check-dmg.mjs.
 *
 * With --assets it copies the DMG and a shasum-format checksum into
 * release-assets/, which the GitHub step uploads.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const next = process.argv[2];
const stageAssets = process.argv.includes('--assets');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (next === undefined || next === '') fail('Usage: node scripts/release-verify.mjs <next-version> [--assets]');

if (next !== version) {
  fail(
    `The commits since the last release make the next version ${next}, but package.json says ${version}, ` +
      'which is the version the DMG was built as. Run `npm run release:prepare` on main and push the commit it makes.',
  );
}

const dmg = join(root, 'downloads', `TrailRT-${version}-arm64.dmg`);
if (!existsSync(dmg)) fail(`There is no ${basename(dmg)} in downloads/. Run \`npm run release:prepare\` on main.`);

if (!stageAssets) {
  const checked = spawnSync(process.execPath, [join(root, 'scripts', 'check-dmg.mjs'), dmg, version], { stdio: 'inherit' });
  if (checked.status !== 0) fail(`${basename(dmg)} failed its checks. Nothing has been tagged or published.`);
  console.log(`\nRelease ${version} verified.`);
  process.exit(0);
}

const assets = join(root, 'release-assets');
rmSync(assets, { recursive: true, force: true });
mkdirSync(assets);
copyFileSync(dmg, join(assets, basename(dmg)));
const sha = createHash('sha256').update(readFileSync(dmg)).digest('hex');
// shasum's own format, so `shasum -a 256 -c` checks a download.
writeFileSync(join(assets, `${basename(dmg)}.sha256`), `${sha}  ${basename(dmg)}\n`);
console.log(`Staged ${basename(dmg)} and its checksum (${sha}) in release-assets/.`);
