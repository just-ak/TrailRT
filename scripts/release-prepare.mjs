// SPDX-License-Identifier: MIT
/**
 * The half of a release that has to happen on the owner's Mac (ADR 0026).
 *
 *   npm run release:prepare     builds and commits; pushes nothing
 *   npm run release             this, then release:publish
 *
 * 1. Checks this is main, clean, level with origin/main, and that every
 *    release tag here is also on GitHub, so this Mac and the Release workflow
 *    work the version out from the same tags.
 * 2. Asks semantic-release, with the project's own rules, what the next
 *    version is. Nothing is tagged or published by this. Stops if GitHub
 *    already has that tag or release.
 * 3. Sets it in package.json and package-lock.json, whatever they said
 *    before, so a hand-edited version cannot survive into the DMG.
 * 4. Runs `npm run package`, which builds the app, checks the packaged app
 *    builds a routing graph, and copies the DMG into downloads/; then runs
 *    scripts/check-dmg.mjs on that DMG, the same check the workflow makes.
 * 5. Commits the version and the DMG together as `chore(release): <version>`.
 *
 * It does not push. `npm run release:publish` does, and follows the Release
 * workflow until the GitHub release is up.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dmgFor, ghJson, git, packageVersion, requireGh, requireTagsOnOrigin, root, stop } from './release-lib.mjs';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
  if (result.status !== 0) stop(`\`${command} ${args.join(' ')}\` failed. Nothing has been committed.`);
}

// 1. Where we are.
if (git('branch', '--show-current') !== 'main') stop('Releases are made from main. Switch to main first.');
if (git('status', '--porcelain') !== '') stop('The working tree has changes. Commit or stash them first, so the DMG is built from committed source.');
if (spawnSync('git', ['lfs', 'version']).status !== 0) stop('Git LFS is not installed, and the DMG is committed through it. Run `brew install git-lfs && git lfs install`.');
requireGh();
git('fetch', '--quiet', '--tags', 'origin', 'main');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
  stop('main is not level with origin/main. Pull or push first, so the version is worked out from what is on GitHub.');
}
requireTagsOnOrigin();

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
if (git('ls-remote', '--tags', 'origin', `refs/tags/v${next}`) !== '') stop(`GitHub already has the tag v${next}. Nothing has been changed.`);
if (ghJson('release', 'view', `v${next}`, '--json', 'url') !== null) stop(`GitHub already has release v${next}. Nothing has been changed.`);

const current = packageVersion();
console.log(`\nThe next release is ${next} (package.json says ${current}).\n`);

// 3. The version, in package.json and its lockfile together.
run('npm', ['version', next, '--no-git-tag-version', '--allow-same-version']);

// 4. The DMG, built as that version. ELECTRON_RUN_AS_NODE, set by some
//    editors' terminals, stops Electron starting for the packaged-app check.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
run('npm', ['run', 'package'], env);
const dmg = dmgFor(next);
if (!existsSync(join(root, dmg))) stop(`\`npm run package\` finished but there is no ${dmg}. Nothing has been committed.`);
run(process.execPath, [join(root, 'scripts', 'check-dmg.mjs'), join(root, dmg), next], env);

// 5. One commit holding the version and the DMG built from it.
run('git', ['add', 'package.json', 'package-lock.json', dmg]);
run('git', [
  'commit',
  '--quiet',
  '-m',
  `chore(release): ${next}`,
  '-m',
  `The version semantic-release works out from the commits since the last release, and ${dmg} built as it.`,
]);

console.log(`\nCommitted chore(release): ${next}.`);
console.log('Run `npm run release:publish` to push it and follow the Release workflow until the GitHub release is up.\n');
