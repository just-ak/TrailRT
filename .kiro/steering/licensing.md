# Licensing and distribution

The application is **MIT**. It is free to download and use, with no
subscriptions, no mandatory accounts, no advertising, no paid feature tiers and
no cloud dependency for core functionality. See ADR 0024, which replaced the
GPL-3.0 licence of ADR 0007 so the app can be offered on the Mac App Store.
Releases made before that change (0.1.0) remain GPL-3.0-or-later.

These are policy, not preferences. Do not introduce a paywall, an account
requirement, a feature gate or ad delivery on any channel, and do not make core
functionality depend on a network service.

## Before adding any dependency

Check the licence first. Adding it and auditing later is how incompatible code
ends up shipped.

```sh
npm view <package> license
```

| Licence                                                                       | Shipped in the app                                    | Build-only            |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------- |
| MIT, ISC, BSD-2/3-Clause, 0BSD, Apache-2.0, BSL-1.0, Zlib, Unlicense, CC0, Blue Oak | Fine                                            | Fine                  |
| MPL-2.0                                                                       | Fine — file-level; publish any change to its files    | Fine                  |
| LGPL-2.1+, LGPL-3.0                                                           | **Review first.** Relinking terms are contested under App Store signing. Record the decision in an ADR. | Fine |
| GPL (any version), AGPL                                                       | **Reject.** It would bind the MIT app, and its terms conflict with the App Store. | Fine if it never reaches users |
| Hippocratic, ethical-source, or any licence with field-of-use restrictions    | **Reject.** Not open source.                          | **Reject**            |
| `SEE LICENSE IN …`, `UNLICENSED`, bilateral EULAs                             | **Reject** unless the text is read and confirmed compatible. Assume not. | Same |
| No declared licence                                                           | **Reject.**                                           | **Reject**            |

When a package offers a choice, such as `MIT OR GPL-3.0-or-later`, use it under
the permissive licence and say so in the register. `npm run licences` fails
on any GPL, LGPL or AGPL package in the npm tree.

A separate executable bundled in the app is still shipped in the app. Running
it as a child process does not make GPL acceptable, because the App Store terms
would then apply to the GPL program itself. That is why osmium-tool was
replaced (ADR 0023) and why GPSBabel cannot be bundled (ADR 0024).

## The register

`docs/licences/third-party-register.md` must be regenerated whenever
dependencies change, and the change committed alongside. Native components
are maintained by hand in `docs/licences/native-and-data.md`, which the
generator appends. A register that lags the lockfile is a compliance failure,
not an inconvenience.

## Obligations on every release

- Reproduce third-party notices in the About window, including Electron's and
  Chromium's. MIT, BSD and BSL all require the notice to travel with the app.
- Keep `LICENSE` at the repository root as the MIT text.
- Carry `SPDX-License-Identifier: MIT` headers on source files.
- Publish the source with each release. It is no longer a licence obligation,
  but it is project policy. While an LGPL library is bundled, offer its source
  too.

## Distribution channels

1. **GitHub releases plus a DMG** for direct download, the primary channel. The
   DMG is also committed under `downloads/` through Git LFS, in the same commit
   as the source it was built from. There is no Developer ID yet, so builds are
   **ad-hoc signed** and notarisation is configured but disabled. See ADR 0009,
   and document the Gatekeeper consequence honestly rather than hiding it.
   `.github/workflows/publish-dmg.yml` publishes the committed DMG as release
   `v<version>` once `scripts/check-dmg.mjs` has checked it, whenever a DMG
   under `downloads/` changes on `main`. It does not build the DMG, because
   the bundled Valhalla is compiled locally (ADR 0013). A published release is
   never replaced: a new DMG needs a new version in `package.json`.
2. **The Mac App Store**, permitted by ADR 0024 and not available yet. Phase 15
   holds the requirements: Apple Developer Program membership, the App
   Sandbox, an `mas` build target, the geos licence question, and App Review.
   Do not add the `mas` target or sandbox entitlements outside that phase's
   tasks. The app stays free there, with no in-app purchases.

## Garmin formats

Prioritise functionality and Garmin compatibility over licensing caution, within
the law and within the table above.

Two limits remain absolute: no circumvention of encryption, DRM or map
licensing, and no proprietary SDK whose EULA restricts redistribution — which
includes Garmin's own FIT SDK. Use the MIT-licensed FIT parser instead. GPL
tooling such as GPSBabel (GPL-2.0-or-later) may be used on a developer machine
to make test fixtures, but may not be bundled.
