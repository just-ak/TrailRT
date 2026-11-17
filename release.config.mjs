// SPDX-License-Identifier: MIT
/**
 * semantic-release: the next version comes from the commit messages since the
 * last tag (fix: a patch, feat: a minor, BREAKING CHANGE: a major). ADR 0026.
 *
 * TrailRT cannot be built in CI, because the bundled Valhalla is compiled on
 * the owner's Mac (ADR 0013). So a release has two halves:
 *
 * 1. On the Mac, `npm run release:prepare` asks this same configuration for
 *    the next version, sets it in package.json, packages the DMG and commits
 *    them together as `chore(release): <version>`, so the DMG sits in the same
 *    commit as its source (licensing.md).
 * 2. Pushing that commit to main runs .github/workflows/release.yml, which
 *    runs semantic-release for real: it checks the version it works out is the
 *    one the DMG was built as, checks the DMG, tags the commit, and publishes
 *    the GitHub release with notes made from the commits.
 */
import { readFileSync } from 'node:fs';

// The install notes follow the generated changelog in every release.
const install = readFileSync(new URL('./.github/release-notes.md', import.meta.url), 'utf8')
  .replaceAll('{{VERSION}}', '<%= nextRelease.version %>')
  .replaceAll('{{FILE}}', 'TrailRT-<%= nextRelease.version %>-arm64.dmg');

export default {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/exec',
      {
        // Before anything is tagged: the version, and the DMG built as it.
        verifyReleaseCmd: 'node scripts/release-verify.mjs ${nextRelease.version}',
        // The DMG and its checksum, where the GitHub step uploads them from.
        prepareCmd: 'node scripts/release-verify.mjs ${nextRelease.version} --assets',
      },
    ],
    [
      '@semantic-release/github',
      {
        assets: [{ path: 'release-assets/*' }],
        releaseBodyTemplate: `<%= nextRelease.notes %>\n\n${install}`,
        // No comments on issues and pull requests, and no issue opened when a
        // release fails: the workflow run says what went wrong.
        successComment: false,
        failComment: false,
        failTitle: false,
        releasedLabels: false,
      },
    ],
  ],
};
