# Phase 11: Geotagged Photos from a Linked Folder — Tasks

Execute in order. Pure modules come first, each proven offline, then storage
and the main process, then the UI, then the end-to-end and verification pass.

Update `docs/progress-mindmap.svg` as each task changes status.

- [x] 1. Spec, ADR 0020 and the out-of-order build
  - `design.md`, `tasks.md`, ADR 0020; README row and decision index; the note
    that this phase is built ahead of Phases 8 and 9 at the owner's request
  - Measurements in design §0: metadata readers compared, scan cost, Quick Look
    thumbnails and orientation, targets
  - Mindmap: the phase's leaves become these tasks
  - Revised 12 November 2026 with the owner's answers: the linked folder is the
    trip's folder on disk, so storage is a general file index (design §2);
    fingerprints for moves (§5.3); an all-trips map (§9.1); 40,000-photo
    targets (§0), with hashing and clustering measured
  - _Requirements: 2.2, 9.4_

- [x] 2. Synthetic photo fixtures
  - `test-data/photos/exifWrite.ts`: EXIF writer, both byte orders, every tag in
    design §3.3, with deliberate malformations (no reference, zero denominator,
    out of range). TypeScript beside `places.ts` rather than
    `scripts/lib/exif-write.mjs`, so it is type-checked and tests import it as
    `@fixtures/photos/exifWrite`; the generator imports it directly (Node 26
    strips types)
  - `scripts/generate-fixtures.mjs`: base JPEGs converted by `sips` from a BMP
    the script writes (no Electron step needed), HEIC through `sips`, and the
    folder tree in design §13.1
    (nested, hidden, symlink out, `.photoslibrary`, `notes.png`, burst,
    truncated and fake files, plus `tracks/day-1.gpx`, `tracks/day-2.fit` and
    `clip.mov` for the index) under `test-data/generated/photos/`
  - Every location from `@fixtures/places`; none invented
  - Unit tests: the writer round-trips through the task 3 parser once that
    exists; until then, byte-level checks of the TIFF header and IFD counts
    (`src/shared/photos/exifWrite.test.ts`, 17 tests). Every generated fixture
    was also read back with `exifr` as an independent check: both byte orders
    and both HEIC files decode to the values written
  - _Requirements: 11.2, 11.3_

- [x] 3. TIFF parsing and EXIF values (pure)
  - `shared/photos/tiff.ts`: both byte orders, `ExifIFD` and `GPSInfo`
    pointers, bounds-checked offsets, IFD cycles refused
  - `shared/photos/exifValues.ts`: DMS to degrees with hemisphere signs;
    altitude reference; accuracy; direction with `T`/`M`; 0°, 0°,
    out-of-range, zero-denominator and missing-reference rejection with
    reasons; `DateTimeOriginal` validation; `OffsetTimeOriginal` parsing;
    orientation 1–8
  - No text fields read
  - Unit tests: south and west negative (a Buxton fixture with `W` dropped
    lands ~250 km east and fails); altitude −12.25 m; absent altitude is null;
    each rejection with its reason; time with `+01:00`, `-05:30` and none;
    invalid dates refused; every orientation value; big- and little-endian
    blocks give identical results
  - Done: `tiff.test.ts` and `exifValues.test.ts`, 82 tests, built on the
    task 2 writer (the round trip it promised). The parser decodes only the
    wanted tags, so the writer's `Make` text is provably never read
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 11.1_

- [x] 4. Containers and the metadata reader
  - `shared/photos/containers.ts`: `RangeReader`; JPEG marker walk to the Exif
    `APP1`; HEIC `ftyp` brands, `meta` → `iinf` → `iloc` (versions 0–2), one
    extra ranged read when the item lies past the first 64 KB; typed failures
  - `shared/photos/PhotoMetadataReader.ts` interface and
    `shared/photos/exifReader.ts` implementation
  - `main/linkedFolders/fileReader.ts`: the one place that opens a file in a
    linked folder,
    `O_RDONLY | O_NOFOLLOW`, closed in `finally`; signature checks against the
    extension
  - Unit tests: every fixture from task 2; an `iloc` extent past 64 KB read
    with exactly one extra read; truncated and fake files give their reasons
    and do not throw; a reader handed a 5 MB file reads at most 64 KB plus the
    item's length
  - Done: `containers.test.ts` (HEIC built box by box across `iloc` versions
    0–2 and 0/4/8-byte fields, every read counted, 4,000 corrupted inputs
    without a throw) and `fileReader.test.ts` (every fixture through the real
    file system, symlinks refused, descriptors counted through `/dev/fd` and
    proven to catch a missing `close`, fixtures unchanged after reading)
  - _Requirements: 2.2, 2.8, 9.2, 11.1_

- [x] 5. Storage: linked folders and the file index
  - `schema.ts`: `linked_folders`, `folder_files`, `photo_metadata` per design
    §2; migration `0006_linked_folders.sql` (version 7) generated and
    registered
  - `db/repositories/linkedFolders.ts`, `folderFiles.ts`, `photoMetadata.ts`:
    upsert by `(folder_id, relative_path)`, batched `deleteMissing`,
    `movePath`, counts by kind and state, taken-time order, column-wise map
    points for one trip or all trips, de-duplicated by
    `(real_path, relative_path)`, with year and trip filters
  - `WaypointSource` gains `'photo'`; `isWaypointSource` updated
  - Unit tests: migration applies on a Phase 10 database and is idempotent;
    the `CHECK`s refuse half a coordinate, a located row without one, and a
    direction without its reference; trip deletion cascades through all three
    tables; ordering puts photos with no taken time last; a folder linked to
    two trips yields its photos once in all-trips points
  - Done: `src/main/db/linkedFolders.test.ts`, 27 tests; `npm run verify`
    passes (142 end-to-end). The migration is hand-written, like 0002–0005,
    because the drizzle journal stops at 0001. The collection format accepts
    a `photo` waypoint source, as Phase 10 did for `poi`
  - _Requirements: 3.2, 3.3, 3.8, 5.6, 7.2, 10.1_

- [x] 6. Linking, refusals, undo and the write guard
  - `main/services/linkedFolderService.ts`: `chooseFolder` (token, design
    §4.1), `link`, `unlink`, `restore`, `relink`, `setIncludeSubfolders`, `list`;
    `real_path` resolved at link and relink
  - Refusals from design §4.2 with their messages: `.photoslibrary`, same
    folder twice, nested either way, TrailRT's data folder, `EPERM`/`EACCES`;
    real-path and NFC comparison
  - Commands `linkedFolder:unlink`, `linkedFolder:restore`,
    `linkedFolder:relink`, `linkedFolder:setIncludeSubfolders`. The
    `reconcile()` call after undo and redo moved to task 7, which builds the
    scanner it calls
  - Trip duplication copies link, index and metadata rows
  - `main/linkedFolders/writeGuard.ts` `assertNotInLinkedFolder`, called by
    all four handlers that write to a path the user chose: export, Save a
    Copy, calendar export and Save image (design §7.3)
  - Unit tests: each refusal; a symlinked spelling of a linked folder is caught;
    link → unlink → undo restores the same folder id; relink keeps rows matched
    by relative path; export into a linked folder is refused
  - Done: `linkedFolderService.test.ts`, 25 tests, against a temp tree with a
    symlinked and a differently-cased spelling, a `.photoslibrary` and a
    folder macOS refuses; `npm run verify` passes (142 end-to-end)
  - _Requirements: 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 3.5, 8.1_

- [x] 7. Scanner, fingerprints and watcher
  - `main/linkedFolders/classify.ts`: photo, geodata and video extensions
    (design §3.1)
  - `main/linkedFolders/scanner.ts`: async walk (design §5.1) skipping hidden
    entries, packages, symlinks and, when off, subfolders; counts of what was
    skipped; geodata and video indexed by size and `mtimeMs`, never opened
  - Incremental: unchanged size and `mtimeMs` are not opened; deletion only
    after a complete walk, in one transaction
  - Fingerprints and move pairing (design §5.3)
  - `reconcile()` called by the IPC layer after every undo and redo, and after
    link, unlink, restore and relink (carried from task 6)
  - Not downloaded: `blocks === 0` candidates confirmed by batched
    `/usr/bin/stat -f '%f'` (`execFile`, no shell); `.icloud` placeholders
  - Folder states `available` / `scanning` / `missing` / `denied`; launch scan;
    focus rescan; 30 s check while missing; `fs.watch` recursive as a debounced
    hint; scans start after the window has shown
  - Progress events at most every 250 ms; `AbortSignal` cancel; yields every
    200 files; one walk per folder, at most two folders at once
  - Unit tests against a temp copy of the fixtures: first scan counts by state;
    a second scan opens no file (spy on the reader); a deleted file's row goes;
    an interrupted walk deletes nothing; renaming the folder makes it `missing`
    with rows kept, and renaming back restores it without relinking; the
    dataless path never opens a candidate; a symlink out is never followed; a
    renamed photo keeps its row id and metadata; two candidates sharing a
    fingerprint are not paired; a GPX file is indexed and never opened (spy on
    the reader)
  - Measured: 100 watchers at once, recorded in design §5.7
  - Done: `scanner.test.ts` (28) and `folderScanner.test.ts` (10, one against
    the real `fs.watch`, stable over 15 runs once the stream is let start);
    `npm run verify` passes (142 end-to-end). The cancellation tests found a
    real defect, fixed: a rescan with nothing to read never checked the
    signal, so a cancelled scan could still delete rows. Events reach the
    renderer in task 8
  - _Requirements: 1.4, 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 8.2, 9.1, 9.2, 9.5_

- [x] 8. Path resolution, thumbnails, IPC and preload
  - `main/linkedFolders/resolve.ts` per design §7.2
  - `main/photoCache/thumbnails.ts`: Quick Look at 640 px, JPEG 80, cache
    layout and 512 MB bound from design §6.2, launch sweep; never for a
    `not-downloaded` photo
  - The `linkedFolders` and `photos` IPC namespaces and events from design
    §7.1, zod schemas, results, preload entries by name; `photos:open` and
    `photos:reveal` by id
  - ~~File › Link Folder to Trip… menu item~~ moved to task 9: a menu item
    with no dialog behind it would do nothing (design §4.1)
  - Read-only source scan test over `src/main/linkedFolders/` (design §7.3)
  - Unit tests: `..` and symlink-out refused by `resolve`; a changed photo gets
    a new thumbnail name; eviction keeps the bound; every handler rejects a
    malformed payload; the source scan fails when a write API is added (proven
    with a temporary file in the test)
  - Done: `resolve.test.ts` (11), `thumbnails.test.ts` (13),
    `readOnly.test.ts` (4), `linkedFolderHandlers.test.ts` (18, the real
    handlers registered against a stubbed Electron) and `photoService.test.ts`
    (4); `npm run verify` passes (1,875 unit, 142 end-to-end). A mutation
    check confirmed the symlink tests fail without the containment check.
    `photos:addWaypoints` and `photos:forWaypoint` arrive with their service
    in task 12. Divergences recorded in design §4.1, §6.2, §7.1, §7.2, §7.3
  - _Requirements: 1.1, 6.6, 8.2, 8.3, 8.4, 8.5, 9.3_

- [x] 9. Library: tree, Photos view and the photo list
  - Tree: Linked folders group and `linkedFolder` nodes (design §8.1);
    `ObjectKind`, `TreeNodeKind` and `ViewId` additions; folder properties with
    counts by kind, Rescan, Relink, Unlink (with its confirmation) and Include
    subfolders
  - Photos view: Year and Trip filters from `photos:years` (design §8.2)
  - Link dialog with Include subfolders; icon button in trip actions; trip
    context menu item; File › Link Folder to Trip… (moved from task 8, so it
    arrives with the dialog it opens)
  - The renderer listens for scan progress and folder changes
    (`events.onLinkedFolderScanProgress`, `events.onLinkedFoldersChanged`)
  - Drawer kind `photos`: virtualised list in taken-time order with states and
    reasons; selection opens the preview and pans to an off-screen photo;
    multi-select
  - Day counts for dated trips, with "(camera time)" when guessed
  - Unit tests: tree with and without photos; the Photos view across trips;
    the year filter, with "No date"; day assignment by wall-clock date, with
    the camera-time flag; list rows for every state; properties counting
    files not read yet
  - Done: `libraryPhotos.test.ts` (9, the tree against a real database),
    `shared/photos/library.test.ts` (12) and `photoSelection.test.ts` (6);
    a new end-to-end spec, `tests/e2e/photos.spec.ts` (6), links a copy of
    the fixtures through the real chooser handler, then checks the tree, the
    properties, the list, the refusal of a second link, the Photos view and
    unlink with undo; `npm run verify` passes (1,903 unit, 148 end-to-end). The preview and the pan to an
    off-screen photo read the list's selection in tasks 11 and 10. Recorded
    in design §8.1 to §8.3
  - _Requirements: 1.1, 1.3, 1.8, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 10. Photo map layer, one trip and all trips
  - `photoStore` with trip and all-trips modes (design §9.1);
    `features/map/usePhotoLayer.ts` with viewport clustering
    (design §9.2); inseparable bursts; direction wedge on the selected photo;
    unavailable styling
  - Layers menu: Photos and Show unavailable photos; `layerVisibility.photos`
    and `photoUnavailable` settings with schema and defaults
  - Unit tests: viewport filtering bounds the marker count by screen cells; the
    burst rule (< 1 m, or maximum zoom); 50,000 synthetic points re-cluster
    within the §0 target on the target hardware; selecting the Photos view
    switches to all-trips mode and leaving it switches back
  - Done: `mapLayer.test.ts` (11) and `photoMapScope.test.ts` (5); three
    more end-to-end checks in `photos.spec.ts` (markers on the map, the
    selected photo's wedge facing 271° true, the seven-photo burst at Leek,
    the Layers toggle, the Photos view's all-trips mode and back);
    `npm run verify` passes (1,919 unit, 151 end-to-end). Re-clustering
    50,000 photos measured at 6.0 ms at worst, against 50 ms. Recorded in
    design §9.2 and §9.4
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 11. The preview box
  - `MapCornerStack` holding the readout, the panel toggles and the preview box
    (design §10.1)
  - `features/photos/PhotoPreview.tsx`: thumbnail via `blob:` URL (revoked on
    change); name with relative-path hint; taken time with zone or "camera
    time"; location, altitude and accuracy only when present; unlocated reason
  - Icon-button actions with hints; arrow keys and Escape while focused;
    unavailable and not-downloaded states with the cached thumbnail
  - Unit tests: the view model's text for every state; nothing rendered for an
    absent altitude or accuracy; "1 of N" stepping within a burst
  - Done: `previewModel.test.ts` (12) and three more cache tests (16 in
    all); three more end-to-end checks in `photos.spec.ts` (the box above
    the toggles with a `blob:` picture, the keys stepping and closing it, its
    fit in the smallest window; a burst opening at "1 of 7 here"; an
    unplugged folder's photo saying so and showing its saved thumbnail);
    `npm run verify` passes (1,934 unit, 154 end-to-end). Task 8's cache had
    to learn to serve a saved thumbnail without the source; the test also
    caught focus lost after one arrow press. Add as a waypoint arrives with
    task 12. Recorded in design §10.3 and §10.4
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [ ] 12. Photo to waypoint, export and backups
  - `main/services/photoWaypointService.ts`: one photo → one waypoint; several →
    one batch; unlocated skipped and reported (design §11)
  - Waypoint properties: Show photo via `photos:forWaypoint`
  - Collection writer drops `metadata.photo`
  - Backup and restore UI text (design §12)
  - `photos:forWaypoint` lookup by path, then fingerprint in the folder, then
    fingerprint across the trip's folders (design §11.3)
  - Unit tests: altitude null stays null; symbol `photo`; one undo for a batch
    of 20; the waypoint survives unlinking and the photo's deletion; undoing a
    deletion keeps the link; the link survives a rename and a move to another
    of the trip's folders; a collection export contains no `photo` key or
    relative path
  - _Requirements: 7.1, 7.2, 7.3, 8.6, 10.1, 10.2, 10.3_

- [ ] 13. End-to-end and verification pass
  - `tests/e2e/photos.spec.ts` with the chooser stubbed: located on the map and
    unlocated listed; preview box in the bottom-left, clear of the panel
    toggles and scale bar by bounding box; stepping; add as waypoint and undo;
    folder missing and back; persistence across a restart
  - Read-only proof: hash and modified time of every fixture before and after
    link, scan, thumbnails, add-as-waypoint, unlink, relink and rescan
  - Measurements against the §0 targets on a generated tree of 40,000
    photos (3 MB files) across 100 folders, recorded in design §0; the
    all-trips map with 50,000 points; launch with every folder linked
  - iCloud Drive check on a real folder with an undownloaded file, with the
    owner's permission; design §15 updated with the result
  - `npm run verify` and `npm run package` (with `verify:package`) pass
  - _Requirements: 3.6, 9.1, 9.4, 9.5, 11.4, 11.5_
