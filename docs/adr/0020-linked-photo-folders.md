# ADR 0020: Linked folders, an in-house EXIF reader, and Quick Look thumbnails

Status: accepted
Date: 2026-11-11, revised 2026-11-12 after the owner's feedback (§7, §8)

## Context

The owner asked for photos on the map at the place they were taken, read from a
folder the user keeps, with a preview in the bottom-left corner of the map
(Phase 11). They asked for it to be built ahead of the windy-roads (8) and
Garmin (9) phases.

The codebase already has a Phase 1 `attachments` model that **copies** files
into the app's own storage. The CSP keeps `file:` out of `img-src`, and the
renderer is never handed a path. A photo folder can hold tens of thousands of
files, often on an external drive, sometimes in iCloud Drive.

On 12 November 2026 the owner widened the idea. The linked folder is **the
trip's folder on disk**: planned routes, the tracks recorded on the trip, and
its photos, kept together where the user controls them. GPX files there are to
be kept in step with the app in both directions (Phase 12), and video,
flythroughs and sharing follow (Phase 13). The owner's library is about 40,000
photos and hundreds of GPX files over many years, and must not be reread on
every launch.

## Decision

### 1. Linked, not copied, and kept apart from attachments

A linked folder is recorded in `linked_folders`, its files in a general index,
`folder_files`, and what is read from a photo in `photo_metadata` (§7). The
files stay where the user keeps them and are never copied, moved, renamed or
written in this phase.

Both models exist on purpose:

- **Attachments (copy)** fit a single picture pinned to an object. The app
  owns the copy, so it survives the original being deleted, and it belongs in
  the app's storage.
- **Linked folders (reference)** fit a photo library. Copying 40 GB would
  double the disk use and leave two copies to drift apart, and the user's own
  folder is already where they back it up.

Everything read from a photo is a cache, recomputed when the file changes. The
photo's identity is its path within the linked folder, so relinking a moved
folder and undoing an unlink keep everything made from its photos.

### 2. An in-house reader for JPEG and HEIC

Measured against synthetic fixtures on 11 November 2026 (design §0):

- `exifr` 7.1.3's file reader **fails on Node 26**, and its last release was in
  May 2022. Its parser works when handed buffers, but its failures are opaque
  (`undefined` for a truncated HEIC), and Requirement 2.8 needs a reason per
  file.
- `exiftool-vendored` runs ExifTool on the **system Perl**, which Apple has
  deprecated, as a separate process. That is the same kind of hidden host
  dependency that broke the 0.1.0 tile build (ADR 0013 amendment).

The in-house reader covers what the requirements need and nothing else: a JPEG
marker walk, a HEIC box walk that follows `iloc` to the EXIF item, and a TIFF
parser for about a dozen tags, in both byte orders. It is pure, sits in
`shared/photos/`, and works over a ranged-read interface, so it reads only the
bytes it needs. It sits behind a `PhotoMetadataReader` interface, so a raw-format
reader can be added later without touching the scanner. No dependency is added.

### 3. Thumbnails from Quick Look, delivered as bytes

`nativeImage.createThumbnailFromPath` uses Quick Look. It reads HEIC, **applies
the orientation tag** and keeps the aspect ratio (measured), at about 40 ms for a
12-megapixel photo. No image library is added.

Thumbnails cross IPC as bytes and are shown through `blob:` URLs, which the
policy already allows. There is **no CSP change and no custom protocol**: a
protocol handler would be a second, URL-shaped way to ask for files, and it
would need its own access checks. Thumbnails are cached on disk outside the
database, so they never enter a backup.

### 4. Camera time stays camera time

A photo's taken time is stored as the wall clock it recorded, with its offset
only when the photo records one. The GPS timestamp is **not** used to infer a
zone. It is the time of the last fix, which can be stale, and an offset worked
out from a stale fix would be confidently wrong. Photos are assigned to
itinerary days by their wall-clock date, and the UI says when that relies on
camera time.

### 5. Read-only, enforced in three layers

The folder-access module (`main/linkedFolders/`) opens files with
`O_RDONLY | O_NOFOLLOW` and contains no write call, and a test fails the build
if one appears. The only two writers
that can target an arbitrary path (export and Save a Copy) refuse one inside a
linked folder. An end-to-end test proves every fixture is byte-identical, with
the same modified time, after a full cycle.

**The rule Phase 12 inherits.** Phase 12 is the first to write into a linked
folder, so the limits are fixed now, before any writer exists:

- TrailRT writes only **GPX files it created itself**, recorded as its own in
  the index. It never writes, renames or deletes a file it did not create, and
  never writes a photo or a video, in any phase.
- It never overwrites a file whose content hash differs from the one it
  recorded when it last wrote or read it. That is a conflict for the user to
  settle, not something to resolve silently.
- It never deletes a file outright. At most, it moves a file it created to the
  Trash, after the user confirms.
- The writer lives in its own module, outside `main/linkedFolders/`, so the
  read-only source scan keeps holding for everything that reads photos.

Phase 12's design owes its own ADR for the sync rules themselves.

### 6. Out of this phase

Placing unlocated photos from a recorded track by time moves to Phase 12, which
brings the recorded tracks in from the same folder. A single library-wide
photo folder was declined by the owner in favour of §8.

### 7. One index for every kind of file, with fingerprints

The scanner keeps one `folder_files` row for each file it recognises, with a
`kind`: `photo`, `geodata` (GPX, KML, KMZ, TCX, FIT) or `video`. This phase
reads only photos, and counts the others. Phases 12 and 13 add their own
records beside the index, keyed by file, and need no second walk or watcher.

Unchanged size and modified time are what spare a file from being reopened.
A photo also gets a **fingerprint**, `SHA-256(size ‖ first 64 KB)`, computed
from bytes the metadata read already fetched (23 µs). It recognises a photo
moved or renamed within the folder, so its id, metadata and any waypoint made
from it survive. A match is used only when it is unambiguous.

A whole-file hash of every photo was rejected. Hashing is cheap (about 1 ms per
3 MB), but the read is not: 40,000 photos is about 120 GB, or about 20 minutes
from a USB hard drive on every first scan. Whole-file SHA-256 is kept for GPX
and other track files, which are small (0.6 ms for 2 MB), and which Phase 12
needs in order to know what is in step.

### 8. Per trip, with every trip's photos together

Answered by the owner on 12 November 2026: folders are linked per trip, and the
same folder can be linked to several trips. The Photos view shows every trip's
photos on one map, filtered by year and by trip. A folder linked to two trips
is shown once there. Clustering 50,000 points measured under 10 ms at every
zoom, so the all-trips map needs no separate index.

In the code and the UI it is a **linked folder**, not a "trip folder", because
the library already has folders that hold trips.

## Consequences

- No new runtime dependency, so no change to the licence register.
- Phases 12 and 13 extend `folder_files` and `classify.ts`. They do not change
  how folders are linked, walked or watched.
- A photo moved between two linked folders is a removal and an addition in the
  index. Waypoint links survive it through the fingerprint; the thumbnail is
  made again.
- HEIC support depends on Quick Look and on our box walk, both tested against
  Apple's encoder. HEIC from other encoders is covered by the `iloc` path,
  which is tested with synthetic extents past 64 KB but not yet against a
  non-Apple file.
- An ad-hoc-signed build can be asked for folder permission again after each
  update, because macOS records it against the code signature (ADR 0009).
- iCloud "not downloaded" detection relies on the `SF_DATALESS` flag, read with
  `/usr/bin/stat` because Node does not expose file flags. It stays partially
  verified until it has been checked on a real iCloud Drive folder.

## Alternatives rejected

- **Reuse `attachments`** for photos: it is a copy model by design (spec review
  gap 12), and the requirements are explicit that linked photos are not
  copied.
- **A custom `trailrt-photo:` protocol** for thumbnails: more attack surface
  than bytes over an already-validated IPC channel, for no measured benefit at
  one 50 KB thumbnail per preview.
- **A worker thread for scanning**: parsing is 22 µs per file. The rest is
  asynchronous I/O, which is already off the main thread.
