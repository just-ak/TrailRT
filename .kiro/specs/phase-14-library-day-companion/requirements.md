# Phase 14: The library and the day companion — requirements

Status: requirements, design and tasks written 12 November 2026. **Built now,
at the owner's request**, while Phase 11's tasks 12 and 13 wait: those two
finish against the new panels rather than twice (design §1).

## Why

The owner's verdict on the left panel: "it works but it's cumbersome and not
fluid". A design review weighed eight directions and two rounds of mock-ups;
the owner chose **Option E, the day companion**, worked through in ten views.

- Review: `docs/design/library-panel/` (Options A to F)
- The chosen design, view by view: `docs/design/library-panel/option-e/`
  (`01-library.svg` to `10-photos-section.svg`)

The design rests on one rule. **The left panel holds the trip's structure, the
map holds place, and whatever is selected, the right panel answers "when is
it, and what is around it".**

What it fixes, from the review's diagnosis:

| # | Today | After |
| --- | --- | --- |
| 1 | Five rows of controls before the first trip | One header row |
| 2 | One object highlighted twice when it appears twice | One highlight |
| 3 | Five levels of nesting in 280 px | One level inside a trip |
| 4 | Containers and cross-trip views drawn alike | A rail of sections; views stay views (ADR 0004) |
| 5 | Trips indistinguishable on their row | Dates, length and counts, or "Empty" |
| 7 | No way to focus on one trip, while the map shows one | The panel opens one trip, as the map does |
| — | A stop's timing and its place edited in two places | One card |
| — | The trip's hours in the calendar drawer, apart from the plan | The right panel, beside it |

## Glossary

- **Rail** — the column of section icons at the window's left edge.
- **Section** — what the rail switches between: Trips, Routes, Tracks,
  Waypoints, Photos, Imported, Recent.
- **Trip page** — one trip in the left panel: header, actions, and the Plan,
  Objects and Photos tabs.
- **Day card** — one day of a dated trip on the Plan tab.
- **Companion** — the right panel in its reading state.
- **Hour scale** — a day drawn by the hour, in a Plan lane and a Recorded
  lane, with photos as dots at the times they were taken.

## Requirement 1: The rail and its sections

**User story:** As a user, I want to switch between my trips and my
cross-trip lists in one click, without them being mixed in one tree.

1. THE window SHALL show a rail at its left edge with Trips, Routes, Tracks,
   Waypoints, Photos, Imported and Recent. Recent SHALL be shown as arriving
   later, not as an empty list.
2. SELECTING a section SHALL show it in the left panel. The section, and the
   trip open in Trips, SHALL persist across restarts.
3. Routes, Tracks, Waypoints and Imported SHALL be flat lists across the
   visible trips, each row naming its trip, as the views of ADR 0004 do now.
   They SHALL remain views: nothing is stored in them.
4. THE rail SHALL be reachable from the keyboard and each icon SHALL have a
   hint and an accessible name.
5. THE library SHALL NOT have a "My Collection" root.

## Requirement 2: The trip list

**User story:** As a user, I want to tell my trips apart at a glance and open
one.

1. THE Trips section SHALL list trips in groups: coming up (dated, ending
   today or later), ideas with no dates, then past trips by year; and folders
   with their trips.
2. EACH trip row SHALL show its name and a second line: its dates, its length
   and counts, or "Empty". A trip starting today or tomorrow SHALL say so.
3. ONE header row SHALL hold search, a menu of options (sort, show archived),
   and a menu to add (trip, folder, import, link a folder).
4. SELECTING a trip SHALL open it in the left panel and load it on the map.
   Back SHALL return to the list where it was left.
5. CREATING, renaming, duplicating, archiving, deleting and moving trips and
   folders SHALL remain possible, by context menu and by drag.

## Requirement 3: The trip page

**User story:** As a user, I want one trip's plan, contents and photos in one
place, with nothing nested more than a level deep.

1. THE trip page SHALL show the trip's name, dates and length, a row of
   actions (link a folder, import, export, more), and three tabs: Plan,
   Objects and Photos, with counts.
2. FOR a dated trip, Plan SHALL show one card per day with its stops and
   drives and their times, and each day's driving and photo count. Items not
   in the plan SHALL follow.
3. FOR an undated trip, Plan SHALL say there is no plan yet and list the
   trip's objects.
4. OBJECTS SHALL list the trip's routes, tracks and waypoints, with
   multi-selection, rename, the context menus, and the batch actions of
   Phase 5.
5. PHOTOS SHALL show the trip's photos grouped by the day they were taken,
   and its linked folders with their state.
6. AN object SHALL be highlighted once, in the place it was clicked.

## Requirement 4: The companion

**User story:** As a user, I want to see when the thing I selected happens and
what is around it.

1. WITH no trip open, the companion SHALL show the year with each trip's days
   marked, and what is planned for today and tomorrow.
2. WITH a trip open and nothing selected, it SHALL show every day of the trip
   side by side by the hour, its totals, and the actions Places along the trip
   and Save to a calendar.
3. WITH a day selected, it SHALL show that day by the hour in Plan and
   Recorded lanes, with photo times, its photos, and controls to step to the
   previous and next day.
4. WITH a stop selected, it SHALL show the stop's card, its day with the stay
   highlighted, photos taken within a kilometre, and nearby places from the
   offline data.
5. WITH a drive selected, it SHALL show its time, distance, height and road
   mix, its place in the day, and places along the way that can be added as
   stops.
6. WITH a photo selected, it SHALL show its moment on its day and what it was
   taken during. The preview box SHALL stay in the map's bottom-left corner
   (Phase 11 Requirement 6).
7. WITH a recorded track selected, it SHALL show its times and statistics in
   the Recorded lane of its day. A track with no timestamps SHALL say it
   cannot be placed on a day.
8. FOR an undated trip, it SHALL offer a start date and time and say what
   they will give. Nothing SHALL be timed without a date.
9. THE hour scale SHALL span from an hour before the day's first event to an
   hour after its last. Missing times SHALL stay missing: an untimed drive is
   drawn as not timed, never as zero.

## Requirement 5: Editing

**User story:** As a user, I want to change what I selected without losing
any of today's editing tools.

1. EACH companion card SHALL have an edit control that opens the object's
   editor in the right panel: today's route, track, waypoint, trip and folder
   properties, with everything they do now.
2. A stop's editor SHALL hold its timing and its place together: arrive by,
   stay, leave, notes, and the waypoint's name, position and symbol.
3. BEFORE a timing change is saved, the editor SHALL show its consequence on
   the following stops and days. Saving SHALL be one undo step; cancelling
   SHALL change nothing.

## Requirement 6: Retiring the calendar drawer

1. THE calendar drawer of Phase 10 SHALL be removed once the companion's trip
   view shows everything it showed, including export to a calendar file.
2. THE drawer below the map SHALL keep the profile, the point table, places
   along the way and the photo list.

## Requirement 7: The Photos section

1. THE Photos section SHALL show photos across every trip as a grid, grouped
   by trip, with Trip and Year filters (Phase 11 Requirement 4.6).
2. SELECTING the section SHALL put the map in all-trips mode (Phase 11
   Requirement 5.6). Selecting a photo SHALL show its trip and day in the
   companion, with a control to open the trip at that day.
3. THE grid SHALL stay responsive with 40,000 photos: it is virtualised, and
   thumbnails are made only for what is on screen (Phase 11 Requirement 9.3).

## Requirement 8: Testing

1. THE hour scale's layout, the trip grouping and the day assignment SHALL be
   pure functions with unit tests.
2. END-TO-END tests SHALL drive the new panels. The shared helpers change
   first, so each spec changes as little as possible.
3. EVERY behaviour the replaced tree had SHALL be covered again or recorded
   as removed with a reason.

## Requirement 9: Items outside a trip

Added 13 November 2026 from the owner's feedback on tasks 4 and 5: "You
should be able to use the left panel when working with individual
routes/waypoints/images that are not connected to a trip."

**User story:** As a user, I want to keep a route, a waypoint, a recorded
track or a folder of photos on its own, and work with it from its section,
without first making a trip for it.

1. ROUTES, tracks, waypoints and linked photo folders SHALL be able to exist
   outside any trip.
2. THE Routes, Tracks, Waypoints and Photos sections SHALL offer, with no trip
   open, what makes sense there: a new route, a new waypoint, importing files,
   and linking a folder. What they make is outside any trip.
3. SELECTING an item outside a trip SHALL show it on the map, with the other
   items outside a trip, and its card in the companion with its editor behind
   the pencil. No trip page opens and the section stays where it was.
4. A row in a section SHALL name its trip, or say "Not in a trip". Items
   outside a trip SHALL be listed first.
5. AN item SHALL move into a trip, and out of one to "Not in a trip", by its
   context menu, by the batch Move and by drag. Each move SHALL be one undo
   step.
6. IMPORTING SHALL put files where the user is: in a trip on its page,
   outside any trip in a section, and in a new trip named after the file from
   the trip list, as now.
7. ITEMS outside a trip SHALL NOT be shown as a trip: not in the trip list,
   the year view, trip search, the Move to Trip list's trips, or a trip
   export. A backup SHALL keep them.

## Requirement 10: As drawn

Added 13 November 2026, from the same feedback: the build follows the chosen
mock-ups (`docs/design/library-panel/option-e/`), not an approximation of
them.

1. ROWS SHALL use the line icons of the mock-ups (route, track, waypoint,
   folder, photo), never emoji.
2. A dated trip's Plan SHALL draw each day as a card: the date and its
   driving, distance and photos as the card's heading, and its stops and
   drives as rows with their times on the right.
3. THE Trips header SHALL be the section's name and count with the options
   and add buttons, and the search field beneath it, as in view 1.
4. EACH companion view SHALL match its mock-up's content and order. A
   difference forced by the code SHALL be recorded in the design.

## Changes to earlier phases

- **Phase 1 Requirement 4.1 to 4.3** (a tree rooted at My Collection, its
  placeholder branches, persisted expansion) are replaced by Requirements 1
  and 2 here. ADR 0021.
- **Phase 10 Requirement 14** (a dated trip summarised in the tree) moves to
  the trip list and the day cards. **Its calendar drawer** is replaced by the
  companion (Requirement 6).
- **Phase 11 §8** (the Linked folders group and the Photos view in the tree)
  moves to the trip page's Photos tab and the Photos section.
- **Phase 2 and 3: every route, track and waypoint belongs to a trip.**
  Requirement 9 lets them stand outside one. ADR 0022.
- **Phase 11 Requirement 1: a folder is linked to a trip.** A folder can now
  be linked outside any trip too (Requirement 9.2).

## Out of scope

- A ⌘K command palette (the review's eighth direction).
- Pinned-trip tiles in the rail (Option F); possible later.
- Recently Used, which stays "later".
