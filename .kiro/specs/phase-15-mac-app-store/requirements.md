# Phase 15: The Mac App Store — Requirements

Status: requirements only (16 November 2026), from the owner's direction. Not
designed. Its licence prerequisite is done (ADR 0024). The rest is part
investigation, because two of its questions decide whether the store build can
ship at all.

Depends on Phase 7 (the bundled tools), Phase 10 (place data) and Phase 11
(linked folders). It does not depend on Phases 8, 9, 12 or 13. Its order
relative to them is the owner's call.

## Introduction

The owner's direction, 16 November 2026:

> we need to remove the osmium cli. for licensing reasons, can we switch to
> libosmium instead so we can publish on apple store

followed by the choice of MIT for TrailRT's own licence. Two things are done
already: osmium-tool was replaced by `trailrt-osm` on libosmium (ADR 0023),
and TrailRT was relicensed MIT, with the App Store made a permitted channel
(ADR 0024).

This phase is everything else the store requires. The DMG stays the primary
channel and must not get worse. The store build is the same app, free, with
the same features. Anything that cannot work inside the sandbox is disabled
with an explanation, never silently missing (architecture rule: honesty about
limitations).

### What the codebase establishes

From the code on 16 November 2026. The design must confirm these again.

- **Child processes.** The app runs bundled executables:
  `valhalla_build_tiles`, `valhalla_build_admins` and `valhalla_build_timezones`
  (`main/routing/regionImport.ts`), and `trailrt-osm` (`mergeExtracts.ts`,
  `places/extract.ts`). It also runs `/usr/bin/stat` to find iCloud placeholder
  files (`linkedFolders/dataless.ts`). In the sandbox, a child process inherits
  the sandbox and must be signed with `com.apple.security.inherit`.
- **LuaJIT.** `valhalla_build_tiles` and `valhalla_build_admins` run LuaJIT.
  They are signed with `allow-unsigned-executable-memory`
  (`build/entitlements.valhalla-tools.plist`), and the kernel kills them
  without it once LuaJIT compiles anything. It is not known whether App Review
  accepts that entitlement in a store build. This is the riskiest item in the
  phase.
- **Linked folders are stored as plain paths.** `linked_folders.path` and
  `real_path` are text (`db/schema.ts`). A sandboxed app can read a
  user-chosen folder only for the session it was chosen in, unless it keeps a
  security-scoped bookmark. Every linked folder would stop working after a
  restart.
- **Data lives in `app.getPath('userData')`** (`main/paths.ts`). In the
  sandbox that is inside the app's container, not
  `~/Library/Application Support/TrailRT`. A user moving from the DMG to the
  store build would appear to lose their library.
- **Network.** Geofabrik extracts, Terrain Tiles, OS Code-Point Open and map
  tiles are all fetched by the main process or the renderer. That needs the
  `network.client` entitlement only.
- **Thumbnails** use `nativeImage.createThumbnailFromPath`, in process. They
  work wherever the folder is readable.
- **No self-updater** is installed (no `electron-updater`). The store forbids
  one, and none needs removing.
- **The build** is electron-builder with `appId: com.trailrt.app`, arm64 only,
  macOS 13.3 minimum, ad-hoc signed (ADR 0009), and a custom signing hook
  (`build/sign-mac.cjs`).
- **The licence** is MIT, and nothing GPL is bundled. geos (LGPL-2.1-or-later,
  inside Valhalla) is the one open licence question
  (`docs/licences/native-and-data.md`).

## Requirements

### Requirement 1: Licence clearance

**Deliverable:** a recorded decision, before any submission.

1. THE store build SHALL contain no GPL or AGPL code, and `npm run licences`
   SHALL pass for it.
2. THE investigation SHALL establish whether the shipped addon and tools need
   geos at run time. IF they do not, THEN geos SHALL be removed from the
   shipped closure. IF they do, THEN the decision on shipping LGPL in a signed
   store bundle SHALL be recorded in an ADR, with the advice it rests on.
3. libspatialite and readosm SHALL be used under MPL-1.1, as ADR 0024 elects.

### Requirement 2: Apple Developer Program and identities

1. THE owner SHALL hold Apple Developer Program membership. This is an owner
   action with an annual fee. The phase cannot complete without it.
2. THE bundle ID `com.trailrt.app` SHALL be registered for the store. IF it is
   unavailable, THEN the design SHALL decide whether the DMG keeps its own ID,
   and what that means for data (Requirement 6).
3. THE store build SHALL be signed with an Apple Distribution certificate and
   a Mac App Store provisioning profile. The installer package SHALL be signed
   with a Mac Installer Distribution certificate. Signing material SHALL never
   be committed (`.gitignore` already excludes `*.p12` and
   `*.mobileprovision`).
4. THE same membership SHALL give the DMG a Developer ID, and ADR 0009's
   notarisation SHALL be switched on in the same change.

### Requirement 3: The store build target

1. `electron-builder.yml` SHALL gain an `mas` target alongside `dmg`, built
   from Electron's Mac App Store variant, arm64 only, macOS 13.3 minimum.
2. THE store build SHALL use separate entitlement files from the DMG. The DMG
   build SHALL NOT gain the sandbox.
3. `npm run package` SHALL keep producing and committing only the DMG. The
   store package SHALL be built by its own command and SHALL NOT be committed
   to `downloads/`.

### Requirement 4: The App Sandbox

1. THE store build SHALL run with `com.apple.security.app-sandbox`, and only
   these further entitlements unless the design justifies more:
   `network.client`, `files.user-selected.read-write`,
   `files.bookmarks.app-scope`, and the JIT entitlements Requirement 5
   establishes.
2. EVERY bundled executable SHALL be signed with `com.apple.security.app-sandbox`
   and `com.apple.security.inherit`, and SHALL be shown to run from the
   sandboxed app (a region build, a merge, a place extract).
3. THE investigation SHALL establish whether running `/usr/bin/stat` from the
   sandbox works. IF it does not, THEN the iCloud placeholder check SHALL use
   an in-process equivalent.

### Requirement 5: LuaJIT in the store

**Deliverable:** a findings document, then the chosen fix.

1. THE investigation SHALL establish whether a store build may carry
   `allow-unsigned-executable-memory` on the graph tools, or whether
   `allow-jit` alone suffices for LuaJIT on Apple silicon.
2. IF neither is accepted, THEN it SHALL measure the region build with LuaJIT's
   JIT compiler disabled (interpreter only) on the three Buxton counties, and
   report the time against today's build.
3. IF no option gives a working region build in the store, THEN the store
   build SHALL NOT ship region downloads in a broken form. It SHALL either not
   be submitted, or say plainly in the app and the listing what it cannot do.
   The owner decides which.

### Requirement 6: Files and folders across restarts

1. EACH linked folder SHALL store a security-scoped bookmark, created when the
   user picks it, and SHALL resolve it at launch before any scan or watch.
2. A bookmark that is stale or can no longer be resolved SHALL leave the
   folder linked and marked as needing access again, with one action to grant
   it. Its photos and index entries SHALL NOT be deleted.
3. ANY other remembered location, such as the last import or export folder,
   SHALL either keep a bookmark or fall back to asking.
4. Folders linked in the DMG build, which have no bookmark, SHALL ask for
   access once in the store build rather than failing silently.

### Requirement 7: Moving from the DMG to the store

1. THE store build SHALL detect a TrailRT library from the DMG build that it
   cannot see.
2. IT SHALL offer to bring it in, with the user granting access to the old
   data folder through the open panel. It SHALL copy, never move, and SHALL
   leave the old library untouched.
3. A user who declines SHALL start with an empty library and be told where
   the old one is.

### Requirement 8: Privacy and the listing

1. THE App Privacy details SHALL declare that no data is collected, which is
   true today. Any later change that collects data SHALL update them first.
2. THE investigation SHALL establish whether the store requires a privacy
   manifest (`PrivacyInfo.xcprivacy`) for Electron's use of required-reason
   APIs, and supply one if so.
3. THE listing SHALL state that the app is free with no in-app purchases,
   needs Apple silicon and macOS 13.3, downloads map regions from Geofabrik on
   request, and shows the OpenStreetMap, Terrain Tiles and Ordnance Survey
   attributions the About window already carries.

### Requirement 9: Verification

1. A store-build counterpart of `scripts/verify-package.mjs` SHALL check the
   sandboxed app: entitlements on the app and every executable, a tile build,
   a merge and a place extract from inside the sandbox.
2. A manual checklist SHALL cover what Playwright cannot drive in the sandbox:
   linking a folder, quitting, relaunching, and seeing its thumbnails, and the
   DMG-to-store migration.
3. THE store build SHALL go through TestFlight for macOS before its first
   submission.
4. THE DMG's `npm run verify` and `npm run verify:package` SHALL still pass.

## Constraints carried from the rest of the project

- Free on every channel: no price, no in-app purchase, no account, no ads
  (licensing steering, ADR 0024).
- Arm64 only (ADR 0013).
- Imported and linked content stays untrusted, and the CSP does not loosen for
  the store build (architecture steering).
- Linked folders are read-only to TrailRT, as ADR 0020 says. Bookmarks need
  read access only, until Phase 12 writes.

## Out of scope

- iPhone and iPad.
- Any paid tier, in-app purchase or subscription.
- A self-updater for the DMG. That is separate from this phase, if ever.

## Unresolved questions for the owner

1. Apple Developer Program membership: whose account, and when?
2. If LuaJIT cannot run in the store (Requirement 5.3), should the store build
   wait or ship with region builds unavailable?
3. Should the DMG and the store build share the bundle ID, which makes
   migration simpler, or be kept apart?
