// SPDX-License-Identifier: MIT
/**
 * Publishes the release commit that `npm run release:prepare` made (ADR 0026).
 *
 *   npm run release:publish
 *
 * 1. Checks HEAD is `chore(release): <package.json's version>` on a clean
 *    main, that it holds the real DMG (not a Git LFS pointer), that the GitHub
 *    CLI is signed in, and that every release tag here is also on GitHub.
 * 2. Pushes main if GitHub does not have the commit yet. Git LFS uploads the
 *    DMG as part of the push, and the push starts the Release workflow.
 *    If GitHub already has the commit and its Release run failed, or never
 *    ran, starts the workflow again by hand instead (workflow_dispatch).
 * 3. Follows that run with `gh run watch` and prints the failing log if it
 *    fails.
 * 4. Checks the GitHub release: tag v<version> on this commit, the DMG at the
 *    size and SHA-256 of the one here, and its checksum file.
 *
 * Safe to run again: once the release is up it only checks it.
 */
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  dmgFor,
  ghJson,
  git,
  isLfsPointer,
  packageVersion,
  requireGh,
  requireTagsOnOrigin,
  root,
  sha256,
  stop,
} from './release-lib.mjs';

const WORKFLOW = 'release.yml';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  return result.status === 0;
}

// 1. The release commit, as release:prepare left it.
const version = packageVersion();
const tag = `v${version}`;
const dmg = dmgFor(version);
const head = git('rev-parse', 'HEAD');

if (git('branch', '--show-current') !== 'main') stop('Releases are published from main. Switch to main first.');
if (git('status', '--porcelain') !== '') stop('The working tree has changes. Commit or stash them first.');
if (git('log', '-1', '--format=%s') !== `chore(release): ${version}`) {
  stop(`HEAD is not \`chore(release): ${version}\`. Run \`npm run release:prepare\` first; it makes that commit.`);
}
if (spawnSync('git', ['ls-files', '--error-unmatch', dmg], { cwd: root }).status !== 0) stop(`${dmg} is not committed. Run \`npm run release:prepare\` again.`);
if (isLfsPointer(join(root, dmg))) stop(`${dmg} is a Git LFS pointer, not the DMG. Run \`git lfs pull\` first.`);
requireGh();
git('fetch', '--quiet', '--tags', 'origin', 'main');
requireTagsOnOrigin();

const localSha = sha256(join(root, dmg));
const localSize = statSync(join(root, dmg)).size;

/** Checks the published release against this commit and this DMG, and stops on any difference. */
function checkRelease(release) {
  const problems = [];
  // An annotated tag lists its tag object then `<tag>^{}`, the commit; a lightweight tag lists only the commit.
  const remoteTag = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`).split('\n').findLast(Boolean);
  if (remoteTag?.split('\t')[0] !== head) problems.push(`tag ${tag} on GitHub is not this commit (${head.slice(0, 7)})`);

  const asset = release.assets.find((a) => a.name === basename(dmg));
  if (asset === undefined) problems.push(`the release has no ${basename(dmg)}`);
  else {
    if (asset.size !== localSize) problems.push(`the release's DMG is ${asset.size} bytes, this one is ${localSize}`);
    if (asset.digest && asset.digest !== `sha256:${localSha}`) problems.push(`the release's DMG has ${asset.digest}, this one sha256:${localSha}`);
  }
  const checksum = spawnSync('gh', ['release', 'download', tag, '--pattern', `${basename(dmg)}.sha256`, '--output', '-'], { cwd: root, encoding: 'utf8' });
  if (checksum.status !== 0) problems.push(`the release has no ${basename(dmg)}.sha256`);
  else if (checksum.stdout.trim() !== `${localSha}  ${basename(dmg)}`) problems.push(`${basename(dmg)}.sha256 says ${checksum.stdout.trim()}`);

  if (problems.length > 0) stop(`Release ${tag} is on GitHub, but:\n\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  git('fetch', '--quiet', '--tags', 'origin');
  console.log(`\nRelease ${tag} is published and matches ${dmg} (sha256 ${localSha}).`);
  console.log(`  ${release.url}`);
  console.log('  Download link for the website and clients: https://github.com/just-ak/TrailRT/releases/latest\n');
  process.exit(0);
}

const existing = ghJson('release', 'view', tag, '--json', 'url,assets,isDraft');
if (existing !== null) {
  console.log(`GitHub already has release ${tag}. Checking it.`);
  checkRelease(existing);
}

function runsFor(event) {
  const runs = ghJson('run', 'list', '--workflow', WORKFLOW, '--commit', head, '--event', event, '--limit', '5', '--json', 'databaseId,status,conclusion,createdAt,url') ?? [];
  return runs;
}

/** Waits up to two minutes for GitHub to list a run that `isNew` accepts. */
async function waitForRun(event, isNew) {
  for (let i = 0; i < 24; i += 1) {
    const found = runsFor(event).find(isNew);
    if (found !== undefined) return found;
    // Polling on purpose: each wait depends on the last answer.
    // oxlint-disable-next-line no-await-in-loop
    await sleep(5000);
  }
  return undefined;
}

// 2. Push, or start the workflow again.
let runToWatch;
const onGitHub = spawnSync('git', ['merge-base', '--is-ancestor', head, 'origin/main'], { cwd: root }).status === 0;
if (!onGitHub) {
  if (spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', head], { cwd: root }).status !== 0) {
    stop('main and origin/main have diverged. Pull, then run `npm run release:prepare` again so the DMG is built from what is on GitHub.');
  }
  console.log(`Pushing main with ${dmg} (${(localSize / 1e6).toFixed(0)} MB through Git LFS).`);
  if (!run('git', ['push', 'origin', 'main'])) stop('The push failed. Nothing has been published.');
  runToWatch = await waitForRun('push', () => true);
  if (runToWatch === undefined) stop(`The push did not start the Release workflow within two minutes. Check https://github.com/just-ak/TrailRT/actions/workflows/${WORKFLOW}`);
} else {
  // The workflow releases whatever main is, so main must still be this commit.
  if (git('rev-parse', 'origin/main') !== head) {
    stop(`GitHub's main has moved on past chore(release): ${version}. Pull, then run \`npm run release:prepare\` again.`);
  }
  const earlier = [...runsFor('push'), ...runsFor('workflow_dispatch')];
  const previous = earlier.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (previous !== undefined && previous.status !== 'completed') {
    console.log(`The Release workflow is already running for this commit.`);
    runToWatch = previous;
  } else {
    console.log(
      previous === undefined
        ? 'GitHub has this commit but no Release run for it. Starting the workflow.'
        : `The last Release run for this commit ended ${previous.conclusion} (${previous.url}). Starting it again.`,
    );
    const known = new Set(earlier.map((r) => r.databaseId));
    if (!run('gh', ['workflow', 'run', WORKFLOW, '--ref', 'main'])) stop('Could not start the Release workflow.');
    runToWatch = await waitForRun('workflow_dispatch', (r) => !known.has(r.databaseId));
    if (runToWatch === undefined) stop(`The Release workflow did not start within two minutes. Check https://github.com/just-ak/TrailRT/actions/workflows/${WORKFLOW}`);
  }
}

// 3. Follow it.
console.log(`\nFollowing ${runToWatch.url}\n`);
if (!run('gh', ['run', 'watch', String(runToWatch.databaseId), '--exit-status', '--compact', '--interval', '10'])) {
  console.error('\nThe Release workflow failed. The failing step\'s log:\n');
  const log = spawnSync('gh', ['run', 'view', String(runToWatch.databaseId), '--log-failed'], { cwd: root, encoding: 'utf8' });
  console.error(log.stdout.split('\n').slice(-60).join('\n'));
  stop(`Nothing was published. Fix the cause, then run \`npm run release:publish\` again; it starts the workflow again for this commit.`);
}

// 4. The release it made.
const published = ghJson('release', 'view', tag, '--json', 'url,assets,isDraft');
if (published === null) stop(`The Release workflow succeeded but there is no release ${tag}. Read its log: ${runToWatch.url}`);
checkRelease(published);
