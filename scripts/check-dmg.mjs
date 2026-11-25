// SPDX-License-Identifier: MIT
/**
 * Checks a release DMG before it is published.
 *
 *   node scripts/check-dmg.mjs downloads/TrailRT-0.1.0-arm64.dmg [expected-version]
 *
 * Run by scripts/release-prepare.mjs on the Mac and by scripts/release-verify.mjs
 * in .github/workflows/release.yml, and safe to run by hand. It:
 *
 * 1. refuses a Git LFS pointer, which is what a clone without LFS has in
 *    place of the DMG and what a careless upload would publish;
 * 2. mounts the DMG read-only and finds TrailRT.app;
 * 3. checks the app's version is the one being released;
 * 4. checks the app is arm64, as ADR 0013 says it is, and that its
 *    signature verifies (ad-hoc until there is a Developer ID, ADR 0009);
 * 5. runs scripts/verify-package.mjs against the app, which builds a routing
 *    graph with the bundled tools, the failure no dev build can catch.
 *
 * Prints the DMG's SHA-256 last, on its own line, for the release.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dmg = resolve(process.argv[2] ?? '');
const expected = process.argv[3] ?? JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const failures = [];

function check(ok, message) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
}

if (!existsSync(dmg)) {
  console.error(`No DMG at ${dmg}`);
  process.exit(1);
}

// 1. Not a Git LFS pointer.
const head = Buffer.alloc(64);
const fd = openSync(dmg, 'r');
readSync(fd, head, 0, head.length, 0);
closeSync(fd);
if (head.toString('utf8').startsWith('version https://git-lfs.github.com/spec/')) {
  console.error(`${dmg} is a Git LFS pointer, not the DMG. Run \`git lfs pull\` first.`);
  process.exit(1);
}

// 2. Mount read-only, where Finder will not notice.
const mount = mkdtempSync(join(tmpdir(), 'trailrt-dmg-'));
execFileSync('hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount], { stdio: ['ignore', 'ignore', 'inherit'] });
try {
  const app = join(mount, 'TrailRT.app');
  check(existsSync(app), 'the DMG holds TrailRT.app');

  if (existsSync(app)) {
    // 3. The version being released.
    const version = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
    check(version === expected, `the app is version ${expected} (it says ${version})`);

    // 4. arm64, and a signature that verifies.
    const archs = execFileSync('lipo', ['-archs', join(app, 'Contents', 'MacOS', 'TrailRT')], { encoding: 'utf8' }).trim().split(/\s+/);
    check(archs.includes('arm64'), `the app is arm64 (it is ${archs.join(', ')})`);
    const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
    check(signature.status === 0, `the app's signature verifies${signature.status === 0 ? '' : `: ${signature.stderr.trim()}`}`);

    // 5. The shipped tools build a routing graph.
    const verifier = fileURLToPath(new URL('./verify-package.mjs', import.meta.url));
    const verified = spawnSync(process.execPath, [verifier, app], { stdio: 'inherit' });
    check(verified.status === 0, 'the packaged app builds a routing graph (verify-package.mjs)');
  }
} finally {
  spawnSync('hdiutil', ['detach', mount, '-quiet'], { stdio: 'inherit' });
  rmSync(mount, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed. Nothing should be published from this DMG.`);
  process.exit(1);
}

const sha = createHash('sha256').update(readFileSync(dmg)).digest('hex');
console.log(`\nAll checks passed for ${dmg}`);
console.log(sha);
