# TrailRT specs

The source specification was authored outside this repository. It has been
reviewed, and broken into one spec per development phase.

Start with the review — it records where the source specification is internally
inconsistent or technically unachievable as written, and what was decided
instead.

| Document                                                               | Purpose                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`spec-review.md`](spec-review.md)                                     | Findings against the source specification, plus open questions for the owner |
| [`phase-1-foundation/`](phase-1-foundation/)                           | Requirements, design and tasks. **Complete.**                                |
| [`phase-2-routes-waypoints/`](phase-2-routes-waypoints/)               | Requirements, design and tasks. **Complete.**                                |
| [`phase-3-tracks-import-export/`](phase-3-tracks-import-export/)       | Requirements, design and tasks. **Complete.**                                |
| [`phase-4-advanced-mapping/`](phase-4-advanced-mapping/)               | Requirements, design and tasks. **Complete.**                                |
| [`phase-5-object-point-management/`](phase-5-object-point-management/) | Requirements, design and tasks. **Complete.**                                |
| [`phase-6-route-alternatives-shaping/`](phase-6-route-alternatives-shaping/) | Requirements, design and tasks. **Complete.**                            |
| [`phase-7-regions-profile/`](phase-7-regions-profile/)                 | Requirements, design and tasks. **Complete.**                                |
| [`phase-8-windy-roads-routing/`](phase-8-windy-roads-routing/)         | Investigation complete; requirements written. Next to build.                 |
| [`phase-9-garmin-compatibility/`](phase-9-garmin-compatibility/)       | Requirements only. Mostly investigation deliverables.                        |

Only the phases already built, and the next one, have a design and task
breakdown. That is deliberate: section 20 of the source specification requires
that later phases are not designed or implemented until the previous one is
built and tested. Designing Phase 3's import subsystem before Phase 2 existed
would have meant guessing at interfaces that had not yet settled.

Phase 4's requirements were revised after Phase 3 shipped, adding snap-to-road,
a combined route profile, and speed identification with a percentage-of-route
breakdown. The reasoning behind the awkward parts — why a posted speed limit and
a recorded speed are never the same series, and why "unknown" has to be a
visible band — is in ADR 0011. The phase then grew past its own brief: the
routing engine is now embedded in-process rather than called over the network,
with one-press region download driven by the visible map area. ADR 0013 records
that, and the arm64-only consequence.

Windy-roads routing was inserted ahead of the Garmin work, then pushed back by
object and point management, again by route alternatives and shaping, and once
more by UK regions and the fuller profile. It is now Phase 8, and Garmin is
Phase 9. It carries an extra document,
[`investigation.md`](phase-8-windy-roads-routing/investigation.md), because its
brief required a codebase assessment before any architectural decision — and
that assessment found the feature's three stated prerequisites did not exist at
the time. ADR 0012 records what the finding settles and what it defers.

Phase 5 is object and point management: multi-select move and delete across the
library, and a point table for a single route or track with the selected points
highlighted on the map. It sits before windy roads on purpose — that phase
generates routes with thousands of points, and inspecting or trimming them
needed to exist first.

Its investigation also surfaced a live bug, now fixed: no `track:*` command
handler was registered, so `record()` silently discarded every track inverse
and no track mutation could be undone at all. Task 1 registered the five
handlers whose inverses are bounded and left `track:delete` and `track:join`
honestly non-undoable. See ADR 0014.

Phase 6 is route alternatives and shaping. When a route is made between two
points, the routes the engine can offer between them are shown and one can be
chosen. The route can then be shaped by dragging the line, dragging its
points, and adding or removing points. It sits before windy roads because that
phase's output is exactly what a user will want to compare and then adjust. Its
investigation found a live defect: clicking the line of a snapped route inserts
a raw vertex into the derived geometry, and the next re-snap discards it. It
also found that Phase 4 Requirement 3.3's "re-snap only the affected legs" was
never built, because leg boundaries are not stored. See ADR 0017.

Phase 7 came from the owner's feedback on Phase 6. Map regions are picked from
a UK county map, several at once. Following roads is the default way to make a
route. Route profiles gain terrain altitude and a twisty score. A UK road with
no posted limit is counted at the national default, labelled as assumed. The
investigation measured why several regions need merging before Valhalla will
build them, and why points per kilometre is not a twistiness measure. The twisty
score is the windy-roads phase's scoring function, built early. See ADR 0018,
which also amends ADR 0011's rule against country defaults.

## Supporting documents

- [`../../docs/adr/`](../../docs/adr/) — architectural decisions, including the
  ones that resolve contradictions in the source specification
- [`../../docs/progress-mindmap.svg`](../../docs/progress-mindmap.svg) —
  implementation status across all phases
- [`../../docs/licences/third-party-register.md`](../../docs/licences/third-party-register.md)
  — dependency licence register, required by the GPL-3.0 policy
- [`../steering/`](../steering/) — always-applied rules: agent workflow,
  toolchain, architecture boundaries, licensing, progress tracking. Kiro reads
  them directly; Claude Code imports them through
  [`../../CLAUDE.md`](../../CLAUDE.md)

## Decision index

| ADR  | Decision                                                 |
| ---- | -------------------------------------------------------- |
| 0001 | Local-first autosave; no bare "Save" menu item           |
| 0002 | TypeScript 7 with oxlint, not typescript-eslint          |
| 0003 | Track points normalised, with a rebuildable render cache |
| 0004 | Library tree top-level nodes are views, not containers   |
| 0005 | Waze hand-off is single-destination only                 |
| 0006 | Garmin proprietary format scope — amended by 0007        |
| 0007 | GPL-3.0-or-later licence, free distribution, dep audit   |
| 0008 | Leaflet used directly; react-leaflet dropped on licence  |
| 0009 | Ad-hoc signing until a Developer ID is available         |
| 0010 | Native module ABI and Electron binary delivery findings  |
| 0011 | Posted limit and recorded speed are separate; snapping   |
| 0012 | Windy-roads routing needs Phase 4; twistiness steers     |
| 0013 | Valhalla embedded in-process; arm64-only distribution    |
| 0014 | Batch undo, the track undo gap, point-level editing      |
| 0015 | Test geography is a real loop around Buxton              |
| 0016 | Snapping reports points the graph cannot reach           |
| 0017 | Per-leg alternatives, kept as shaping points; renumbering |
| 0018 | UK county regions merged; terrain; twistiness; UK limits |
