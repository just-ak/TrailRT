# Phase 11: Geotagged Photos from a Linked Folder — Design

Written against the code after Phase 10, with the uncommitted fix for the
packaged tile builder (`build/sign-mac.cjs`, `src/main/routing/toolExit.ts`)
in the tree. ADR 0020 records the decisions that are more than implementation.

**Revised on 12 November 2026** after the owner's feedback (requirements,
"The trip's folder on disk"). The linked folder is the trip's folder on disk,
which Phase 12 extends to GPX and Phase 13 to video. This phase therefore keeps
a general **file index** of each linked folder rather than a photo table alone
(§2). It adds fingerprints so a moved photo keeps its links (§5.3), and a map of
every trip's photos (§9.1). It is sized for a 40,000-photo library (§0). In the
code and the UI the folder is a **linked folder**, because the library's
existing folders hold trips (`folderService.ts`).

**Built out of order.** The owner asked for this phase on 11 November 2026,
ahead of Phases 8 and 9. It depends only on Phases 1–3 and 10, which are
complete. As with Phase 10, the README's rule against designing ahead exists to
stop guessing at unsettled interfaces, and every interface used here has
shipped.

## 0. Measurements

Taken on 11 November 2026 on the target hardware: Apple M4, 24 GB, internal
SSD, macOS 26.6.2, Node 26.13.0, Electron 45.2.3. The scripts are reproduced by
task 2's fixture generator and task 13's measurement test.

**Fixtures.** JPEGs made by Electron's `nativeImage`, with an EXIF block from a
small in-house writer: GPS at Buxton and Leek, an altitude below sea level, an
orientation-6 photo, a time with and without an offset, 0°, 0°, and no GPS.
HEICs converted from those by `sips` (Apple's ImageIO encoder, the one the
iPhone uses). `sips` kept GPS, time, offset and orientation, and rewrote the
TIFF block big-endian (`MM`), so the reader must handle both byte orders.

**Where the metadata sits.**

| File | Size | EXIF block |
| --- | --- | --- |
| 1200×800 JPEG | 16 KB | APP1, byte 2 |
| 4032×3024 HEIC from `sips` | 175 KB | start of `mdat`, byte 2,838 |

Apple's encoder puts the EXIF item first in `mdat`, but HEIF does not require
it. The `iloc` box says where it is, so the general reader follows `iloc` and
costs one extra ranged read when the item is further in.

**Metadata readers.**

| Candidate | Result |
| --- | --- |
| `exifr` 7.1.3 (MIT, last release May 2022) | Its file reader **fails on Node 26**: it calls the file APIs with arguments they no longer accept, and an unclosed `FileHandle` then aborts the process. Given buffers, its parser reads every fixture correctly. Error reporting is opaque: a truncated HEIC returns `undefined`, a truncated JPEG returns `{"errors":[{}]}`. |
| `exiftool-vendored` 39.2.0 (MIT) + ExifTool 13.63 | Runs ExifTool on the **system Perl**, which Apple has deprecated, as an extra process. 22 MB unpacked. The same class of hidden host dependency that broke the 0.1.0 tile build (ADR 0013 amendment). Not tested further. |
| In-house | Chosen. See §3 and ADR 0020. |

**Scan cost, 10,000 files** (5,000 JPEG, 5,000 HEIC, 20 folders, warm cache):

| Step | Time |
| --- | --- |
| Walk and `stat` every file | 31 ms |
| Read the first 64 KB of each and parse it (`exifr` on buffers) | 223 ms, 22 µs per file |

Parsing is negligible. The cost of a first scan is I/O, which is asynchronous,
so the scan does not need a worker thread (§5.5).

**Hashing**, measured 12 November 2026 (Node 26 `crypto`, SHA-256):

| Input | Time |
| --- | --- |
| 64 KB, the bytes already read for a photo's metadata | 0.023 ms |
| A whole 3 MB photo, already in memory | 0.95 ms |
| A 2 MB GPX file | 0.62 ms |

So a hash of the whole of every photo is affordable for the CPU but not for the
disk. 40,000 photos of 3 MB is 120 GB to read: about 20 minutes from a USB hard
drive at 100 MB/s, on every first scan. A photo's **fingerprint** is therefore a
hash of its size and the first 64 KB, which the metadata read has already
fetched, so it costs nothing extra (§5.3). Whole-file hashes are kept for GPX
and other track files, which are small. Phase 12 needs them to tell whether a
file is in step.

**Clustering**, 50,000 points in 100 trip-sized clumps around the world,
`clusterPoints` over the whole set:

| Zoom | Time | Clusters |
| --- | --- | --- |
| 2 | 4.0 ms | 72 |
| 6 | 4.7 ms | 754 |
| 10 | 8.6 ms | 37,477 |
| 14 | 9.1 ms | 49,937 |

Clustering the whole all-trips set is cheap at every zoom. The cost to bound is
the number of markers drawn at high zoom, which the viewport limit handles
(§9.2).

**Thumbnails** with `nativeImage.createThumbnailFromPath` (Quick Look):

| Source | 640 px, first | 640 px, again |
| --- | --- | --- |
| 4032×3024 JPEG | 38 ms | 5 ms |
| 4032×3024 HEIC | 41 ms | 5 ms |

Quick Look **applies the orientation tag** and keeps the aspect ratio: the
orientation-6 fixture came back portrait, with its corner marker rotated 90°
clockwise. HEIC needs no new dependency.

**Targets** the tests hold to (Requirement 9.4), set with headroom over the
measurements because synthetic images compress better than real ones and the
cache was warm:

| Measure | Target |
| --- | --- |
| First scan, 40,000 mixed JPEG and HEIC of 3 MB each, internal SSD | ≤ 20 s |
| Unchanged rescan, the same 40,000 across 100 linked folders | ≤ 2 s |
| First preview, thumbnail not yet cached | ≤ 250 ms |
| Preview with a cached thumbnail | ≤ 50 ms |
| Loading the all-trips map points, 50,000 located photos | ≤ 300 ms |
| Re-cluster and redraw on `moveend`, 50,000 located photos | ≤ 50 ms, ≤ one marker per 56 px cell in view |
| Window shown at launch | Before any folder is scanned (Requirement 9.5) |

The rescan target comes from the measured walk: 31 ms to `stat` 10,000 files,
so about 125 ms for 40,000, leaving the rest for comparing against the index.

A cold-cache first scan cannot be measured without `sudo purge`. Task 13 records
the cold figure if the owner runs it, and the target above stands until then.

## 1. Invariants this phase collides with, and how each is resolved

| Invariant | Collision | Resolution |
| --- | --- | --- |
| Phase 1 `attachments` copies files into app storage | Copying a photo library doubles disk use and drifts | Separate tables, `linked_folders`, `folder_files` and `photo_metadata`. Nothing is copied. ADR 0020 §1 says why both models exist. |
| The library already has folders, which hold trips (`folderService.ts`) | "Trip folder" would mean two things | The code and the UI say **linked folder** (`linked_folders`, `main/linkedFolders/`, "Link Folder to Trip…"). |
| Phases 12 and 13 read the same folders | A photo-only table would leave them a second walk and a second index | One `folder_files` index per linked folder, with a `kind`. This phase records GPX, other track files and video, and reads only photos (§2, §5.2). |
| Waypoints made from a photo point back at it | Photos get moved and renamed within a folder | A fingerprint identifies a photo whose path changed (§5.3). The waypoint keeps the fingerprint, so the link survives without the scanner rewriting waypoints (§11.3). |
| CSP: `img-src 'self' data: blob:` and tile hosts; no `file:` | The renderer must show photos | Thumbnails cross IPC as bytes and become `blob:` URLs, which the policy already allows. **No CSP change and no custom protocol.** (§6.3) |
| The renderer never receives a path to read | Previews, Open, Show in Finder | Everything is by photo id. The main process resolves the path and checks it is inside a linked folder (§7.2). |
| The library tree is rebuilt whole on every change | A folder can hold tens of thousands of photos | Photos are **not tree nodes**. The tree has one node per linked folder (Requirement 4.1); the photos are listed in a virtualised drawer (§8.3). |
| Undo carries bounded inverses (ADR 0014) | Unlinking drops thousands of cache rows | The inverse restores the folder row with the same id, and a rescan rebuilds the cache. Anything made from a photo carries `(folderId, relativePath, fingerprint)`, which survives (§4.4). |
| Backups are a SQLite snapshot of the whole database | Thumbnails must stay out (Requirement 10.3) | Thumbnails live on disk under the app support directory; the cache metadata is in the database and is backed up (§12). |
| Missing stays missing | EXIF fields are often absent; cameras write 0°, 0° | Every optional value is a nullable column. 0°, 0° is rejected with a reason (§3.3). |
| Collection export writes `metadata` verbatim | Photo provenance would leave the machine (Requirement 8.6) | The collection writer strips the `photo` key (§11.3). GPX, KML and CSV never write `metadata`. |
| The POI layer clusters every point, globally | 50,000 photos at high zoom become 50,000 DOM markers | The photo layer clusters only the points in view (§9.2). |
| Bottom-left: scale bar at `bottom-3`, panel toggles at `bottom-12` | The preview box goes in the same corner | The three move into one flex column, so the preview box stacks above the others and none of them is positioned by guesswork (§10.1). |
| Trip management references no concrete provider | Photo metadata reader | `PhotoMetadataReader` is an interface in `shared/photos/`. The scanner is handed an implementation (§3.5). |
| The main process must stay responsive | Scanning 40,000 files at launch | Asynchronous I/O and cooperative yields, measured in §0, after the window shows. No worker thread (§5.5). |

## 2. Storage — migration `0006_linked_folders.sql`

Three new tables. Nothing existing changes, except that `waypoints.source`
gains the value `'photo'`. That column has no `CHECK`, so only the TypeScript
type and `isWaypointSource` change.

```sql
CREATE TABLE linked_folders (
  id                  TEXT PRIMARY KEY,
  trip_id             TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  path                TEXT NOT NULL,          -- absolute, as chosen; never sent to be read
  real_path           TEXT NOT NULL,          -- fs.realpath, NFC; for containment and de-duplication
  name                TEXT NOT NULL,          -- basename at link time, for display
  include_subfolders  INTEGER NOT NULL DEFAULT 1,
  last_scan_at        INTEGER,                -- null until the first scan finishes
  last_seen_at        INTEGER,                -- last time the folder was reachable
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (trip_id, real_path)
);

-- The file index. One row per recognised file, of any kind.
CREATE TABLE folder_files (
  id             TEXT PRIMARY KEY,
  folder_id      TEXT NOT NULL REFERENCES linked_folders(id) ON DELETE CASCADE,
  relative_path  TEXT NOT NULL,               -- POSIX separators, NFC
  kind           TEXT NOT NULL,               -- 'photo' | 'geodata' | 'video'
  format         TEXT NOT NULL,               -- 'jpeg' | 'heic' | 'gpx' | 'kml' | 'kmz' | 'tcx' | 'fit' | 'mov' | 'mp4' | 'm4v'
  size_bytes     INTEGER NOT NULL,
  mtime_ms       REAL NOT NULL,               -- stat's fractional milliseconds, compared exactly
  fingerprint    TEXT,                        -- §5.3; null for a file not read (every non-photo in this phase)
  UNIQUE (folder_id, relative_path),
  CHECK (kind IN ('photo','geodata','video'))
);
CREATE INDEX idx_folder_files_kind ON folder_files(folder_id, kind);
CREATE INDEX idx_folder_files_fingerprint ON folder_files(folder_id, fingerprint);

-- What was read from a photo. A cache, rebuilt from the file.
CREATE TABLE photo_metadata (
  file_id           TEXT PRIMARY KEY REFERENCES folder_files(id) ON DELETE CASCADE,
  state             TEXT NOT NULL,            -- 'located' | 'unlocated' | 'unreadable' | 'not-downloaded'
  reason            TEXT,                     -- why unlocated or unreadable; null when located
  lat               REAL,  lon REAL,          -- both or neither
  altitude_m        REAL,
  accuracy_m        REAL,
  direction_deg     REAL,
  direction_ref     TEXT,                     -- 'T' | 'M'; null with no direction
  taken_local       TEXT,                     -- 'YYYY-MM-DDTHH:MM:SS', the wall clock as recorded
  taken_offset_min  INTEGER,                  -- null = camera time, no zone
  orientation       INTEGER,                  -- 1..8, null when absent
  CHECK (state IN ('located','unlocated','unreadable','not-downloaded')),
  CHECK ((lat IS NULL) = (lon IS NULL)),
  CHECK (state <> 'located' OR lat IS NOT NULL),
  CHECK ((direction_deg IS NULL) = (direction_ref IS NULL))
);
CREATE INDEX idx_photo_metadata_taken ON photo_metadata(taken_local);
CREATE INDEX idx_photo_metadata_state ON photo_metadata(state);
```

- **One index for every kind.** `folder_files` is what Phases 12 and 13 build
  on. Phase 12 adds its sync record beside it, keyed by `file_id`, and fills
  `fingerprint` for track files with a whole-file SHA-256. Phase 13 adds video
  metadata the same way. Neither needs a second walk or a second watcher.
  Non-photo rows are counted in this phase and never opened (Requirement 3.8).
- **A folder's availability is not stored.** Whether it is reachable, missing
  or refused by macOS is worked out at runtime and held by the scanner. A
  stored "missing" flag would be wrong the moment the drive came back.
  `last_seen_at` is kept so the UI can say "last seen 3 days ago".
- **Files removed from disk are deleted from `folder_files`** (Requirement
  3.3), and their metadata goes with them by cascade. Files in a missing folder
  are not, because absence of the folder says nothing about the files
  (Requirement 3.4).
- **A photo's identity is its path within the folder, then its fingerprint.**
  Row `id`s are stable while the row exists, including across a move the
  scanner recognises (§5.3), but nothing outside the cache refers to them.
- **`real_path`** is resolved at link and relink time. It drives the
  containment refusals (§4.2) and lets the all-trips map show a folder linked
  to two trips once (§9.1).
- Drizzle definitions are added to `schema.ts`. The SQL is **hand-written**
  as `0006_linked_folders.sql`, migration version 7, like 0002 to 0005: the
  drizzle-kit journal stops at 0001, so `db:generate` would emit every table
  since. The table definitions above also gain `CHECK`s for the direction
  reference (`T` or `M`) and orientation (1–8).
- `mtime_ms` is **REAL**, not INTEGER. `stat` reports fractional
  milliseconds, and the scanner compares the stored value with a fresh one
  exactly. Truncating it would make every unchanged file look changed.
- The collection format (`shared/io/collection.ts`) accepts a `photo`
  waypoint source, as Phase 10 did for `poi`.

Repositories: `db/repositories/linkedFolders.ts`, `db/repositories/folderFiles.ts`
and `db/repositories/photoMetadata.ts`. They provide upsert by `(folder_id,
relative_path)`, a batched `deleteMissing(folderId, keepPaths)`, `movePath`,
counts by kind and state, taken-time order, and compact map points.

## 3. Reading location and time

### 3.1 Formats

`.jpg`, `.jpeg` and `.heic`, matched case-insensitively, then confirmed by the
file's signature: `FF D8 FF` for JPEG, an `ftyp` box whose major or
compatible brands include `heic`, `heix`, `heim`, `heis` or `mif1` for HEIC.
`mif1` is the generic HEIF brand, so an AVIF named `.heic` is read the same way,
which is correct: the EXIF item is found the same way in any HEIF file. A file whose signature does not match its extension is
`unreadable`, with the reason "Not a JPEG image" or "Not a HEIC image"
(Requirement 2.8).

PNG, TIFF, DNG and other raw formats are **not offered** (Requirement 2.2).
They are counted, not listed: a folder's properties say "41 files in formats
not supported yet (PNG, DNG)" so their absence is explained, not hidden.

Files for later phases are recognised by extension only and never opened
(Requirement 3.8): `.gpx`, `.kml`, `.kmz`, `.tcx` and `.fit` as `geodata`, and
`.mov`, `.mp4` and `.m4v` as `video`. The folder's properties say "14 GPX and
track files and 210 videos — not read yet". The extension list sits in
`main/linkedFolders/classify.ts`, the one place Phases 12 and 13 extend.

### 3.2 Containers — `shared/photos/containers.ts` (pure)

Works over a `RangeReader` interface, `read(offset, length): Promise<Uint8Array>`,
so it is pure and unit-testable against in-memory buffers.

- **JPEG:** walk the markers from `SOI` until `SOS`. Return the first `APP1`
  segment that starts `Exif\0\0`. One read of the first 64 KB covers it;
  APP1 is capped at 64 KB by the format.
- **HEIC:** read the first 64 KB and walk the top-level boxes to `meta`. In
  `meta`, find the `Exif` item in `iinf` and its extent in `iloc` (versions 0–2,
  construction method 0, offset and length sizes 0, 4 or 8). If the extent lies
  past the first read, make one more read of exactly that range. The item
  starts with a 4-byte offset to the TIFF header, which is skipped.
- Any inconsistency (a box running past the end, an extent past the file, an
  `iloc` version we do not handle) returns a typed failure with a reason, not
  an exception.

### 3.3 Values — `shared/photos/tiff.ts` and `shared/photos/exifValues.ts` (pure)

`tiff.ts` parses a TIFF block in either byte order and reads only the tags
below, following the `ExifIFD` (`0x8769`) and `GPSInfo` (`0x8825`) pointers.
Every offset is bounds-checked, and cycles in the IFD chain are refused.

| Tag | Use |
| --- | --- |
| `0x0112` Orientation | 1–8, else null |
| `0x9003` DateTimeOriginal | taken time |
| `0x9011` OffsetTimeOriginal | its zone, `±HH:MM` |
| GPS `0x01`/`0x02`, `0x03`/`0x04` | latitude, longitude with their references |
| GPS `0x05`/`0x06` | altitude reference (1 = below sea level) and altitude |
| GPS `0x1F` | horizontal positioning error → accuracy in metres |
| GPS `0x10`/`0x11` | direction reference and direction |

`exifValues.ts` turns raw values into domain values:

- Degrees, minutes and seconds to decimal degrees. `S` and `W` are negative.
  Any other reference (absent, or not `N`/`S`/`E`/`W`) makes the geotag
  malformed rather than guessing a hemisphere.
- **Rejected geotags** (Requirement 2.5), each with its reason: exactly 0°, 0°
  ("Location recorded as 0°, 0° — usually a camera with no GPS fix"); latitude
  outside ±90 or longitude outside ±180; a zero denominator; a missing
  reference or component. The photo is `unlocated` and keeps the reason.
- Altitude: `ref = 1` negates. Absent altitude is null (Requirement 2.4).
- Accuracy and direction: null when absent; direction is normalised to
  [0, 360). Only `T` (true north) and `M` (magnetic) are accepted, and the
  reference is stored with the value so the UI can say which.
- **Text fields are not read.** Title, description and comments are not needed
  by any requirement. Not reading them is the simplest way to treat them as
  untrusted (Requirement 2.7).

### 3.4 Time (Requirement 2.6)

`DateTimeOriginal` is stored as `taken_local`, exactly as recorded, after
validating it as a real date and time. `OffsetTimeOriginal`, when present and
valid, becomes `taken_offset_min`. Otherwise the offset is null and the UI says
"camera time".

**The GPS timestamp is not used to infer a zone.** It is the time of the last
fix, which can be minutes or hours stale on a camera that caches one. An offset
worked out from a stale fix would be confidently wrong, which is worse than an
honest "camera time". ADR 0020 §4.

Ordering ("taken-time order") sorts by `taken_local` as text, which is correct
within one camera's clock. Photos with no taken time sort last, by file name.

### 3.5 The reader interface

```ts
// shared/photos/PhotoMetadataReader.ts
export interface PhotoMetadataReader {
  read(file: RangeReader, format: PhotoFormat): Promise<PhotoReadResult>;
}
export type PhotoReadResult =
  | { ok: true; location: Geotag | null; locationRejected: string | null;
      taken: TakenTime | null; orientation: Orientation | null }
  | { ok: false; reason: string };
```

`shared/photos/exifReader.ts` implements it from §3.2 and §3.3. A file whose
container fails (not the image it claims, cut short) is `ok: false`, so the
photo is `unreadable`. A sound image whose EXIF block is missing or damaged is
`ok: true` with no location, and a damaged block's reason goes in
`locationRejected`, so the photo is `unlocated` with that reason: the image
itself is fine and can still be previewed. The scanner is
given a reader, so a second implementation (for raw formats, later) does not
touch the scanner, the services or trip management.

## 4. Linking, unlinking and relinking

### 4.1 Choosing a folder

Two IPC steps, like the import pipeline's staging:

1. `linkedFolders:chooseFolder({ tripId })` opens the native folder chooser in the main
   process. The choice is checked (§4.2) and held under a short-lived token.
   The renderer gets `{ token, name, displayPath, warnings }`. The path is for
   display only.
2. The renderer shows "Link *name* to *trip*", with **Include subfolders**
   ticked (Requirement 1.3), then sends `linkedFolders:link({ token, includeSubfolders })`.

Entry points (Requirement 1.1): an icon button with a hint in the trip's
properties actions (`TripDetails`, `data-testid="trip-actions"`), the trip's
context menu, and **File › Link Folder to Trip…**, which acts on the selected
trip. Native menu items are not enabled per selection anywhere in the app
(Rename, Duplicate and Delete Trip all act on the selection), so this one
follows them: chosen with no trip selected, it says "Select a trip to link a
folder to." rather than greying out. It arrives with the link dialog in task 9,
so it is never a menu item that does nothing. The wording names the folder and the trip,
not photos, so it stays right when Phase 12 adds GPX to the same link.

### 4.2 Refusals, with their explanations

| Case | Message |
| --- | --- |
| A `.photoslibrary` package, or a folder inside one (Requirement 1.5) | "This is an Apple Photos library. Its layout is private to Photos and changes between versions, so TrailRT does not read it. Export the photos to a folder (Photos › File › Export) and link that." |
| Already linked to this trip | "This folder is already linked to *trip*." |
| Inside, or containing, a folder linked to this trip (Requirement 1.6) | "This folder is inside *Name*, which is already linked to *trip*, so its photos are already shown." (or "contains") |
| Contains, or is inside, TrailRT's own data folder | "This folder contains TrailRT's own data, so it cannot be linked." This also keeps the thumbnail cache out of every linked folder (§7.3). |
| macOS refuses to list it, `EPERM` or `EACCES` (Requirement 1.7) | "macOS has not given TrailRT access to this folder. Allow it in System Settings › Privacy & Security › Files and Folders (or Full Disk Access), then rescan." It is never reported as empty. |

Containment compares real paths, with NFC normalisation, after resolving each
side, so a symlinked or differently-cased spelling of the same folder is still
caught. It must be the **native** `realpath` (`fs.promises.realpath`), which
returns the on-disk case on macOS; the JavaScript `fs.realpathSync` keeps the
case it was given, so it would miss a differently-cased spelling. Refusals are
`ServiceError('BLOCKED', message)`.

The same folder may be linked to **different** trips. Requirement 1.2 ties a
link to a trip, not the folder itself.

**TCC and ad-hoc signing.** macOS records folder permission against the app's
code signature, and an ad-hoc signature changes with every build, so each new
DMG can ask again. The message above covers that case. There is nothing to fix
until a Developer ID exists (ADR 0009).

### 4.3 Services — `main/services/linkedFolderService.ts`

`chooseFolder`, `link`, `unlink`, `restore`, `relink`, `setIncludeSubfolders`,
`list`. Each mutation returns `{ result, inverse }` like every other service.

### 4.4 Undo

| Action | Inverse | Notes |
| --- | --- | --- |
| Link | `linkedFolder:unlink` | |
| Unlink | `linkedFolder:restore` with the folder row | The cache rows are **not** carried. Restore re-inserts the row with the same id, and the scanner rescans it. Waypoints made from its photos still carry `(folderId, relativePath, fingerprint)`, so their links come back. |
| Relink to a new path | `linkedFolder:relink` with the old path | |
| Include subfolders on or off | `linkedFolder:setIncludeSubfolders` with the old value | Switching off deletes cache rows for nested photos on the next scan; switching back rescans them. |

`applyCommand` is synchronous. After any undo or redo, the IPC layer calls
`folderScanner.reconcile()`, which starts a scan for any folder row with no live
scan state. That is cheap when there is nothing to do.

Unlink asks for confirmation first: "Unlink *Name*? The files stay where they
are on disk. TrailRT forgets their locations and thumbnails." (Requirement 1.8).
It deletes the folder's thumbnail directory. Undo regenerates thumbnails on
demand.

**Trip deletion** cascades to the trip's folder rows. It is already
non-undoable (ADR 0001), and orphaned thumbnail directories are removed by a
sweep at launch. **Trip duplication** copies the link rows, index rows and
metadata rows under new ids (`copyLinkedFoldersForTrip`, inside the
duplication's transaction). Note that trip duplication in the code copies
**only the trip row**: its routes, tracks and waypoints are not copied, though
the comment in `tripService.duplicate` says they would be. That gap predates
this phase and is reported separately. The linked folders are copied
regardless, because this phase's own behaviour should be right. No files are touched. A
duplicated waypoint made from a photo still names the original trip's folder
id, so `photos:forWaypoint` finds its photo in the copy by fingerprint, through
the trip-wide lookup (§11.3).

### 4.5 Relinking (Requirement 3.5)

`linkedFolders:relink({ folderId })` opens the chooser and applies the same refusals.
It updates `path` and `real_path`, keeps every row, and rescans. Files are
matched by `relative_path`, so a moved folder comes back whole.

## 5. Scanning and watching — `main/linkedFolders/`

### 5.1 The walk

- `fs.promises.opendir`, iterating entries asynchronously.
- Skipped: names starting with `.`; macOS packages (directories ending
  `.app`, `.photoslibrary`, `.bundle`, `.pkg`, or carrying the package bit,
  which Node cannot read, so the suffix list is the check); symbolic links of
  any kind, from `Dirent.isSymbolicLink()`, so a link out of the folder is never
  followed (Requirement 8.2); and subfolders when `include_subfolders` is off.
- Each file is classified by `classify.ts` (§3.1): `photo`, `geodata`, `video`,
  or not recognised. Unrecognised files are not indexed.
- Skipped symbolic links and unsupported formats are counted, so the folder's
  properties can say what was left out.

### 5.2 Incremental reading (Requirements 3.2 and 9.2)

For each file found, `lstat` gives size and `mtimeMs`. A file whose index row
has the same size and modified time is **not opened**. A new or changed photo
is opened read-only (`O_RDONLY | O_NOFOLLOW`), and the reader makes its one or
two ranged reads (§3.2). The descriptor is closed in a `finally`. A new or
changed `geodata` or `video` file only has its row's size and modified time
updated, and is not opened in this phase. Rows for paths not seen in a complete
walk are deleted at the end, in one transaction, after move detection (§5.3).

A walk interrupted by an error, a cancellation or the folder vanishing deletes
nothing. Only a walk that finished can say a file is gone. A subfolder macOS
will not list makes the walk **partial**: the rest is read, and nothing is
deleted. Cancellation is checked again immediately before deletion, because a
rescan with nothing to read would otherwise never look at the signal (a defect
the task 7 tests found).

### 5.3 Fingerprints and moves (Requirement 3.7)

A photo's fingerprint is `SHA-256(size as 8 bytes ‖ first 64 KB)`, hex. Those
bytes are already in memory from the metadata read, so it costs 23 µs (§0). The
first 64 KB of a photo holds its EXIF block, with the capture time to the
second, and the start of its compressed image, so two different photos sharing
a fingerprint is not a practical concern. The pairing rule below does not rely
on that: an ambiguous match is simply not paired.

At the end of a complete walk the scanner has two sets: rows whose path was not
seen, and files read for the first time in this walk. A vanished row and a new
file are **paired** when they have the same size and fingerprint and no other
row or file in either set shares them. A pair is a move. The row's
`relative_path` is updated in place (`movePath`), so its id, metadata and
thumbnail survive. Anything unpaired is a removal or an addition, as before.

This covers moves and renames **within one linked folder**. A photo moved from
one linked folder to another is a removal and an addition. A waypoint made from
it still finds it through its fingerprint, because `photos:forWaypoint` looks
in every folder of the trip (§11.3).

**Not a whole-file hash.** It would cost a read of every byte of every photo
(§0), and nothing in this phase needs one. Phase 12 needs whole-file hashes for
GPX files, and they are small.

### 5.4 Not downloaded (Requirement 3.6)

Reading the first bytes of an iCloud Drive "dataless" file makes macOS download
the whole file, so the check has to happen **before** opening it. A dataless
file has the `SF_DATALESS` flag (`0x40000000`) and occupies no blocks. Node's
`Stats` exposes `blocks` but not `st_flags`, so:

1. `size > 0 && blocks === 0` marks a candidate, which costs nothing. A sparse
   local file looks the same, which is why the next step exists.
2. Candidates are confirmed in batches of up to 200 paths with `/usr/bin/stat
   -f '%f:%N'`, run with `execFile` and an argument array, never a shell. Each
   line carries its path, because `stat` keeps going past a file that has
   gone. Those with the flag are stored as `not-downloaded` and never opened.
   A candidate whose flags cannot be read is treated as not downloaded:
   wrongly listing a sparse file so is a small error, and wrongly opening a
   dataless file downloads it.
3. Legacy `.Name.ext.icloud` placeholders are listed as `not-downloaded` under
   their real name.

This is the same detection Finder's cloud badge relies on. It is **verified on
a real iCloud Drive folder only in task 13**, and the requirement stays
partially verified until then.

### 5.5 Responsiveness (Requirements 9.1 and 9.5)

The scanner is asynchronous end to end. It awaits every directory read, `lstat`
and file read, and yields with `setImmediate` after every 200 files whether or
not anything was awaited, so IPC handlers interleave. One scan runs per folder,
and a request to rescan a folder that is already scanning sets a "run again"
flag rather than starting a second walk. At most two folders scan at once, so a
library of 100 linked folders is worked through in turn rather than all at
once.

The map and library read the index, which is already in the database, so a
trip's photos are on the map at launch before any scan has started. Scans
begin after the window has shown (Requirement 9.5).

Progress is sent as `linkedFolders:scanProgress { folderId, phase, seen, read, total? }`
at most every 250 ms. A scan is cancelled through an `AbortSignal` from
`linkedFolders:cancelScan`. A cancelled scan keeps every row it had already updated.

**No worker thread.** §0 shows parsing at 22 µs per file. The rest is I/O, which
is already off the main thread. A worker would mean a second bundle entry and a
second database connection, for no measured gain.

### 5.6 When scans run (Requirement 3.1)

- At launch, every folder, after the window has shown.
- On request: **Rescan** in the folder's properties and context menu.
- When the watcher reports a change (§5.7), debounced by 2 s.
- When the app regains focus and a folder is missing or was last scanned more
  than 10 minutes ago.
- Every 30 s **while any folder is missing**, a single `stat` of each missing
  folder. When one reappears, it is scanned (Requirement 3.4).

### 5.7 Watching

`fs.watch(path, { recursive: true })`. On macOS this is FSEvents, which covers
internal and externally attached drives. It reports changes made on this Mac
only, so a **network volume** misses changes made by other machines. Its
events are treated as hints that trigger the incremental rescan, never as the
record of what changed. That makes a missed or coalesced event harmless,
because the rescan works the truth out from `stat`. For network volumes the UI
says "Changes made on other computers appear when you rescan." A watcher error
(the volume unmounting) marks the folder missing and starts the 30 s check.

There is one watcher per linked folder that is currently reachable. Each is an
FSEvents stream, which macOS handles cheaply. **Measured on 12 November 2026**:
100 recursive watchers opened in 3 ms in total, a change in each of the 100
reached its watcher within 59 ms, and the process grew by 7.7 MB. So one
watcher per folder stands; sharing one per volume is not needed.

An FSEvents stream takes a moment to start, and a change made in that moment
can be missed. That is the case the "hint, not record" rule exists for: the
focus rescan and Rescan catch it.

### 5.8 Folder states

| State | Meaning | Photos |
| --- | --- | --- |
| `available` | Reachable and scanned | Normal |
| `scanning` | A walk is in progress | Normal, with progress |
| `missing` | The path does not exist (Requirement 3.4) | Kept, drawn as unavailable with last known locations |
| `denied` | `EPERM`/`EACCES` (Requirement 1.7) | Kept, drawn as unavailable, with the System Settings message |

## 6. Thumbnails — `main/photoCache/`

### 6.1 Making them

`nativeImage.createThumbnailFromPath(path, { width: 640, height: 640 })`, then
`toJPEG(80)`. Quick Look applies orientation and handles HEIC (§0).

640 px covers the preview box at 2× density. It is made **only when the
preview asks for it** (Requirement 9.3). The map's markers do not use
thumbnails.

Before calling Quick Look, the path is resolved and checked by the same guard
as every other file access (§7.2). A `not-downloaded` photo is never passed to
Quick Look, because that would download it.

### 6.2 The cache

`<userData>/photo-thumbnails/<folderId>/<photoId>-<size>-<mtimeMs>.jpg`. The size
and modified time in the name mean a changed photo gets a new thumbnail, and
the stale one is swept.

Bounded at 512 MB (about 9,500 thumbnails at the measured size). A served
thumbnail's file `mtime` is set to now. When the total passes the bound, the
least recently served files are deleted down to 90%. Deleting the whole
directory is always safe, which is what "rebuildable at any time" means. A
launch sweep removes directories with no folder row, thumbnails of files no
longer indexed, and half-written files.

As built (task 8):

- The size and modified time in the name are read from the disk when the
  preview asks, not from the index, so a photo edited since the last scan gets
  a fresh thumbnail at once rather than after the rescan.
- The `not-downloaded` check is made twice: against the index, and against the
  disk at that moment (`blocks === 0`, confirmed by `stat`), because a photo
  can be evicted to iCloud after it was scanned.
- Two requests for the same thumbnail share one Quick Look call. A thumbnail
  is written beside its final name and renamed, so a reader never sees half a
  file, and a cached file that does not parse as a JPEG is made again.
- Folder directories with no row are removed after undo, redo and restoring a
  backup, as well as at unlink and launch, because all three can remove rows
  without passing through the unlink handler.
- The width and height are read from the JPEG's frame header, so a cached
  thumbnail is served without decoding it.

### 6.3 Serving them (Requirement 8.3)

`photos:thumbnail({ photoId })` returns `{ ok: true, data: { bytes: Uint8Array,
width, height } }`. The renderer wraps the bytes in a `Blob`, makes a `blob:`
URL, and revokes it when the preview changes. `blob:` is already in `img-src`.
`file:` stays out of the CSP, and there is no custom protocol to secure.

## 7. IPC, privacy and security

### 7.1 Channels — `shared/ipc/` namespaces `linkedFolders` and `photos`

Folder management is its own namespace, because Phase 12 adds GPX sync to the
same folders and must not need channels named after photos.

| Channel | Request | Notes |
| --- | --- | --- |
| `linkedFolders:chooseFolder` | `{ tripId }` | Opens the chooser; returns a token |
| `linkedFolders:link` | `{ token, includeSubfolders }` | |
| `linkedFolders:unlink` | `{ folderId }` | Undoable |
| `linkedFolders:relink` | `{ folderId }` | Opens the chooser |
| `linkedFolders:setIncludeSubfolders` | `{ folderId, include }` | Undoable |
| `linkedFolders:rescan` / `linkedFolders:cancelScan` | `{ folderId }` | |
| `linkedFolders:list` | `{ tripId? }` | Folder rows with counts by kind and state, and runtime state |
| `photos:list` | `{ folderId }` | Rows for the drawer, taken-time order |
| `photos:mapPoints` | `{ tripId } \| { all: true, year?, tripId? }` | Compact located points (§9.1) |
| `photos:years` | `{ includeArchived }` | Years with photos, and a count with no date, for the Photos view filter. Archived trips count only when the library shows them |
| `photos:get` | `{ photoId }` | One photo's details for the preview |
| `photos:thumbnail` | `{ photoId }` | Bytes |
| `photos:open` / `photos:reveal` | `{ photoId }` | `shell.openPath` / `shell.showItemInFolder` |
| `photos:addWaypoints` | `{ photoIds, tripId }` | One undo step. Task 12, with its service |
| `photos:forWaypoint` | `{ waypointId }` | The photo a waypoint came from, if available. Task 12 |

A photo id is its `folder_files.id`. Every request is validated with zod and
every handler returns a result. Events: `linkedFolders:scanProgress` and
`linkedFolders:changed`, which tells the renderer to reload folder and photo
data. The preload exposes each by name; there is no generic passthrough.
As built, the two events follow the app's existing naming for pushes,
`event:linkedFolderScanProgress` and `event:linkedFoldersChanged`, exposed as
`events.onLinkedFolderScanProgress` and `events.onLinkedFoldersChanged`.

### 7.2 Path resolution — `main/linkedFolders/resolve.ts`

`resolveFilePath(db, fileId)`:

1. Looks up the row and its folder.
2. Joins `folder.path` and `relative_path`, normalised. A relative path that
   escapes with `..` is refused. They are written only by the scanner, but this
   is checked anyway.
3. `realpath`s both, and refuses unless the file's real path is inside the
   folder's real path. A symbolic link that has appeared since the scan, and
   points out, is refused here (Requirement 8.2).
4. Refuses unless the folder is currently linked and `available`.

`photos:thumbnail`, `photos:open` and `photos:reveal` all go through it, so
"Open" and "Show in Finder" act only on paths the main process resolved
(Requirement 8.4).

The scanner does not call it per file, and needs no equivalent: it builds
paths only from entries it found by walking the folder itself, never follows a
symbolic link (`lstat` on every entry), and opens with `O_NOFOLLOW` (§5.1). The
first draft of this section said the scanner's reads went through
`resolveFilePath`; for 40,000 files that would be two extra `realpath` calls
each, for no protection the walk does not already give.

A folder that the scanner has marked `missing` or `denied` is refused with the
folder's own message before the disk is touched. `scanning` is not a reason to
refuse.

### 7.3 Read-only, enforced (Requirement 8.1)

Three layers, each tested:

1. **The access module cannot write.** `main/linkedFolders/` opens files only
   with `O_RDONLY | O_NOFOLLOW` through one helper. A unit test reads every
   source file in `src/main/linkedFolders/` and fails if any calls a write API (`writeFile`,
   `appendFile`, `createWriteStream`, `rename`, `rm`, `unlink`, `utimes`,
   `chmod`, `chown`, `copyFile`, `mkdir`, `truncate`, `symlink`, `link`, or the
   `w`/`a`/`+` open flags). As built, it also refuses `O_WRONLY`, `O_RDWR`,
   `O_CREAT`, `O_APPEND` and `O_TRUNC`, dynamic `import()`, and any child
   process except `execFile('/usr/bin/stat', …)`, which only reads flags
   (§5.4). Comments are stripped first, so prose is not mistaken for a call.
   The test proves itself on a temporary copy of the module with one
   offending file added at a time. Thumbnails live in `main/photoCache/`, which
   writes only below its own directory, and that directory cannot be inside a
   linked folder (§4.2).
2. **Every other writer is guarded.** The app writes outside its data
   directory in four places, all in `ipc/register.ts`: export, **Save a
   Copy…** of the database, calendar (`.ics`) export, and Save image. (The
   first draft of this design counted two; the code has four.) All four call
   `assertNotInLinkedFolder(db, path)` after the save dialog and before
   writing, and every other write in the main process goes into the app's
   own data folder, which §4.2 keeps out of every linked folder. It refuses a target inside any linked folder: "That folder is linked
   for photos, and TrailRT never writes into a linked folder. Choose somewhere
   else." Linked folders are read-only from TrailRT's point of view, including
   for new files.

   Phase 12 adds the one exception: GPX files TrailRT creates, written only by
   a separate sync module with its own rules (ADR 0020 §5). That module will
   live outside `main/linkedFolders/`, so the source scan above keeps holding
   for everything that reads photos.
3. **Proven by behaviour.** Requirement 11.4's test hashes every fixture file
   and records its modified time, links, scans, makes thumbnails, adds
   waypoints, unlinks, relinks and rescans, then checks every file is
   byte-identical with the same modified time.

### 7.4 No network (Requirement 8.5)

Nothing in the photo path makes a network request, and there is no reverse
geocoding. The CSP's `connect-src` is unchanged.

## 8. Photos in the library

### 8.1 Tree (Requirement 4.1)

A trip with linked folders gets a **Linked folders** `group` row, after its
routes, tracks and waypoints (or after the plan's days for a dated trip). It has
one `linkedFolder` node per linked folder. `TreeNodeKind` and `ObjectKind` gain
`'linkedFolder'`, so a folder is selectable, and its properties panel shows path,
state, counts by kind, Include subfolders, and Rescan, Relink and Unlink.

Node detail: "312 photos · 18 without location", with "· unavailable" or
"· no access" when the folder is not available. Files of kinds this phase does
not read appear in the properties panel, not the node detail, so the tree
stays short.

As built (task 9): hovering a folder row shows its real path. Linking a
folder opens its trip and the trip's Linked folders row, so the new row is in
view. The properties panel loads one folder through a `linkedFolders:get`
channel added for it, rather than listing every folder to find one. The
folder rows are built in the main process with the rest of the tree, and
their photo counts come from one grouped query for every folder.

### 8.2 The Photos view (Requirement 4.2)

`ViewId` gains `'photos'`, added to `VIEWS` after Waypoints: every linked folder
across visible trips, annotated with its trip's name, as the Routes view does.
It is a view, not a container (ADR 0004).

**Selecting the Photos view itself puts the map into all-trips mode**
(Requirement 5.6): every trip's located photos, through `photos:mapPoints({
all: true })`. Selecting a folder within the view loads its trip on the map, as
selecting a route in the Routes view does.

The view's header has two filters (Requirement 4.6), from `photos:years`:
**Year**, "All years" by default, with a "No date" entry when any photo lacks a
taken time; and **Trip**, "All trips" by default. Both narrow the folder list
and the all-trips map together. The year is the year part of `taken_local`,
the same wall-clock rule as §8.4.

As built (task 9): view rows have no header of their own, so the two filters
sit in a bar under the Photos row while it is open. The filter travels with
the tree request (`library:tree { photos: { year?, tripId? } }`), as the
object sort order already does, and the main process narrows the view's
folders, so the renderer never holds every folder's years. While a filter is
on, the Photos row keeps its chevron even when nothing matches, so the filter
can always be changed back. A trip's own Linked folders row is never
filtered. Selecting the Photos view itself, for the all-trips map, is task
10.

### 8.3 The photo list drawer (Requirements 4.3 and 4.4)

Selecting a `linkedFolder` node opens a new drawer kind, `{ kind: 'photos',
folderId }`, beside `calendar` and `poi`. Rows are in taken-time order: file
name, taken time (with zone, or "camera time"), and state ("No location —
recorded as 0°, 0°", "Not downloaded", "Unreadable — not a HEIC image",
"Unavailable"). It is virtualised with fixed row heights, as `PointTable` is,
so 40,000 rows cost the same as 30.

Selecting a row selects the photo: it opens the preview box, and a located
photo off screen is panned into view. Multi-select (shift and command, as in
the library) enables **Add as waypoints**.

As built (task 9): the drawer opens when a linked folder is selected, and
from Show Photos in its properties and context menu. The selection is held
in `photoStore` (`selection.ids`, `selection.anchor`), so the map layer (task
10) pans to the anchor and the preview box (task 11) shows it without either
knowing about the list. Up and down arrows move the selection. **Add as
waypoints** appears with task 12, which builds it: a button with nothing
behind it would do nothing.

### 8.4 Photos per day (Requirement 4.5)

For a dated trip, each day row's detail gains "· 23 photos". A photo is counted
on the day whose date equals the **date part of `taken_local`**, the wall clock
where and when it was taken. With a recorded offset that is exactly right.
Without one it assumes the camera's clock was set to local time, which is the
usual case and the only reasonable one. When any of a day's photos have no
zone, the detail reads "· 23 photos (camera time)", and its hint says the
assignment assumes the camera clock was on local time.

## 9. Photos on the map

### 9.1 Data

`photoStore` (zustand) has two modes. In **trip mode** it loads
`photos:mapPoints({ tripId })` for the trip `geometryStore` is showing. In
**all-trips mode**, while the Photos view is selected, it loads
`photos:mapPoints({ all: true, year?, tripId? })`. It reloads on
`linkedFolders:changed`.

Points are sent **column-wise**: `ids: string[]`, `lat` and `lon` as
`Float64Array`, `folder` as an index into a short `folders` array, and `dir` as
`(number | null)[]`. That keeps 50,000 points to about 2.5 MB, once per change.
Missing direction stays `null`, never a sentinel number.

In all-trips mode, a folder linked to more than one trip would put its photos
on the map twice. The query takes one row per `(linked_folders.real_path,
relative_path)`, the earliest-linked, so each photo appears once
(Requirement 5.6).

### 9.2 Layer — `features/map/usePhotoLayer.ts`

- A separate `L.layerGroup`, shown and hidden by a new **Photos** checkbox in
  the layers menu (`layerVisibility.photos`, default on) (Requirement 5.1).
- **Viewport clustering.** On `moveend` and `zoomend`, points inside the map
  bounds padded by half a screen are clustered with `clusterPoints` at the
  current zoom, and only those clusters are drawn. A cell is 56 px, so the
  marker count is bounded by the screen, not the library (Requirement 5.2,
  target in §0). A cluster shows its count. Clicking it zooms in to fit its
  members, or opens the preview at the first member when they cannot be
  separated (§9.3).
- Markers use a camera glyph in a dedicated colour, distinct from waypoints and
  POIs.

As built (task 10):

- The clustering is `shared/photos/mapLayer.ts`, pure and column-wise: it
  works on indices into the `Float64Array`s, so 50,000 points never become
  50,000 objects. Measured over 50,000 points across Great Britain, in a
  1,200 × 800 px view: at most 6.0 ms at any zoom (5.8 ms median at zoom 5,
  4.2 ms at zoom 8, under 1 ms from zoom 11), against the 50 ms target. The
  most markers drawn was 744, at zoom 8, against a bound of about 1,250 cells.
- `photos:mapPoints` returns points in taken-time order, undated last, so a
  burst's members are already in the order the preview steps through them.
- The selected photo is taken out of the clusters and drawn on its own, above
  them, so a selection is never hidden inside a cluster.
- A cluster counts as unavailable only when all its members are; a mixed
  cluster is drawn normally.
- The view's bounds and zoom are held as state, set on every `moveend` and
  `zoomend`, which is what triggers the redraw.
- Selecting the Photos view clears the library selection, so the map shows no
  single trip, then sets `photoStore.allTrips`. Selecting any object leaves
  it, through a subscription in `photoStore` to the selection store, so no
  caller has to remember to.
- Clicking a photo on the map selects it in `photoStore` but not in the
  library. The preview box (task 11) shows it.

### 9.3 Bursts (Requirement 5.3)

A cluster is **inseparable** when its members' bounding box spans less than one
metre, or the map is at its maximum zoom. Clicking it opens the preview at the
earliest member, with "1 of N" stepping through that burst in taken-time order.

### 9.4 Direction (Requirement 5.4)

The selected photo's marker, when it has a direction, shows a small wedge
rotated to the bearing, with "true" or "magnetic" in its hint. As built, the
reference comes from the selected photo's details (`photos:get`), which
`photoStore` loads for the anchor. The map's columns carry the bearing alone,
so 50,000 points do not each carry a letter only one marker uses. Other markers do
not, which keeps 50,000 markers plain.

### 9.5 Unavailable photos (Requirement 5.5)

Photos in a `missing` or `denied` folder are drawn with a dashed outline at
reduced opacity, and their hint says "Unavailable — *Folder* is not connected".
The layers menu has **Show unavailable photos** (`photoUnavailable: 'show' |
'hide'`, default `show`). They are never drawn the same as available ones.

## 10. The preview box

### 10.1 Placement (Requirements 6.1 and 6.2)

`MapReadout` and `PanelToggles` are each absolutely positioned today. They are
moved into one `MapCornerStack`: `absolute bottom-3 left-3`, a
`flex-col-reverse` column with a gap. The scale bar and readout come first,
the toggles second and the preview box third, so the box always sits **above**
the other two, and none of them needs a hand-picked `bottom-*` offset. The
stack's `max-height` is the map's height minus the top controls' band, so it
cannot reach the search box (top left) or the zoom and layer controls (top
right).

The box is inside the map's container, which already resizes with the panels
and the drawer. Its width is `min(320px, map width − 24px)`. The image keeps
its aspect ratio inside a box whose height is limited by the space left in the
stack, so on a short or narrow map it shrinks rather than overflowing.

### 10.2 Contents (Requirement 6.3)

- The thumbnail, already oriented by Quick Look.
- The file name, with its path inside the linked folder as a hint.
- Taken time: `14 Jun 2026, 10:32 (UTC+01:00)`, or `14 Jun 2026, 10:32 · camera
  time` with a hint that explains it.
- Location through `formatCoordinates` (`shared/geo/units.ts`). The app has
  one coordinate format and no user setting for it yet, so "the user's
  coordinate format" in Requirement 6.3 is that format. A setting, if one is
  added later, reaches the preview through the same function. Then altitude
  (`formatElevation`, in the user's units) and "±8 m" accuracy when present. Nothing when absent, never a dash
  or a zero. For an unlocated photo, "No location" and the reason.

### 10.3 Actions (Requirements 6.4 and 6.5)

Icon buttons with hints, from lucide-react: previous and next in taken-time
order (within the burst when opened from one, otherwise within the folder),
zoom to the photo, add as a waypoint, open in the default app, show in Finder,
and close. Location-dependent actions are disabled for an unlocated photo, with
a hint saying why.

The box is a `region` with a label. While focus is inside it, the left and
right arrow keys step and Escape closes.

As built (task 11):

- **Add as a waypoint** arrives with task 12, which builds what it does. The
  other actions are all here.
- Stepping goes through the burst when the photo was opened from one;
  otherwise through the photo's folder in taken-time order, taken from the
  open list when it is that folder and fetched with `photos:list` when not.
  A click in the list or on the map starts a new sequence, so a burst never
  lingers behind a later click.
- While the next photo's details load, the box keeps showing the last ones
  rather than unmounting. The first build unmounted for that moment, which
  lost keyboard focus after one arrow press, so Escape did nothing; the
  end-to-end test caught it.
- Accuracy uses the same unit formatting as altitude ("±8 m", "±26 ft").
- Not downloaded offers Show in Finder (which downloads it) but not Open.
- The box sits in `MapCornerStack` with `max-height: calc(100% − 84px)` and
  `max-width: calc(100% − 80px)`. At the app's smallest window, 1,024 × 700,
  with both side panels and the photo list open, the map is under 500 px
  tall and the box shrinks to fit. Tested.

### 10.4 Unavailable and not downloaded (Requirement 6.7)

The box says "Unavailable — *Folder* is not connected", or "Not downloaded from
iCloud — open it in Finder to download", and shows the cached thumbnail when one
exists. The cache can serve a thumbnail without resolving the source path, so
this works while the drive is unplugged.

As built (task 11): task 8's cache resolved the source path first, so it
could not do this. It now tries the source and, when the folder is missing or
denied, the file has gone, or the photo is not downloaded, serves the newest
thumbnail it holds for that photo, marked `fromCache`, which the box shows
faded. Only when there is none is the reason passed on. Open is disabled; Show in Finder stays
enabled when only the file is missing but the folder is there.

### 10.5 What is loaded (Requirement 6.6)

Only the 640 px thumbnail. The original is never read into the renderer;
**Open** hands it to the default app.

## 11. Using a photo's location

### 11.1 One photo (Requirement 7.1)

`photoWaypointService.addFromPhotos(db, { photoIds, tripId })` creates, for each
located photo, an ordinary waypoint: the photo's latitude, longitude and
altitude (null stays null), symbol `photo`, the file name without its extension
as the name, `source: 'photo'`, and `metadata.photo = { folderId, relativePath,
fingerprint }`.
One photo gives one `waypoint:delete` inverse.

### 11.2 Several (Requirement 7.3)

Several photos are wrapped in one `batch` (ADR 0014), so one ⌘Z removes them
all. Unlocated photos in the selection are skipped and reported ("12 added;
3 have no location").

### 11.3 Provenance (Requirement 7.2)

- The waypoint's properties panel calls `photos:forWaypoint`. It looks the
  photo up by `(folderId, relativePath)`, then by fingerprint in that folder,
  then by fingerprint in the trip's other linked folders, so a photo moved or
  renamed since keeps its link (Requirement 3.7). Nothing rewrites the
  waypoint. If a photo is found and its folder is available, it shows **Show
  photo**, which selects it and opens the preview.
- The waypoint is otherwise ordinary. It is edited, moved, exported and deleted
  like any other, and survives the photo's removal and the folder's unlinking.
- `waypoint:delete` and `waypoint:restore` already carry `metadata`, so undoing
  a deletion keeps the link.
- **Export:** the TrailRT collection writer drops the `photo` key from waypoint
  metadata, so a relative path never leaves the machine (Requirement 8.6).
  GPX, KML, CSV and the itinerary exports never write `metadata` at all.

## 12. Backups and another Mac (Requirement 10)

- `linked_folders`, `folder_files` and `photo_metadata` are ordinary tables,
  so every backup includes the links, the index and the cache metadata (10.1). Thumbnails are files under
  `photo-thumbnails/`, outside the database, so they are never in a backup
  (10.3).
- The backup section of Settings and the restore dialog say: "Linked folders
  are remembered, but the files in them are not backed up by TrailRT. Back
  them up with Time Machine or your usual tool."
- After a restore on another Mac, each folder is `missing` until relinked
  (§4.5). Nothing is deleted while it is missing (10.2).

## 13. Testing

### 13.1 Fixtures — `scripts/generate-fixtures.mjs` gains a photos section

Generated into `test-data/generated/photos/` (gitignored, like the other
generated fixtures). The generator writes a BMP and converts it to the base
JPEG with `sips`, writes EXIF with `test-data/photos/exifWrite.ts`, and
converts to HEIC with `sips`. That needs no Electron step, which the first
draft of this section planned. `withExif` removes the EXIF and Photoshop
segments `sips` adds, so a fixture carries only what its spec says. Every location comes from `@fixtures/places`, the Buxton
square (Requirement 11.2).

| Fixture | Proves |
| --- | --- |
| `buxton.jpg`, `buxton.heic` | Located; altitude, accuracy, direction (`T`), offset `+01:00` |
| `leek-o6.jpg`, `leek-o6.heic` | Orientation 6; no offset (camera time) |
| `ashbourne-below-sea.jpg` | Altitude reference 1 (negative) |
| `macclesfield-be.jpg` | Big-endian TIFF block in a JPEG |
| `no-gps.jpg` | Unlocated, no geotag |
| `zero-zero.jpg` | Rejected: 0°, 0° |
| `out-of-range.jpg`, `no-ref.jpg`, `zero-denominator.jpg` | Rejected: malformed |
| `orientation-1..8.jpg` | Every orientation value |
| `truncated.jpg`, `truncated.heic` | Unreadable, with a reason; the scan continues |
| `not-an-image.jpg`, `not-an-image.heic` | Unreadable: signature does not match |
| `nested/deeper/ashbourne.jpg` | Subfolders on and off |
| `.hidden/buxton.jpg` | Skipped |
| `link-out` → `../photos-outside` | Not followed |
| `Library.photoslibrary/` | Refused when chosen; skipped when nested |
| `notes.png` | Counted as an unsupported format |
| `burst/1..5.jpg` | Same location: one inseparable cluster |
| `tracks/day-1.gpx`, `tracks/day-2.fit` | Indexed as `geodata`, counted, never opened (Requirement 3.8) |
| `clip.mov` | Indexed as `video`, counted, never opened |

Moves are made by the scanner tests at run time, by renaming a file in a temp
copy of the tree, so the committed fixtures need no "before and after" pair.

For the §0 targets, task 13 generates a separate measurement tree: 40,000
photos of about 3 MB across 100 folders. It is generated, not committed, and
deleted after the run.

The whole longitude range of the square is west of Greenwich, so a dropped `W`
moves a photo about 250 km east and fails the location assertions
(Requirement 2.3).

### 13.2 Unit tests (no Electron)

`tiff.test.ts`, `exifValues.test.ts`, `containers.test.ts` and
`exifReader.test.ts` cover Requirement 11.1 against both in-memory buffers and
the fixture files. Also: the scanner against a temp folder (incremental
rescan, deletion only after a complete walk, symlink and hidden skipping, the
`.icloud` placeholder, the dataless heuristic with a stubbed `stat` batch),
`resolve.test.ts`, fingerprint pairing (a rename is a move; two candidates
with the same fingerprint are not paired), the refusals in §4.2, migration and
repositories, undo of
link, unlink, relink and subfolder toggling, add-as-waypoint (single and
batch), the collection export dropping `photo`, the write guard, the
read-only source scan (§7.3), viewport clustering, all-trips points with a
folder linked to two trips appearing once, the year filter, and day counts.

### 13.3 End-to-end (Playwright, Requirement 11.5)

The folder chooser is stubbed in the main process, as `import.spec.ts` stubs
the file chooser. `photos.spec.ts` covers the six scenarios in 11.5. "Clear of
the panel toggles and the scale bar" is asserted by comparing bounding boxes.
"Missing and back" renames the fixture folder copy and renames it back.
Persistence restarts the app with the same data directory.

## 14. Answers to the requirements' open questions

1. **Placing unlocated photos from a track by time:** not in this phase.
   **Moved to Phase 12** (its open question 6), which brings the trip's
   recorded tracks in from the same folder. The model leaves room for it: a
   future `placement` column, `photo` or `track`, in `photo_metadata`.
2. **Folder per trip or per library:** **answered by the owner on 12 November
   2026**: per trip, with the ability to see all. Per trip as Requirement 1.2
   says, with the same folder linkable to several trips; the Photos view shows
   every trip's photos together (§8.2, §9.1).
3. **Metadata reader:** in-house (§0, §3; ADR 0020 §2).
4. **Thumbnails:** Quick Look through `nativeImage`. It applies orientation
   and reads HEIC, measured in §0.
5. **Watching:** `fs.watch` recursive, as a hint for an incremental rescan.
   Network volumes are rescanned on request and when the app regains focus, and
   the UI says so (§5.7).

## 15. Gaps stated honestly

- **iCloud "not downloaded"** detection is by `SF_DATALESS`, confirmed only
  against stubbed `stat` output until task 13 checks a real iCloud Drive
  folder.
- **Network volumes** do not report changes made by other computers. They are
  rescanned on request and on focus.
- **Formats** beyond JPEG and HEIC are counted and named, not read.
- **Cold-cache scan time** is not measured (§0).
- **Folder permission prompts** can recur with each ad-hoc-signed build (§4.2).
- **Moves between linked folders** are a removal and an addition in the index.
  Waypoint links survive them through the fingerprint (§11.3), but the
  thumbnail is made again.
- **The fingerprint is not a content hash.** A change that kept the size and
  the first 64 KB the same would not be seen as a change, but the scanner does
  not use it to detect changes. The size and modified time do that.
- **A move during a cancelled scan** loses its pairing. The new path's row is
  written and the old one kept; the next complete scan removes the old row
  rather than moving it. Waypoint links survive through the fingerprint
  (§11.3), but the photo gets a new row id and thumbnail.
