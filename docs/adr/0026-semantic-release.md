# ADR 0026: Version numbers come from semantic-release, in two halves

Status: accepted
Date: 2026-11-17
Builds on ADR 0009 (ad-hoc signing), ADR 0013 (Valhalla compiled locally) and
ADR 0024 (0.1.0 stays the GPL release).

## Context

The owner asked for semantic-release to number versions. It reads the commit
messages since the last tag and picks the next version: `fix:` a patch,
`feat:` a minor, a breaking change a major. The repository's commits already
use that form.

semantic-release is usually run in CI, where it decides the version, then
builds and publishes. TrailRT cannot be built in CI. The bundled Valhalla
engine is compiled from source on the owner's Mac and is not in the
repository (ADR 0013), and the version is baked into the DMG. Licensing
policy also asks for the DMG to be committed in the same commit as the source
it was built from.

There were no tags. Without one, semantic-release's first release is 1.0.0.

## Decision

**A release has two halves, both using `release.config.mjs`.**

1. On the Mac, `npm run release:prepare` (`scripts/release-prepare.mjs`)
   checks it is on a clean `main` level with GitHub. It asks semantic-release,
   as a dry run with only the commit analyser, for the next version. It sets
   that version in `package.json`, runs `npm run package`, and commits the
   version and the DMG together as `chore(release): <version>`. It does not
   push.
2. Pushing that commit runs `.github/workflows/release.yml` on an Apple
   silicon runner. semantic-release works the version out again.
   `scripts/release-verify.mjs` stops the release unless that is
   `package.json`'s version and the DMG passes `scripts/check-dmg.mjs`.
   semantic-release then tags that commit `v<version>` and publishes the
   GitHub release. The notes are made from the commits, followed by the
   install notes in `.github/release-notes.md`, and the DMG and its checksum
   are attached.

If commits land between the two halves and change the version, the release
stops and says to run `release:prepare` again. No DMG is ever published under
a version it was not built as.

**`v0.1.0` tags commit 8e1d3de**, "release: TrailRT 0.1.0 for macOS". That is
the GPL release ADR 0024 describes. The next release is therefore 0.2.0, the
first under MIT.

**semantic-release 25.0.9, not 26.** 26.0.0 and 26.0.1 were published on
16 November 2026, the day before this decision. 26.0.1 depends on beta
releases of its own core, commit analyser and notes generator. The toolchain
policy says newest is not best when it is not yet stable. 25.0.9, from
August, depends only on stable releases and supports Node 26. Revisit when
26's dependencies leave beta.

**No changelog file, and no commit from CI.** The release notes live on the
GitHub release. A `CHANGELOG.md` written by `@semantic-release/git` would mean
CI pushing commits to `main`, and the release commit would no longer be the
commit the DMG was built from.

## Consequences

- Releasing is `npm run release:prepare`, then `git push`.
- `chore:`, `ci:` and `docs:` commits do not cause a release. Only `feat:`,
  `fix:`, `perf:` and breaking changes do.
- `scripts/generate-licences.mjs` now reads npm's old `{ "type": … }` licence
  form and the "Apache 2.0" spelling, both met in semantic-release's tree and
  checked against the packages' licence files.
- semantic-release adds 35 audit findings to the development tree. None reach
  the shipped app, whose 5 findings are unchanged, and the tools run only in
  the release job.
