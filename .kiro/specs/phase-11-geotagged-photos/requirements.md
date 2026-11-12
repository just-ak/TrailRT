# Phase 11: Geotagged Photos from a Linked Folder — Requirements

Status: designed (11 November 2026), see `design.md` and `tasks.md`. Built
ahead of Phases 8 and 9 at the owner's request. Revised on 12 November 2026
with the owner's answers: folders are linked per trip, with a view of every
trip's photos together (question 2); the linked folder is the trip's own folder
on disk, which Phase 12 extends to GPX files; and the scale to design for is a
40,000-photo library built up over many years. Open questions 3–5 are answered
by the design (§14). Question 1 moves to Phase 12, where the tracks it needs
arrive from the same folder.

Depends on Phases 1–3 (library, waypoints, tracks) and Phase 10 (marker
clustering, icon buttons with hints, resizable panels), all shipped. It does
**not** depend on Phase 8 or Phase 9. It sits after them by default, not by
dependency, so the owner can move it ahead of either without rework.

## Introduction

The owner asked for a way to link an external folder of images, so that photos
appear on the map at the place they were taken, using the location recorded
in each photo. Selecting a photo shows it in a preview box in the bottom-left
corner of the map.

**Linked** is the key word. The photos stay where the user keeps them. The app
reads them and records where they are, and never copies, moves, renames or
rewrites them. That is a different model from the one the codebase already
has, described below, and the difference is deliberate.

### The trip's folder on disk

The owner's feedback on the design (12 November 2026) widened the idea. The
linked folder is not only a photo folder. It is **the trip's folder on disk**:
the planned routes, the tracks recorded when the trip was actually done, and
the photos, all kept together where the user can see them. For someone who
travels widely that is a better record than anything locked inside one app,
and keeping GPX files outside the app lets people feel in control of their
data. Later, sharing a trip as a flythrough video will make keeping images and
video organised matter even more.

The owner's own library is the scale to design for: about **40,000 photos and
hundreds of GPX files, built up over many years**. The app must not reread
thousands of files each time it starts. It keeps an index of each folder, and
knows from that index what has changed.

That work is split into three phases, so each can be built and tested before
the next is designed:

| Phase | What the linked folder gains |
| --- | --- |
| 11 (this one) | Linking, the file index, and photos read from it. Read-only. |
| 12 | GPX kept in step with the folder in both directions, with a hash store. TrailRT writes only files it created. |
| 13 | Video, flythroughs, and sharing, with what they produce kept in the folder. |

This phase builds the parts the other two depend on: the folder link, the
index, the scanner and the watcher. It therefore records every file of a kind a
later phase will read (GPX and other track files, video), so those phases start
from an index that already exists rather than adding a second walk.

### What the codebase already establishes

These findings come from the code after Phase 10. They constrain the design and
are recorded here so the design does not have to rediscover them.

- **An `attachments` table already exists and is unused.** Phase 1 created it,
  with `attachmentsDir` in `src/main/paths.ts`, to settle gap 12 of the spec
  review. That decision was to **copy** files into the app support directory
  and keep metadata, a relative path and a content hash in the database.
  Linked photos are the opposite: nothing is copied. Copying a 40 GB photo
  folder would double the disk use and leave two copies to drift apart. The
  design should keep linked photos separate from `attachments`, and record in
  an ADR why both models exist. The copy model fits a single picture pinned to
  a waypoint; the link model fits a photo library.
- **The CSP allows images only from `'self'`, `data:`, `blob:` and tile
  hosts** (`src/main/security/csp.ts`). `csp.test.ts` asserts that `file:` is
  not in `img-src`, and it must stay that way. Thumbnails therefore have to
  reach the renderer as bytes produced by the main process, or through a
  narrowly scoped custom protocol. The renderer is never handed a path to load,
  as the architecture rules require.
- **The bottom-left corner of the map is already occupied.** The scale bar and
  cursor readout (`MapReadout.tsx`) sit at `bottom-3 left-3`. The panel
  toggles (`PanelToggles.tsx`, Phase 10 Requirement 16) sit above them at
  `bottom-12`. The preview box has to share that corner with both, not cover
  them.
- **Marker clustering already exists** in `src/shared/geo/cluster.ts`, built
  for points of interest in Phase 10. A photo folder can hold tens of
  thousands of images, so the photo layer needs it from the start.
- **Track points carry a recorded time** (`track_points.recorded_at`). That is
  what would let a photo with no location be placed by matching its time
  against a recorded track. This is the usual way to geotag photos from a
  camera with no GPS. It is left as an open question below, not a
  requirement, because the owner asked for photos placed by their own
  location data.
- **The waypoint symbol set already has `photo`** (`src/shared/domain/symbols.ts`),
  paired with a Garmin symbol name. A waypoint made from a photo uses it.
- **Library top-level nodes are views, not containers** (ADR 0004). A
  cross-trip "Photos" view fits beside Routes, Tracks and Waypoints in
  `libraryService.ts` `VIEWS`.
- **The library already has folders.** `folderService.ts` organises trips
  into folders in the library tree. A "trip folder" in the app would be
  confused with those, so the app calls a folder on disk a **linked folder**,
  and these documents use "the trip's folder on disk" only for the idea.
- **Backups are a SQLite snapshot of the database only**
  (`backupService.ts`). A linked photo is not in the database, so it is not
  in a backup. The UI has to say so (Requirement 10).

### Three distinctions this phase must keep

1. **The photo is the source of truth; the app holds a cache.** Location, time
   and thumbnails read from a file are derived values. They are recomputed when
   the file changes and never become the only copy of anything. This is the
   architecture's rule for derived data.
2. **No location is not location zero.** A photo without GPS data has no
   position. It is listed as such and never placed at 0°, 0°, at the folder's
   "average" position, or anywhere else.
3. **Camera time is not clock time.** Many photos record the local time with no
   time zone. A time without a zone is shown as the camera recorded it, and
   labelled as such. It is not silently converted as if it were UTC or the
   computer's current zone.

## Terms

| Term | Meaning |
| --- | --- |
| **Linked folder** | A folder on disk the user has linked to a trip: the trip's folder on disk. In this phase the app reads it and never writes to it. |
| **File index** | The app's record of the files in a linked folder: each one's path within the folder, kind, size, modified time and fingerprint. It is how the app knows a file is unchanged without opening it. |
| **Fingerprint** | A hash of a file's size and the bytes the app already reads for its metadata. It recognises a photo that has been moved or renamed within the folder. It is not a hash of the whole file (see the design, §0). |
| **Photo** | An image file inside a linked folder that the app recognises as a photograph format. |
| **Geotag** | Location data recorded in the photo's metadata (EXIF GPS), usually by the phone or camera when the picture was taken. |
| **Located photo** | A photo with a valid geotag. It can be placed on the map. |
| **Unlocated photo** | A photo with no geotag, or one the app rejects as invalid (Requirement 2.5). It is listed but not placed. |
| **Taken time** | When the photo was taken, from its metadata. It may or may not carry a time zone. |
| **Photo cache** | What the app stores about a photo: its path within the folder, size, modified time, geotag, taken time and thumbnail. Rebuildable from the file. |
| **Preview box** | The panel in the bottom-left corner of the map that shows the selected photo. |

## User stories

1. As someone back from a trip, I want to point the app at the folder my phone
   photos were copied into and see each picture on the map where I took it.
2. As the same person, I want to click a photo marker and see the picture in a
   small preview without leaving the map, then step through the others from
   that day.
3. As a planner, I want to turn a photo of a good viewpoint into a waypoint I
   can route to next time.
4. As someone with a large photo library, I want linking a folder to leave my
   files exactly as they were, with nothing moved, renamed, copied or edited.
5. As a user whose camera has no GPS, I want to be told which photos have no
   location, rather than have them disappear or land in the sea off Africa.
6. As someone who keeps photos on an external drive, I want the app to cope
   when the drive is unplugged, and pick up where it left off when it is
   plugged back in.
7. As someone who has travelled for years, with tens of thousands of photos
   across many trips, I want to see each trip's photos with that trip, and
   also every photo from every trip on one map.

## Requirements

### Requirement 1: Linking a folder

#### Acceptance criteria

1. THE user SHALL be able to link a folder from a trip, through an icon button
   with a hint in the trip's actions and through a File menu item. Either way
   opens the system folder chooser in the main process. The wording is about
   linking a folder to a trip, not about photos, because Phase 12 adds GPX to
   the same link.
2. A linked folder SHALL belong to one trip. Its photos SHALL appear under that
   trip in the library and with that trip on the map. A trip MAY have several
   linked folders. The same folder MAY be linked to more than one trip
   (confirmed by the owner, 12 November 2026).
3. THE user SHALL choose whether subfolders are included, defaulting to
   included.
4. Hidden files and folders, and macOS package directories, SHALL be skipped.
5. IF the chosen folder is an Apple Photos library (`.photoslibrary`) THEN the
   app SHALL refuse it with an explanation. That library is a database whose
   layout Apple does not document. Reading it would be fragile, and the honest
   answer is to export the photos to a folder first.
6. THE same folder SHALL NOT be linked to the same trip twice. Linking a folder
   that is inside, or contains, a folder already linked to that trip SHALL be
   refused with an explanation, so no photo appears twice.
7. IF macOS refuses access to the folder (for example Desktop, Documents,
   Downloads or a removable volume without permission) THEN the app SHALL say
   so and point to the setting that grants it. It SHALL NOT report the folder
   as empty.
8. THE user SHALL be able to unlink a folder after a confirmation that says the
   files on disk are not touched. Unlinking removes the folder's photo cache
   and thumbnails, and nothing else. It SHALL be undoable.

### Requirement 2: Reading location and time

#### Acceptance criteria

1. THE app SHALL read a photo's geotag from its EXIF GPS data: latitude,
   longitude and, where present, altitude, horizontal accuracy and the
   direction the camera faced.
2. JPEG and HEIC (the iPhone default) SHALL be supported. Any other format
   (TIFF, PNG, DNG and other raw formats) SHALL be listed as supported only
   after it has been tested against real sample files, in line with the
   architecture's honesty rule. Until then it is not offered.
3. Hemisphere references SHALL be honoured: south latitudes and west
   longitudes are negative. The whole test geography is west of Greenwich,
   so a dropped sign moves a photo about 250 km east and must fail a test.
4. Altitude below sea level SHALL be honoured. Absent altitude SHALL stay
   absent, never 0.
5. A geotag SHALL be rejected, and the photo treated as unlocated with the
   reason recorded, when it is exactly 0°, 0°, outside the valid range, or
   malformed. Cameras without a GPS fix commonly write 0°, 0°.
6. THE taken time SHALL come from the original capture time in the metadata,
   with its time-zone offset when the photo records one. WHERE it records none
   THE time SHALL be stored and shown as camera time, without a zone. The GPS
   timestamp, which is UTC, MAY be used to establish the offset, and the
   design decides whether to.
7. Text fields in the metadata (title, description, comments) SHALL be treated
   as untrusted plain text, as the architecture requires of imported content.
8. A file that cannot be read, is truncated, or is not the image its extension
   claims SHALL be listed with the reason. It SHALL NOT stop the rest of the
   folder being read.

### Requirement 3: Keeping in step with the folder

#### Acceptance criteria

1. THE app SHALL rescan linked folders at launch and on request. While it is
   running it SHALL notice files that are added, changed or removed.
2. A file SHALL be re-read only when its size or modified time has changed. An
   unchanged folder SHALL rescan without reopening its photos. The app SHALL
   keep this state in a file index per linked folder.
3. A photo removed from disk SHALL disappear from the map and the library on
   the next scan. Anything the user made from it, such as a waypoint
   (Requirement 7), SHALL stay.
4. IF a linked folder is missing, for example because the drive is unplugged
   or the folder was moved or renamed, THEN its photos SHALL be shown as
   unavailable with their last known locations. They SHALL NOT be deleted.
   When the folder returns they SHALL become available again without
   relinking.
5. THE user SHALL be able to relink a moved folder to its new location. Its
   photos SHALL be matched by their paths within the folder, so anything made
   from them keeps its link.
6. Files in iCloud Drive that are not downloaded to this Mac SHALL be listed as
   not downloaded. The app SHALL NOT force a download of a whole folder to
   read its metadata.
7. A photo moved or renamed within its linked folder SHALL be recognised as
   the same photo, by its fingerprint, so anything made from it keeps its
   link. It SHALL NOT be treated as one photo removed and another added.
8. THE file index SHALL record every file of a kind a later phase reads: GPX,
   KML, KMZ, TCX and FIT files (Phase 12), and video files (Phase 13). This
   phase does not open them. The folder's properties SHALL count them and say
   they are not read yet, so their absence from the map is explained.

### Requirement 4: Photos in the library

#### Acceptance criteria

1. A trip with linked folders SHALL show a Photos group in the library tree.
   It holds one node per linked folder, with the folder name, its photo count
   and how many have no location.
2. A top-level **Photos** view SHALL list every linked folder across all
   trips, in keeping with ADR 0004. It is a view, not a container.
3. THE photos in a folder SHALL be listable in taken-time order, each showing
   whether it is located, unlocated (with the reason), unavailable or not
   downloaded.
4. Selecting a photo in the library SHALL select it on the map and open the
   preview box. Selecting a located photo off screen SHALL bring it into view.
5. FOR a dated trip (Phase 10), the day groups in the tree SHOULD show the
   number of photos taken that day. The design decides how photo times
   without a zone are assigned to days, and the UI says when that assignment
   is a guess.
6. THE Photos view SHALL be filterable by year taken and by trip, so a library
   built up over many years stays usable.

### Requirement 5: Photos on the map

#### Acceptance criteria

1. Located photos SHALL be drawn as a separate map layer, which can be shown
   and hidden from the layers control like routes, tracks, waypoints and
   points of interest.
2. Photos SHALL be clustered, with a count, until zoomed in far enough to
   separate them. The layer SHALL stay responsive with 50,000 located photos
   in view of the clustering, which covers the owner's 40,000 with headroom.
   The design fixes the measured target.
3. Photos at the same spot, such as a burst of shots, that no zoom level can
   separate SHALL open the preview box at the first of them, with a "1 of N"
   step through the rest.
4. WHERE a photo records the direction the camera faced, the selected photo's
   marker SHOULD show that direction.
5. Unavailable photos SHALL be drawn distinctly from available ones, or hidden,
   at the user's choice. They SHALL never be indistinguishable.
6. WHEN the Photos view is selected, THE map SHALL show the located photos of
   every trip together, subject to the view's filters (Requirement 4.6).
   Otherwise it shows the photos of the trip on the map. A folder linked to
   several trips SHALL have its photos shown once in the all-trips map, not
   once per trip.

### Requirement 6: The preview box

The owner asked for it in the bottom-left corner of the map.

#### Acceptance criteria

1. Selecting a photo SHALL open the preview box in the bottom-left corner of
   the map area. It SHALL stack above the panel toggles and the scale bar,
   which stay visible and usable. It SHALL NOT cover the search box (top left)
   or the zoom and layer controls (top right).
2. THE preview box SHALL stay inside the map area when the panels around the
   map are resized or hidden (Phase 10 Requirement 16), including when the
   panel below the map is open. On a narrow map it SHALL shrink, keeping the
   picture's aspect ratio, rather than overflow.
3. THE preview box SHALL show:
   - the picture, the right way up according to its orientation metadata;
   - the file name, with its path inside the linked folder as a hint;
   - the taken time, with its zone when known, otherwise labelled as camera
     time;
   - the location in the user's coordinate format, with altitude and accuracy
     when present and nothing in their place when absent; for an unlocated
     photo, "No location" and the reason.
4. ITS actions SHALL be icon buttons with hints (Phase 10 Requirement 17):
   previous and next photo in taken-time order, zoom to the photo, add it as a
   waypoint (Requirement 7), open it in the default app, show it in Finder,
   and close.
5. THE keyboard SHALL work: left and right arrows step through the photos and
   Escape closes the box, while focus is in the box.
6. Only a thumbnail sized for the box SHALL be loaded, never the full-size
   original. Opening the original goes to the default app.
7. WHEN the photo is unavailable or not downloaded THE box SHALL say so and
   show the cached thumbnail if one exists.

### Requirement 7: Using a photo's location

#### Acceptance criteria

1. THE user SHALL be able to add a located photo as a waypoint in its trip, at
   the photo's location and altitude, with the `photo` symbol and the file name
   as the default name. It SHALL be a single undoable step.
2. A waypoint made from a photo SHALL record which photo it came from, so the
   waypoint's properties can open that photo's preview while the photo is
   available. The waypoint SHALL be an ordinary waypoint in every other
   respect, and SHALL export and survive the photo's removal like any other.
3. THE user SHALL be able to add several selected located photos as waypoints
   in one step, recorded as one undo step (ADR 0014).

### Requirement 8: Read-only, privacy and security

#### Acceptance criteria

1. THE app SHALL NOT write to, rename, move, delete or change the metadata of
   any file in a linked folder. No code path that writes SHALL be able to
   address a linked folder. The design SHALL show how that is enforced, not
   only intended. Phase 12 relaxes this for GPX files TrailRT itself creates,
   and only for those. Photos stay read-only in every phase.
2. THE renderer SHALL request photos and thumbnails by photo id. The main
   process SHALL resolve the id to a path and serve only files inside a
   currently linked folder. A symbolic link that resolves outside the folder
   SHALL NOT be followed.
3. `file:` SHALL stay out of the CSP. Thumbnails SHALL reach the renderer as
   bytes or through a custom protocol that serves only cached thumbnails by
   id.
4. "Open in default app" and "Show in Finder" SHALL act only on a path the main
   process resolved from a photo id. They SHALL NOT accept a path from the
   renderer.
5. Reading a photo SHALL involve no network request. There SHALL be no online
   reverse geocoding of photo locations.
6. Photo locations SHALL NOT leave the machine except through an export the
   user starts, and photo-derived waypoints export only as waypoints.

### Requirement 9: Scale and responsiveness

#### Acceptance criteria

1. Scanning SHALL run without blocking the main process's handling of other
   requests. It SHALL show progress and SHALL be cancellable.
2. THE app SHALL read only as much of each file as it needs for the metadata,
   not the whole image.
3. Thumbnails SHALL be made when first needed and cached in the app support
   directory. The cache SHALL be bounded in size and rebuildable at any time.
4. THE design SHALL measure, on the target hardware, the first scan of a
   folder of 40,000 mixed JPEG and HEIC photos, an unchanged rescan of the
   same photos spread across 100 linked folders, and the time to show the
   first preview. It SHALL record these as targets the tests hold to.
5. Starting the app SHALL NOT wait for linked folders to be scanned. Folders
   are checked after the window has shown, and the map shows the indexed
   photos straight away.

### Requirement 10: Backups and moving to another Mac

#### Acceptance criteria

1. A backup SHALL include the linked-folder records and the photo cache
   metadata, and SHALL NOT include the photos. The backup UI SHALL say that
   linked photos are not backed up by the app.
2. Restoring a backup on another Mac SHALL show its linked folders as
   unavailable until they are relinked (Requirement 3.5). Nothing SHALL be
   lost in that state.
3. Thumbnails SHALL be left out of the backup, as a cache that rebuilds.

### Requirement 11: Testing

#### Acceptance criteria

1. Unit tests SHALL cover EXIF location and time reading with no Electron in
   the loop: hemisphere signs, altitude below sea level, absent altitude,
   0°, 0° rejection, out-of-range and malformed values, time with and without
   an offset, and every orientation value.
2. Fixture photos SHALL be synthetic and SHALL NOT contain real user GPS data,
   in line with the testing rules. Fixtures made from real device files (to
   prove HEIC and other formats against real encoders) SHALL have their
   metadata replaced with locations from `@fixtures/places`, the Buxton
   square, before they are committed.
3. Fixtures SHALL include: located JPEG and HEIC; a photo with no geotag; one
   at 0°, 0°; a truncated file; a non-image with an image extension; a nested
   folder; a hidden folder; a symbolic link pointing outside the folder; and a
   `.photoslibrary` directory.
4. A test SHALL prove the read-only rule: after a link, scan, thumbnail build,
   add-as-waypoint, unlink and rescan, every fixture file is byte-identical
   and has its original modified time.
5. End-to-end tests SHALL link a fixture folder (with the folder chooser
   stubbed, as the import tests stub the file chooser), and cover:
   - located photos on the map and the unlocated ones listed;
   - the preview box opening in the bottom-left corner, clear of the panel
     toggles and the scale bar;
   - stepping through photos;
   - adding a photo as a waypoint and undoing it;
   - the folder going missing and coming back;
   - persistence across a restart.

## Constraints carried from the rest of the project

1. **Module boundaries.** Folder scanning, metadata reading and thumbnails live
   in the main process (`src/main/linkedFolders/` or similar). Pure parsing of
   metadata values (coordinates from degrees, minutes and seconds, offsets,
   orientation) lives in `shared/` so it can be unit-tested directly. Trip
   management does not reference a concrete metadata reader.
2. **Errors cross IPC as results, never exceptions**, and every handler
   validates its payload with zod.
3. **No new dependency without a licence check** recorded in the register.
4. **Missing stays missing.** Absent location, altitude, accuracy, direction
   and zone are shown as absent, never as zero or a guess.

## Out of scope

- **Writing geotags into photos.** It contradicts Requirement 8.1. If it is
  ever wanted, it needs its own requirement, an explicit per-action
  confirmation, and a backup of each original.
- **Editing, rotating, cropping or deleting photos.**
- **Reading GPX and other track files from the folder.** That is Phase 12.
  This phase records them in the index (Requirement 3.8) and does nothing
  else with them.
- **Video.** Phone videos carry their location in a different container. Video
  is part of Phase 13, with flythroughs and sharing. This phase records video
  files in the index (Requirement 3.8) and does not read or place them.
- **The Apple Photos library and iCloud Photos** (Requirement 1.5). Photos
  exported from them to a folder work like any others.
- **Online reverse geocoding** ("taken in Buxton"). Phase 10's offline
  gazetteer could support it later, offline, if asked for.
- **Face, object or scene recognition.**

## Unresolved questions for the owner and the design stage

1. **Match unlocated photos to a track by time?** Track points record their
   time, so a photo taken at 14:32 can be placed where the track was at 14:32.
   It is the standard answer for cameras with no GPS, and BaseCamp did it. It
   needs a camera-clock offset control and a clear "placed from the track, not
   the photo" label. Nothing would be written to the photo. **Moved to Phase
   12** (its open question 6), because that phase brings the trip's recorded
   tracks in from the same folder.
2. **Folder per trip, or folder for the library?** **Answered by the owner on
   12 November 2026:** per trip, with the ability to see all. Folders are
   linked per trip (Requirement 1.2). The Photos view shows every trip's
   photos together (Requirements 4.6 and 5.6).
3. **Which metadata reader?** Candidates checked on 11 November 2026:
   - `exifr` 7.1.3: MIT, no dependencies, reads JPEG, HEIC, TIFF and PNG and
     reads only the first part of the file. Its last release was May 2022,
     which is a maintenance risk the design must weigh.
   - `exiftool-vendored` 39.2.0: MIT wrapper around ExifTool, which is under
     the Perl Artistic licence or GPL. It reads almost everything, but runs a
     separate Perl process that would have to be bundled, signed and
     size-checked.
   - A small in-house reader for the GPS and time tags of JPEG and HEIC only.

   The design decides after testing all three against the fixtures.
4. **Thumbnails.** Electron's `nativeImage.createThumbnailFromPath` uses macOS
   Quick Look, which handles HEIC and many raw formats with no new dependency.
   It needs measuring for speed and for whether it applies the orientation
   tag.
5. **Watching.** Is the recursive file watcher Node offers on macOS reliable
   enough for folders on external and network drives? Or should those be
   rescanned on demand only?
