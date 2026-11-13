# ADR 0022: Items outside a trip are kept by one hidden holder

Status: accepted
Date: 2026-11-13

## Context

Since Phase 2, every route, track and waypoint belongs to a trip:
`trip_id` is `NOT NULL` on `routes`, `tracks`, `waypoints` and
`waypoint_groups`, and Phase 11 put the same rule on `linked_folders`.
Importing one file with no destination makes a trip named after the file.

Phase 14 gave the cross-trip lists their own sections. The owner then asked
to work with routes, waypoints and photos that are not connected to a trip,
from those sections (Phase 14 Requirement 9). Under the current rule, an
imported GPX of one ride becomes a trip in the trip list, and a waypoint
cannot be made at all until a trip exists.

Two ways to allow it:

1. **Make `trip_id` nullable** on five tables. SQLite cannot drop `NOT NULL`
   in place, so each table is rebuilt. Every service that reads a trip
   through its object (geometry, the map's one-trip rule, the undo
   inverses, export, duplicate, the itinerary, the photo index, backups)
   gains a null branch, and the map gains a second way to load geometry.
2. **One hidden holder.** A trips row with `role = 'loose'` holds whatever is
   outside a trip. No foreign key changes. Geometry, undo, move, export and
   backup work as they do for any trip. Each place that lists trips filters
   the holder out, and each place that names an item's trip says "Not in a
   trip" instead.

## Decision

Option 2. The `trips` table gains `role text not null default 'trip'`, with
a check (`'trip' | 'loose'`) and a unique partial index so there is at most
one holder. The holder is created on first use by `tripService.looseTripId`,
never shown as a trip, and never deleted, renamed, archived, duplicated,
exported as a trip, or given an itinerary.

- **Listing.** `listTrips`, `searchTrips`, the library tree's Trips view, the
  overview, the year view and the Move to Trip list skip the holder.
- **Naming.** A row whose trip is the holder says "Not in a trip". The
  sections list those rows first.
- **The map.** Selecting an item outside a trip loads the holder like any
  trip, so the map shows the items outside a trip together. The trip page
  does not open for it.
- **Moving.** "Not in a trip" is a destination for the existing move
  commands, so a move in or out is one undo step, as before.
- **Import.** A file goes where the user is: into the open trip, into the
  holder from a section, or into a new trip named after the file from the
  trip list, as now.
- **Export and backup.** A backup copies the database, holder included. A
  trip export never offers the holder. Exporting its items still works.
  A JSON collection export writes the holder's items without a trip.

## Consequences

- One migration adds a column and an index. Nothing existing changes, and an
  installation with no holder behaves exactly as before.
- The rule "every object has a trip" stays true in the database. Only the
  presentation changes. That keeps the integrity checks of Phases 2 to 11
  valid, including the photo index's per-trip queries.
- Every listing of trips has to remember the filter. The repository applies
  it by default (`listTrips`, `searchTrips`), so a new caller is safe unless
  it asks for the holder.
- An older build that opens this database shows the holder as a trip named
  "Not in a trip". That is visible but not harmful, and it is why the
  holder's stored name is exactly that.
