// SPDX-License-Identifier: MIT
/**
 * What the release scripts share (ADR 0026): release-prepare.mjs and
 * release-publish.mjs on the Mac, release-verify.mjs in the Release workflow.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));

export function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

export function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function packageVersion() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

/** The DMG for a version, relative to the repository root, as committed. */
export function dmgFor(version) {
  return `downloads/TrailRT-${version}-arm64.dmg`;
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** A clone without Git LFS has this small text file in place of the DMG. */
export function isLfsPointer(file) {
  const head = Buffer.alloc(64);
  const fd = openSync(file, 'r');
  readSync(fd, head, 0, head.length, 0);
  closeSync(fd);
  return head.toString('utf8').startsWith('version https://git-lfs.github.com/spec/');
}

/** Release tags (`v<semver>`) reachable from HEAD, as semantic-release sees them, oldest version first. */
export function releaseTagsOnHead() {
  return git('tag', '--list', 'v*', '--merged', 'HEAD', '--sort=v:refname').split('\n').filter(Boolean);
}

/**
 * Stops unless every local release tag is on origin, pointing at the same
 * commit. semantic-release works the next version out from the last tag; a tag
 * that exists only on this Mac makes the version here differ from the one the
 * Release workflow works out on GitHub. That is what failed 0.2.0 twice: v0.1.0
 * was never pushed, so the workflow saw no tags and wanted 1.0.0.
 */
export function requireTagsOnOrigin() {
  const remote = new Map(
    git('ls-remote', '--tags', 'origin', 'refs/tags/v*')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'))
      // An annotated tag is listed twice: its tag object, then `<tag>^{}`, the
      // commit it points at. The later line wins in the Map, so every entry
      // ends up a commit.
      .map(([sha, ref]) => [ref.replace('refs/tags/', '').replace('^{}', ''), sha]),
  );
  const missing = [];
  for (const tag of releaseTagsOnHead()) {
    const commit = git('rev-parse', `${tag}^{commit}`);
    if (remote.get(tag) !== commit) missing.push(tag);
  }
  if (missing.length > 0) {
    stop(
      `These release tags are on this Mac but not on GitHub (or point elsewhere there): ${missing.join(', ')}.\n` +
        'The Release workflow would then work out a different version from this Mac. Push them first:\n\n' +
        `  git push origin ${missing.map((tag) => `refs/tags/${tag}`).join(' ')}`,
    );
  }
}

/** Stops unless `gh` is installed and signed in, since publishing drives GitHub through it. */
export function requireGh() {
  const status = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], { encoding: 'utf8' });
  if (status.error !== undefined) stop('The GitHub CLI (gh) is not installed. Install it with `brew install gh`.');
  if (status.status !== 0) {
    stop(`The GitHub CLI is not signed in:\n\n${(status.stdout + status.stderr).trim()}\n\nRun \`gh auth login\` (or \`gh auth refresh -h github.com\`) first.`);
  }
}

/** `gh` with JSON output, or null when it fails (for example, no such release). */
export function ghJson(...args) {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout);
}
