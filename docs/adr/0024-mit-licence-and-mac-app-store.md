# ADR 0024: TrailRT is relicensed MIT, and the Mac App Store becomes a target

Status: accepted
Date: 2026-11-16
Supersedes ADR 0007's choice of licence and its App Store exclusion, which
ADR 0009 repeated. ADR 0007's free-distribution policy stands. Amends ADR 0006
(GPSBabel) and ADR 0023 (why osmium-tool was removed).

## Context

The owner wants to publish TrailRT on the Mac App Store. ADR 0007 made the app
GPL-3.0-or-later and ruled the App Store out. Apple's terms add usage rules and
FairPlay copy protection, and GPL-3.0 §10 forbids imposing further
restrictions on recipients. That is why GPL programs have been withdrawn from
the store, and it holds whatever the app's dependencies are. So the bundled
osmium-tool (ADR 0023) was not the only obstacle. TrailRT's own licence was.

The owner holds the copyright. Every commit in the repository has one author,
and the code written with Kiro and Claude Code was written for the owner. A
copyright holder may license their own work again under other terms.

## Decision

**TrailRT is licensed MIT**, from this commit on. `LICENSE` holds the MIT text,
`package.json` says `MIT`, and the About window and the Help menu say so.

The owner chose MIT over Apache-2.0 and over GPL with an App Store exception.
It is the simplest permissive licence, it puts no conditions on the store, and
it adds no obligations of its own beyond keeping the notice.

**Releases already published stay GPL-3.0-or-later.** The 0.1.0 DMG and the
source it was built from were offered under GPL, and that grant cannot be
withdrawn. Anyone may keep using, changing and sharing that version under
those terms. The change applies from this commit forward.

**The Mac App Store is a permitted distribution channel.** It is not
available yet. Phase 15 holds the work, and nothing ships to the store until
its requirements are met. The DMG through GitHub releases stays the primary
channel. The free-distribution policy is unchanged: no price, no
subscriptions, no paid tiers, no mandatory accounts, no advertising, and no
cloud dependency for core functionality, on any channel.

### The dependency rule changes

Under GPL, any GPL-compatible licence could come in. Under MIT, with App Store
distribution in view, **anything that ships must not be copyleft in a way that
binds the app or conflicts with the store**:

| Licence | Shipped in the app | Build-only |
| --- | --- | --- |
| MIT, ISC, BSD, 0BSD, Apache-2.0, BSL-1.0, Zlib, Unlicense, CC0, Blue Oak | Fine | Fine |
| MPL-2.0 (file-level copyleft) | Fine. Changes to MPL files are published. | Fine |
| LGPL-2.1+, LGPL-3.0 | **Review case by case.** Its relinking terms are contested under App Store signing. | Fine |
| GPL (any), AGPL | **Reject.** | Fine if it never reaches users |
| Hippocratic, ethical-source, field-of-use restrictions, no licence, `UNLICENSED` | Reject | Reject |

Where a dependency offers a choice, we take the permissive one: jszip is
`MIT OR GPL-3.0-or-later`, and we use it under MIT. `npm run licences` enforces
this. It now fails on any GPL, LGPL or AGPL package in the tree, where it used
to pass them.

### Native components

- **libspatialite and readosm** offer MPL-1.1, GPL-2.0-or-later or
  LGPL-2.1-or-later. ADR 0013 chose LGPL to fit GPL-3.0. We now choose
  **MPL-1.1**, which needs no relinking and suits the store.
- **geos** is LGPL-2.1-or-later and nothing else. It is dynamically linked
  into Valhalla. That satisfies the LGPL for the DMG. Whether it satisfies the
  LGPL in the App Store, where the user cannot replace a library inside a
  signed bundle, is contested. Phase 15 settles it: drop geos from the shipped
  closure if Valhalla's runtime does not need it, or get advice. Until then
  it is recorded as the open licence question.
- **trailrt-osm** (ADR 0023) is our own code, so it is MIT too.

### Amendments

- **ADR 0006 / 0007, GPSBabel.** GPSBabel is GPL-2.0-or-later. It is no longer
  permitted to bundle it in the app. Phase 9 must find another route for GDB,
  or leave it unsupported, and say so.
- **ADR 0023.** osmium-tool was removed so the app could be offered on the
  Mac App Store, as this ADR records.
- **ADR 0008.** react-leaflet stays out. Hippocratic-2.1 is still not open
  source and still imposes field-of-use restrictions, whatever our own licence.
- **Garmin FIT SDK.** Still excluded. Its EULA restricts redistribution, which
  no licence of ours changes, and the MIT parser works.

## Consequences

- `.kiro/steering/licensing.md` is rewritten for MIT. The rule against the App
  Store is gone, and the store's own requirements move to Phase 15.
- Per-file headers say `SPDX-License-Identifier: MIT`.
- The About window keeps its third-party notices. MIT, BSD and BSL all
  require them, and that obligation never depended on GPL.
- The project no longer has to offer corresponding source with each binary.
  It will keep publishing the source anyway. Nothing in this decision makes
  TrailRT closed.
- Anyone may now ship a closed fork of TrailRT. That is the cost of MIT, and
  the owner accepted it to reach the App Store.
