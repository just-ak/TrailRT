# Phase 12: GPX Kept in Step with a Linked Folder — Requirements

Status: requirements only (12 November 2026), from the owner's feedback on the
Phase 11 design. Not designed. Under the rule in `../README.md` its design
waits until Phase 11 is built and tested, because it builds directly on
Phase 11's folder link, file index, scanner and watcher.

Depends on Phase 3 (import and export), Phase 10 (dated trips) and Phase 11
(linked folders and the file index). It does **not** depend on Phase 8 or
Phase 9. Its order relative to them is the owner's call.

## Introduction

The owner's direction, 12 November 2026:

> Linking on to this we could have external GPX tracks also in a folder for a
> trip. So that it becomes a trip folder, with planned routes, with tracks for
> when it was actually done, with photos. This would make a much better
> resource, especially for global travellers. Having the GPX tracks external
> will make people feel in control of their data, but we must make sure it is
> a continuous import/export, perhaps with a hash store so that internally we
> know what is in sync and not, as we don't want to keep reading thousands of
> files each time. My photo library from travels is 40,000, and hundreds of GPX
> files, over lots of years.

So a trip's linked folder becomes the trip's complete record on disk. The
tracks recorded on the trip are read in from it. The routes planned in TrailRT
are written out to it. Both stay in step without the user importing or
exporting by hand. A hash store tells TrailRT which files match what it holds,
without reading them again.

This is the first phase in which TrailRT **writes into a linked folder**.
Phase 11 is strictly read-only, and ADR 0020 §5 fixed the limits of what this
phase may write before any writer exists. They are restated in Requirement 5
and are not relaxed here.

### What the codebase establishes

From the code after Phase 10 and the Phase 11 design. The design must confirm
these against the code once Phase 11 is built.

- **Phase 11 provides the index.** `folder_files` already records every GPX,
  KML, KMZ, TCX and FIT file in a linked folder (kind `geodata`) with its size
  and modified time, and the scanner and watcher already notice them change.
  This phase adds a sync record per file, and a whole-file SHA-256 in
  `fingerprint`. It needs no second walk.
- **Hashing is cheap for these files.** Measured for Phase 11 (design §0): a
  2 MB GPX file hashes in 0.6 ms. Hundreds of files hash in well under a second.
  Reading them is the cost, and the size and modified time spare an unchanged
  file from being read at all.
- **The importers exist** for GPX, KML, KMZ, TCX and FIT (`src/main/io/`), with
  the Phase 3 fidelity rules and an import report. An imported track keeps its
  original bytes in `track_sources`, with a content hash, so a track survives
  its file being deleted or changed.
- **Imports are not undoable.** `register.ts` says so: an import can write
  hundreds of thousands of rows, so it leaves the undo stack alone, and
  deleting the imported trip is the documented way back. An automatic import
  from a folder needs a different way back (Requirement 8).
- **Imports have no duplicate detection.** Importing the same file twice makes
  two copies. A folder import must not, so the sync record is what says a file
  is already in.
- **The GPX writer is deterministic.** `io/gpx/write.ts` stamps no creation
  time and serialises numbers exactly. The same route always writes the same
  bytes, so "has TrailRT changed this route since it wrote the file?" can be
  answered by comparing the hash of what it would write now with the hash it
  recorded. No revision counter is needed on routes.
- **Writers to arbitrary paths are guarded.** Phase 11's
  `assertNotInLinkedFolder` refuses an export or Save a Copy into a linked
  folder. This phase adds the one sanctioned writer, which that guard must
  still refuse to everything else.

### Four distinctions this phase must keep

1. **A file TrailRT created is not a file the user brought.** A route TrailRT
   wrote can be rewritten when the route changes. A track recorded by a phone
   or a Garmin device is the user's original, and TrailRT never writes to it.
2. **Changed is not touched.** A file whose modified time changed but whose
   content hash did not has not changed. It is not re-imported, and it is not a
   conflict.
3. **A conflict is never settled silently.** When both the file and TrailRT's
   copy have changed since they last matched, nothing is overwritten on either
   side until the user chooses.
4. **Missing is not deleted.** A folder that is unplugged, or a file that has
   gone, never causes anything in TrailRT to be deleted without the user
   asking. A route deleted in TrailRT never causes its file to be deleted
   without the user asking.

## Terms

| Term | Meaning |
| --- | --- |
| **Synced folder** | A linked folder (Phase 11) with GPX sync turned on. |
| **Brought file** | A GPX or other track file the user put in the folder. TrailRT reads it and never writes to it. |
| **Owned file** | A GPX file TrailRT created in the folder. TrailRT may rewrite it, and may move it to the Trash with the user's confirmation. |
| **Hash store** | For each file: its path within the folder, size, modified time, the SHA-256 of its content when TrailRT last read or wrote it, whether TrailRT owns it, and which TrailRT objects it corresponds to. |
| **In step** | The file's content hash is the one recorded, and the TrailRT objects are as they were when it was recorded. |
| **Export folder** | The subfolder of a synced folder that TrailRT writes its owned files into. |

## User stories

1. As a traveller, I want to drop the GPX tracks from my phone or bike computer
   into the trip's folder and see them on the trip, without importing them one
   by one.
2. As a planner, I want the routes I plan in TrailRT to appear as GPX files in
   the trip's folder, so I can copy them to a device or another app, and so
   my plans exist outside TrailRT.
3. As someone with years of trips, I want starting TrailRT to be quick, not to
   reread hundreds of GPX files that have not changed.
4. As someone who edits GPX files in other tools, I want TrailRT to notice my
   change, and to ask me rather than overwrite it when it has changed the same
   route too.
5. As someone who keeps my recordings as originals, I want TrailRT never to
   rewrite a file it did not create.

## Requirements

### Requirement 1: Turning sync on

#### Acceptance criteria

1. THE user SHALL be able to turn GPX sync on and off for each linked folder,
   from the folder's properties and when linking it. Turning it off stops
   reading and writing. It deletes nothing on either side.
2. WHEN sync is turned on THE app SHALL show what it will do before doing it:
   how many files it will read in, how many routes it will write out, and
   where.
3. THE user SHALL choose the export folder, a subfolder of the synced folder.
   The design proposes a default name (open question 3).
4. A synced folder on a volume TrailRT cannot write to (read-only, or refused
   by macOS) SHALL still be read. Writing SHALL pause, and the folder SHALL
   say why.

### Requirement 2: The hash store

#### Acceptance criteria

1. THE app SHALL keep a hash store entry for every track file in a synced
   folder, as defined in Terms.
2. A file whose size and modified time match its entry SHALL NOT be opened.
3. A file whose size or modified time differs SHALL be hashed. IF the hash
   matches the entry THEN only its size and modified time SHALL be updated. It
   has been touched, not changed.
4. FROM the hash store and the TrailRT objects, THE app SHALL work out each
   file's state:
   - **in step**;
   - **new on disk**, not yet read in;
   - **changed on disk**, while TrailRT's objects are as they were;
   - **changed in TrailRT**, while the file is as it was (owned files only);
   - **edited in TrailRT**, the same for a brought file, which is never
     written (Requirement 6.2);
   - **changed in both**, a conflict;
   - **removed from disk**;
   - **removed in TrailRT**;
   - **not yet written**, a route with no file yet.
5. THE hash store SHALL be backed up with the database. It is real state, not
   a cache: without it TrailRT cannot tell which side changed. IF it is lost or
   does not match the folder THEN the app SHALL compare contents again. A file
   that matches SHALL be in step, and every difference SHALL be a conflict for
   the user (Requirement 7). Nothing SHALL be overwritten on the strength of a
   guess.

### Requirement 3: Reading files in

#### Acceptance criteria

1. A new track file in a synced folder SHALL be read in to the folder's trip
   through the Phase 3 importers, with the same fidelity rules and an import
   report. GPX, KML, KMZ, TCX and FIT SHALL be read. Only GPX is written
   (Requirement 4).
2. EACH object read in SHALL record which file it came from. A file SHALL be
   read in once, however many times the folder is scanned.
3. WHEN a brought file changes on disk and its objects are unchanged in
   TrailRT, THE app SHALL replace them with the file's new content. The
   previous version SHALL be recoverable (Requirement 8).
4. A file that cannot be read SHALL be listed with the reason, and SHALL NOT
   stop the rest of the folder being read. It SHALL be tried again only when
   it changes.
5. THE app SHALL NOT read in the owned files it wrote itself as new objects.
6. Reading in SHALL be automatic when sync is on, and SHALL tell the user what
   arrived. The design decides whether a first sync of many files asks first
   (open question 4).

### Requirement 4: Writing files out

#### Acceptance criteria

1. EACH route in the folder's trip SHALL be written as a GPX file in the
   export folder, and rewritten when the route changes. The design decides
   whether tracks and waypoints made in TrailRT are written too (open
   question 1), and whether files are one per route or one per trip (open
   question 2).
2. A write SHALL be atomic: written to a temporary file in the same folder,
   then renamed over the target. An interrupted write SHALL leave the previous
   file whole.
3. Writes SHALL be debounced, so that dragging a route's shape does not write
   the file at every step. The design fixes the interval.
4. Every file TrailRT writes SHALL be recorded as owned, with the hash of what
   it wrote.
5. File names SHALL come from the route name, made safe for the file system.
   A name already taken by a file TrailRT does not own SHALL NOT be reused.
   TrailRT picks another name.

### Requirement 5: What TrailRT may write (ADR 0020 §5)

#### Acceptance criteria

1. TrailRT SHALL write only owned files. It SHALL NOT write to, rename, move or
   delete a brought file, a photo, a video or any other file.
2. TrailRT SHALL NOT overwrite an owned file whose content hash differs from
   the one recorded when it last wrote or read it. That is a conflict
   (Requirement 7).
3. TrailRT SHALL NOT delete any file outright. It MAY move an owned file to the
   Trash, after the user confirms (Requirement 6.4).
4. All writing into a linked folder SHALL go through one module, which
   enforces Requirements 5.1–5.3 itself rather than trusting its callers. Phase
   11's read-only modules SHALL stay unable to write, and its write guard SHALL
   keep refusing every other writer.
5. TrailRT SHALL write only inside the export folder.

### Requirement 6: Edits, renames and removals

#### Acceptance criteria

1. WHEN an owned file's route changes in TrailRT, and the file is as TrailRT
   left it, THE file SHALL be rewritten.
2. WHEN a brought file's objects are edited in TrailRT, THE file SHALL be left
   alone and its state SHALL be **edited in TrailRT**. THE user MAY save the
   edited version as a new owned file in the export folder. The original stays
   untouched.
3. WHEN a file is removed from disk, ITS objects SHALL stay in TrailRT,
   marked **removed from disk**. THE user MAY then delete them, or, for a
   route, write it out again as an owned file.
4. WHEN a route with an owned file is deleted in TrailRT, THE file SHALL stay,
   marked **removed in TrailRT**. THE user MAY move it to the Trash, after a
   confirmation that names the file. Undoing the route's deletion SHALL bring
   it back in step with its file.
5. A file renamed or moved within the synced folder SHALL be recognised by its
   content hash, and SHALL keep its objects. It SHALL NOT be read in again as a
   new file. A match SHALL be used only when it is unambiguous.
6. WHILE a synced folder is missing (Phase 11 Requirement 3.4), NOTHING SHALL
   be read or written for it. Changes made in TrailRT meanwhile SHALL be
   written when it returns, unless the file changed on disk meanwhile too, in
   which case that is a conflict.

### Requirement 7: Conflicts

#### Acceptance criteria

1. A file changed on disk whose objects have also changed in TrailRT SHALL be
   a conflict. So SHALL every difference found when the hash store is lost or
   does not match (Requirement 2.5).
2. NOTHING SHALL be overwritten on either side while a file is in conflict.
3. THE user SHALL be able to settle each conflict by keeping TrailRT's
   version (for an owned file, rewrite it), taking the file's version (read it
   in, recoverably), or keeping both (the file's version read in as new
   objects, TrailRT's written as a new owned file).
4. Conflicts SHALL be visible without searching for them. Each affected folder
   and object SHALL be marked, and there SHALL be one place that lists them
   all.

### Requirement 8: Undo and recovery

#### Acceptance criteria

1. Every change that sync makes in TrailRT SHALL be recoverable. That covers
   reading a new file in, replacing objects from a changed file, and taking a
   file's version in a conflict. The design decides how, given that imports
   are not on the undo stack. One way is to keep the replaced objects
   recoverable for a set time.
2. Writing a file SHALL never lose content. The file it replaces was written
   by TrailRT and matched the hash store, so its content is TrailRT's previous
   version of the route, which the design SHALL keep recoverable.
3. THE user SHALL be able to tell sync to ignore a file. Its objects are
   removed from the trip, and it is not read in again unless the user stops
   ignoring it.

### Requirement 9: Scale

#### Acceptance criteria

1. A rescan of synced folders whose track files have not changed SHALL open
   none of them.
2. THE design SHALL measure, on the target hardware, the first sync of 500
   GPX files and an unchanged rescan of them alongside the 40,000 photos of
   Phase 11. It SHALL record these as targets the tests hold to.
3. Reading in SHALL run without blocking other requests, with progress, and
   SHALL be cancellable. A cancelled first sync SHALL keep what it had read in
   and record the rest as new on disk.

### Requirement 10: The library and the map

#### Acceptance criteria

1. Objects read in from a synced folder SHALL appear in the trip as ordinary
   tracks, routes and waypoints, with a mark showing their file and state. The
   hint SHALL give the file's path within the folder.
2. THE linked folder's node and properties SHALL show its sync summary, for
   example "212 in step · 3 new · 1 conflict".
3. THE user SHALL be able to sync now, pause sync, and open the export folder
   in Finder.

### Requirement 11: Backups and another Mac

#### Acceptance criteria

1. A backup SHALL include the hash store, as Requirement 2.5 requires.
2. AFTER a restore on another Mac, synced folders SHALL be unavailable until
   relinked (Phase 11 Requirement 3.5). They SHALL then be compared by content,
   with files that match in step and every difference a conflict. Nothing SHALL
   be overwritten on either side as a result of the restore.

### Requirement 12: Testing

#### Acceptance criteria

1. Fixtures SHALL be synthetic GPX, KML, TCX and FIT files, with geography from
   `@fixtures/places`, the Buxton square.
2. Unit tests SHALL cover every state in Requirement 2.4 and every transition
   between them, with no Electron in the loop, against a temp folder.
3. A test SHALL prove Requirement 5.1: after every sync scenario, every
   brought file and every photo is byte-identical, with its original modified
   time.
4. A test SHALL prove Requirement 4.2 by interrupting a write and checking the
   previous file is whole.
5. A test SHALL prove a touched file (modified time changed, content the same)
   is neither read in again nor a conflict.
6. A test SHALL prove a renamed file keeps its objects.
7. End-to-end tests SHALL cover: a GPX file dropped into the folder appearing
   on the trip; a route planned in TrailRT appearing as a file; a conflict
   shown and settled each of the three ways; the folder going missing and
   coming back with changes on both sides; persistence across a restart.

## Constraints carried from the rest of the project

1. **Module boundaries.** Sync is its own main-process module. It uses Phase 3's
   importers and writers and Phase 11's index, and does not change how either
   works. Trip management does not reference it.
2. **Errors cross IPC as results, never exceptions**, and every handler
   validates its payload with zod.
3. **Imported geometry is preserved byte-faithfully** (architecture rules).
   Reading in through sync is an import in every respect that matters.
4. **No network.** Sync is between the app and a folder on this Mac. Folders in
   iCloud Drive or on a network volume sync through whatever the user already
   uses. TrailRT adds no cloud service.

## Out of scope

- **Writing into brought files**, ever (Requirement 5.1).
- **Merging** two versions of a route point by point. A conflict is settled by
  choosing a side or keeping both.
- **Formats other than GPX for writing.** KML, KMZ, TCX and FIT are read only.
- **Syncing with a device directly.** A device's own GPX folder could be linked
  like any other, but device transfer is Phase 9's investigation.
- **Photos and video.** Phase 11 reads photos. Phase 13 adds video. Neither is
  ever written.

## Unresolved questions for the owner and the design stage

1. **What is written out?** Routes, as planned, are the obvious case. Should
   tracks drawn or edited in TrailRT, and the trip's waypoints, be written too?
   The default proposed is routes only, with waypoints as a single
   `waypoints.gpx`.
2. **One file per route, or one per trip?** One per route keeps every hash
   independent, so editing one route rewrites one small file. One per trip
   is tidier on disk but rewrites everything on any change. The default
   proposed is one per route.
3. **Folder layout.** What should the export folder be called by default
   (`Routes`, `Planned`, `TrailRT`)? Should TrailRT suggest a layout for a new
   trip's folder, such as `Routes/`, `Tracks/` and `Photos/`, or leave the
   layout entirely to the user? The default proposed is a `Routes` subfolder,
   with no other suggestions.
4. **Automatic or asked?** Reading new files in automatically is what makes it
   continuous. A first sync of a folder with hundreds of files might be better
   confirmed once. The default proposed is to confirm the first sync of a
   folder, then read in automatically.
5. **Trip dates from tracks.** Recorded tracks carry times. Should a synced
   folder's tracks offer to set an undated trip's dates (Phase 10)?
6. **Match unlocated photos to a track by time?** Moved here from Phase 11 (its
   open question 1). With the trip's recorded tracks read in from the same
   folder, a photo with no geotag taken at 14:32 can be placed where the track
   was at 14:32. It needs a camera-clock offset control and a clear "placed
   from the track, not the photo" label, and nothing is written to the photo.
   Should it be part of this phase?
7. **Order.** This phase needs only Phases 3, 10 and 11. Should it be built
   straight after Phase 11, ahead of Phases 8 and 9?
