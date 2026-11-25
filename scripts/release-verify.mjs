// SPDX-License-Identifier: MIT
/**
 * Run by semantic-release (release.config.mjs) before a release is tagged.
 *
 *   node scripts/release-verify.mjs <next-version>            checks only
 *   node scripts/release-verify.mjs <next-version> --assets   then stages the assets
 *
 * Fails, so nothing is tagged or published, when:
 *
 * - there is no release tag at all. semantic-release would make that a first
 *   release, 1.0.0, and the cause is nearly always a tag that was never
 *   pushed (it was v0.1.0, for 0.2.0);
 * - the version semantic-release worked out from the commits is not the one
 *   in package.json, which is the one the DMG was built as. That happens when
 *   commits landed after `npm run release:prepare`, or the version was edited
 *   by hand. The fix is to run `npm run release:prepare` again;
 * - the DMG for that version is missing, is a Git LFS pointer, or fails
 *   scripts/check-dmg.mjs.
 *
 * With --assets it copies the DMG and a shasum-format checksum into
 * release-assets/, which the GitHub step uploads.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { dmgFor, isLfsPointer, packageVersion, releaseTagsOnHead, root, sha256, stop } from './release-lib.mjs';

const next = process.argv[2];
const stageAssets = process.argv.includes('--assets');
const version = packageVersion();

if (next === undefined || next === '') stop('Usage: node scripts/release-verify.mjs <next-version> [--assets]');

const tags = releaseTagsOnHead();
if (tags.length === 0) {
  stop(
    `There is no release tag (v*) behind this commit, so semantic-release treats this as the first release and wants ${next}. ` +
      'The last release tag has almost certainly not been pushed. On the Mac: `git push origin refs/tags/<tag>`, ' +
      'then `npm run release:publish` to start this workflow again.',
  );
}

if (next !== version) {
  stop(
    `The commits since ${tags.at(-1) ?? 'the last release'} make the next version ${next}, but package.json says ${version}, ` +
      'which is the version the DMG was built as. Run `npm run release:prepare` on main, then `npm run release:publish`.',
  );
}

const dmg = join(root, dmgFor(version));
if (!existsSync(dmg)) stop(`There is no ${basename(dmg)} in downloads/. Run \`npm run release:prepare\` on main.`);
if (isLfsPointer(dmg)) stop(`${basename(dmg)} is a Git LFS pointer, not the DMG. The workflow's Git LFS step did not fetch it.`);

if (!stageAssets) {
  const checked = spawnSync(process.execPath, [join(root, 'scripts', 'check-dmg.mjs'), dmg, version], { stdio: 'inherit' });
  if (checked.status !== 0) stop(`${basename(dmg)} failed its checks. Nothing has been tagged or published.`);
  console.log(`\nRelease ${version} verified.`);
  process.exit(0);
}

const assets = join(root, 'release-assets');
rmSync(assets, { recursive: true, force: true });
mkdirSync(assets);
copyFileSync(dmg, join(assets, basename(dmg)));
const sha = sha256(dmg);
// shasum's own format, so `shasum -a 256 -c` checks a download.
writeFileSync(join(assets, `${basename(dmg)}.sha256`), `${sha}  ${basename(dmg)}\n`);
console.log(`Staged ${basename(dmg)} and its checksum (${sha}) in release-assets/.`);
