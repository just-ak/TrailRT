# ADR 0025: Each imported file is stored once, and backups have a space limit

Status: accepted
Date: 2026-11-16
Amends Phase 3's storage of original files (`track_sources`). Leaves the
import-fidelity rule unchanged: every original is still kept byte for byte.

## Context

The owner's disk filled. Their TrailRT database had reached 12.4 GB, with a
2.7 GB write-ahead log, and the backups folder had reached 27 GB, because each
backup is a full copy of the database.

The owner asked for a limit on backup space, and for offline map data to be
kept out of backups. Measuring the database found two things.

**Map data was never in the database.** Routing graphs, terrain heights,
place search and postcodes live in their own folders under the app's data
directory, and a backup copies only `trailrt.db`. The request was already met.

**The size came from a storage defect.** 11.7 GB of the 12.4 GB was
`track_sources`, the original bytes of imported files kept so an edited track
can be put back as imported. They were stored once per track rather than once
per file. The library's 685 tracks came from five files. One 23.6 MB GPX
holding 342 tracks was stored 342 times, 8 GB on its own. The unique files
came to 47 MB. Track points, the data actually drawn, were 46 MB.

## Decision

**A file's bytes are stored once, keyed by their SHA-256**, in a new
`source_files` table. `track_sources` becomes the link from a track to its
file. Importing a second track from the same file adds a link, not a copy. A
trigger removes a file when the last track linked to it goes, however it goes:
a track deleted, a trip deleted with its tracks, or a restore.

**Migration 0011 collapses the existing copies**, choosing one row per hash by
rowid so the blobs are never sorted into temporary storage, and the database
is compacted with `VACUUM` once afterwards, outside the migration's
transaction. On a clone of the owner's database this took 9 seconds and left
a 140 MB file. Every one of the 685 tracks still reached its own original, all
five files hashed to their keys, and SQLite's integrity check passed.

**Backups roll within a space limit, 2 GB by default**, alongside the existing
count (Phase 14 Requirement 24). The oldest go first. The newest is always
kept, because a library larger than the limit must still have one backup, and
Settings says when that is the case. A backup is refused when the disk would
be left with less than 1 GB free. A restore's safety copy never removes the
backup being restored, and a backup is never removed by its own clean-up.

**Settings says what a backup holds**: everything the user made, and not the
map regions, terrain, place search, postcodes or photo thumbnails, which are
downloaded or rebuilt.

## Consequences

- The owner's library falls from 12.4 GB to about 140 MB on the first launch
  after this change, with a pause of a few seconds while it is compacted.
- A backup of that library is about 140 MB, so the 2 GB limit holds many.
- `source_files` has no undo of its own. It needs none: track deletion is
  already not undoable (ADR 0014), and a file is removed only when no track
  refers to it.
- Routes keep no original bytes, so nothing changes for them.
