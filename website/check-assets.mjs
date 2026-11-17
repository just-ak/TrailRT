// SPDX-License-Identifier: MIT
//
// Runs before every deploy. Two things can publish a broken site without any
// error from Wrangler:
//
//   1. The promo video is stored in Git LFS. A clone that did not fetch LFS
//      objects has a 130-byte pointer file where the video should be, and the
//      Worker would serve that pointer as video/mp4. Cloudflare does not say
//      whether Workers Builds fetches LFS, so this fetches it if it can and
//      fails loudly if it cannot.
//   2. A Worker's static assets are limited to 25 MiB per file.

import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_BYTES = 25 * 1024 * 1024;
const LFS_HEADER = 'version https://git-lfs.github.com/spec/';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function isLfsPointer(path) {
  if (statSync(path).size > 1024) return false;
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(LFS_HEADER.length);
  readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  return buf.toString('utf8') === LFS_HEADER;
}

let pointers = files(PUBLIC).filter(isLfsPointer);
if (pointers.length > 0) {
  console.log(`Fetching ${pointers.length} Git LFS file(s): ${pointers.map((p) => relative(PUBLIC, p)).join(', ')}`);
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const include = pointers.map((p) => relative(root, p)).join(',');
    execFileSync('git', ['lfs', 'pull', '--include', include], { cwd: root, stdio: 'inherit' });
  } catch (error) {
    console.error(`git lfs pull failed: ${error.message}`);
  }
  pointers = pointers.filter(isLfsPointer);
  if (pointers.length > 0) {
    console.error(
      'Refusing to deploy: these files are still Git LFS pointers, not their content:\n  ' +
        pointers.map((p) => relative(PUBLIC, p)).join('\n  ') +
        '\nInstall git-lfs and run `git lfs pull`, then deploy again.',
    );
    process.exit(1);
  }
}

const tooBig = files(PUBLIC).filter((p) => statSync(p).size > MAX_BYTES);
if (tooBig.length > 0) {
  console.error(
    'Refusing to deploy: a Worker static asset may be at most 25 MiB:\n  ' +
      tooBig.map((p) => `${relative(PUBLIC, p)} (${(statSync(p).size / 1048576).toFixed(1)} MiB)`).join('\n  '),
  );
  process.exit(1);
}

console.log('Assets checked: no LFS pointers, nothing over 25 MiB.');
