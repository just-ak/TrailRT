// SPDX-License-Identifier: MIT
/**
 * The half of a release that has to happen on the owner's Mac (ADR 0026).
 *
 *   npm run release:prepare
 *
 * 1. Checks this is main, clean, and level with origin/main.
 * 2. Asks semantic-release, with the project's own rules, what the next
 *    version is. Nothing is tagged or published by this.
 * 3. Sets it in package.json and package-lock.json.
 * 4. Runs `npm run package`, which builds the app, checks the packaged app
 *    builds a routing graph, and copies the DMG into downloads/.
 * 5. Commits the version and the DMG together as `chore(release): <version>`.
 *
 * It does not push. Pushing that commit to main is what publishes the
 * release, through .github/workflows/release.yml.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
  if (result.status !== 0) stop(`\`${command} ${args.join(' ')}\` failed. Nothing has been committed.`);
}

// 1. Where we are.
if (git('branch', '--show-current') !== 'main') stop('Releases are made from main. Switch to main first.');
if (git('status', '--porcelain') !== '') stop('The working tree has changes. Commit or stash them first, so the DMG is built from committed source.');
git('fetch', '--quiet', '--tags', 'origin', 'main');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
  stop('main is not level with origin/main. Pull or push first, so the version is worked out from what is on GitHub.');
}

// 2. The next version, by the release rules, without the plugins that need a token or a DMG.
const dryRun = spawnSync(
  'npx',
  ['--no-install', 'semantic-release', '--dry-run', '--no-ci', '--plugins', '@semantic-release/commit-analyzer'],
  { cwd: root, encoding: 'utf8' },
);
const output = `${dryRun.stdout}\n${dryRun.stderr}`;
if (/There are no relevant changes/.test(output)) {
  stop('No commit since the last release calls for one (no feat:, fix: or breaking change). Nothing to do.');
}
const found = /The next release version is (\S+)/.exec(output);
if (found === null) {
  console.error(output);
  stop('semantic-release did not say what the next version is (above). Nothing has been changed.');
}
const next = found[1];
const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
console.log(`\nThe next release is ${next} (package.json says ${current}).\n`);

// 3. The version, unless an earlier run already set it.
if (current !== next) run('npm', ['version', next, '--no-git-tag-version']);

// 4. The DMG, built as that version. ELECTRON_RUN_AS_NODE, set by some
//    editors' terminals, stops Electron starting for the packaged-app check.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
run('npm', ['run', 'package'], env);

// 5. One commit holding the version and the DMG built from it.
const dmg = `downloads/TrailRT-${next}-arm64.dmg`;
run('git', ['add', 'package.json', 'package-lock.json', dmg]);
run('git', ['commit', '--quiet', '-m', `chore(release): ${next}`, '-m', `The version semantic-release works out from the commits since the last release, and ${dmg} built as it.`]);

console.log(`\nCommitted chore(release): ${next}.`);
console.log('Push main to publish it: the Release workflow checks the DMG, tags the commit and publishes the GitHub release.\n');
