# ADR 0027: Duplicates are found by content, and a removed duplicate track can be undone

Status: accepted
Date: 2026-11-24
Amends ADR 0003 and ADR 0014 for one case only: a track removed as a
duplicate can be undone. Deleting a track any other way still cannot.

## Context

The owner asked for a way to remove duplicates "from trails, routes,
waypoints, based on content, not on name". Libraries collect duplicates in
ordinary use. The same GPX is imported twice, a file is imported into a trip
and again outside one, or a device exports a ride that was already brought in
from another. ADR 0025 found the owner's 685 tracks came from five files, and
since that change a second import of the same file is cheap to store, so
nothing stops it.

Three questions needed answers. What does "the same content" mean? Which copy
survives? And can the removal be undone, when deleting a track cannot be?

## Decision

**Content is compared exactly.** Two tracks are duplicates when every
recorded point is the same in order, with position, elevation, time and
segment breaks. Two routes are duplicates when their drawn points are the
same, and two waypoints when their position and elevation are. Names,
descriptions, colours and symbols are ignored, as the owner asked. Nothing is
rounded and there is no tolerance. Data integrity rules out rounding imports,
and a "nearly the same" match would remove a different ride that happened to
follow the same road. Near-duplicates are a different feature, not offered.

Content is reduced to a key. A waypoint's is its three numbers. A route's or
track's is a SHA-256 over its points written as shortest round-trip number
text. Tracks are first sorted by point count and first and last point, so only
likely matches are read in full.

**One copy is kept by a fixed rule.** First a copy that a trip's plan uses,
then one inside a trip rather than outside one, then the oldest. A copy a plan
uses is never removed, because removing it would leave a hole in the plan.

**Copies in different trips are offered but not ticked.** Copying a waypoint
or route into a second trip can be deliberate. Items outside a trip do not
count as another trip, because that is where an accidental second import lands.

**Removal is one undo step, tracks included.** ADR 0003 made track deletion
irreversible because a track's points are too many to carry on the undo stack.
A duplicate is different: the kept copy holds exactly those points. So the
undo step carries the removed track's row, the kept copy's id and the content
key, and rebuilds the points by copying them from the kept copy. Before
copying, it checks that the kept copy still exists with the same key. If the
kept copy has been changed by something that cannot be undone, such as a join,
or deleted, the undo refuses with a reason instead of rebuilding the wrong
track.

The removed track's original file goes back too. When the removed copy was the
last track linked to its file, the trigger from ADR 0025 deletes that file, so
in that case only the step carries the file's bytes. Usually the copies share
one file, since they came from importing it twice, and nothing extra is carried.

Routes and waypoints use their existing delete and restore, with the same
point limit for one undo step as a batch delete. Past it, the dialog says the
removal cannot be undone before anything is removed.

## Consequences

- Removing hundreds of duplicate tracks is safe to try, because one ⌘Z puts
  them back.
- An undo step for a duplicate track is small unless it carries an original
  file. Those files are rare, and the stack is 50 steps deep.
- Undo is refused, with an explanation, if the kept copy has since changed in
  a way that cannot be undone. Restoring a backup remains the way back then.
- Near-duplicates, such as the same ride recorded by two devices, are not
  found. That is deliberate, and recorded here so it is not mistaken for a gap.
