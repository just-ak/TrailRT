# ADR 0021: The library becomes a rail, a trip page and a day companion

Status: accepted
Date: 2026-11-12

## Context

The library was one tree rooted at My Collection, holding folders, trips,
their contents, and the cross-trip views of ADR 0004 side by side (Phase 1
Requirement 4). It grew with every phase: a dated trip's days (Phase 10),
linked folders and a Photos view with filters (Phase 11). The owner found it
"cumbersome and not fluid". A review (`docs/design/library-panel/`) named why:
five rows of controls before the first trip, five levels of nesting in a
280 px panel, the same object highlighted twice, containers and views drawn
alike, trips indistinguishable on their rows, and no way to focus on one trip
although the map only ever shows one.

Eight directions were weighed and six options drawn. The owner chose Option E,
the day companion, and asked for it to be built.

## Decision

1. **A rail of sections** replaces the tree's top level: Trips, Routes,
   Tracks, Waypoints, Photos, Imported and Recent. The cross-trip sections
   remain views in the sense of ADR 0004: queries, never containers.
2. **Trips open into a page**: a list of trips with dates and sizes, then one
   trip at a time with Plan, Objects and Photos tabs. Nothing is nested more
   than one level inside a trip.
3. **The right panel answers "when"**. Its reading state, the companion, shows
   the year, the trip by the hour, a day in Plan and Recorded lanes, or the
   selected thing in its day. Its pencil opens today's property editors
   unchanged.
4. **The calendar drawer of Phase 10 is retired**; its day, week and month
   views and stay dragging move into the companion, on the same layout code.
5. **The section, open trip and tab persist**, replacing persisted tree
   expansion.

## Consequences

- Phase 1 Requirement 4.1 to 4.3, Phase 10 Requirement 14's tree summary and
  its calendar drawer, and Phase 11 §8's tree rows are superseded. Phase 14
  records the amendments.
- Dragging an object to another trip goes through the trip list (or "‹ Trips")
  rather than a visible sibling in one tree.
- Several trips' contents are no longer visible at once in the left panel.
  The Routes, Tracks and Waypoints sections list across trips when that is
  wanted.
- The end-to-end suite moves from tree rows to lists; its shared helpers
  change first.
- Pinned trip tiles in the rail (Option F) and a ⌘K palette remain open as
  later additions.
