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

**User story:** As a user, I want to tell my trips apart at a glance, look
through them without losing my place, and open one when I mean to.

1. THE Trips section SHALL list trips in groups: coming up (dated, ending
   today or later), ideas with no dates, then past trips by year; and folders
   with their trips.
2. EACH trip row SHALL show its name and a second line: its dates, its length
   and counts, or "Empty". A trip starting today or tomorrow SHALL say so.
3. ONE header row SHALL hold search, a menu of options (sort, show archived),
   and a menu to add (trip, folder, import, link a folder).
4. SELECTING a trip SHALL select it and load it on the map, and the
   companion SHALL show it as Requirement 4.2 describes. The list SHALL stay
   as it is: selecting never replaces it with the trip page. The arrow keys
   SHALL move the selection between trips the same way. *(Amended 13 November
   2026 from "selecting a trip opens it", at the owner's request: the jump to
   the trip page broke the flow of looking through trips. The flow is drawn
   in `docs/design/library-panel/trip-list-flow/`.)*
5. CREATING, renaming, duplicating, archiving, deleting and moving trips and
   folders SHALL remain possible, by context menu and by drag.
6. A trip SHALL open in place under its chevron, or with → and ←, showing
   what is in it. Selecting something inside SHALL show it on the map and in
   the companion, with the list still in view.
7. OPENING a trip's page SHALL be its own step: a double-click, Return, the
   selected row's arrow, or Open in the companion. ‹ Trips SHALL return to the
   list with that trip selected, the same rows open and the same scroll
   position.

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
2. WITH a trip selected, open or not, and nothing in it selected, it SHALL
   show the trip's details: when it leaves, whether each day fits the daily
   driving limit and whether the fuel lasts, the driving rules, and the
   actions Places along the trip and Save to a calendar. It SHALL NOT repeat
   the name, dates, days or stops the left panel shows. *(Amended 13 November
   2026 from "every day side by side by the hour": the owner's rule of key
   items on the left and details on the right, Requirement 11.)*
3. WITH a day selected, it SHALL show that day by the hour in Plan and
   Recorded lanes, with photo times, its photos, and controls to step to the
   previous and next day.
4. WITH a stop selected, it SHALL show how long the stay is, as a field, what
   a change to it would move, the stop's notes, photos taken within a
   kilometre, and nearby places from the offline data. *(Amended 13 November
   2026, Requirement 11.)*
5. WITH a drive selected, it SHALL show how it is travelled (following a
   route, by road, or other transport) as a field, its distance, height and
   road mix, and places along the way that can be added as stops. *(Amended
   13 November 2026, Requirement 11.)*
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

*(Amended 13 November 2026: a trip, a stop and a drive are edited where their
details are shown, with no separate editor. See Requirement 11.)*

1. A route's, track's, waypoint's or folder's companion card SHALL have an
   edit control that opens its editor in the right panel: today's properties,
   with everything they do now.
2. A trip's, stop's and drive's details SHALL be fields in the companion,
   editable where they are shown. They SHALL have no edit control and no
   separate editor.
3. BEFORE a stay is changed, the stop's details SHALL show what the change
   would move on the following stops and days. Each change SHALL be one undo
   step.

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
   context menu and by the batch Move. Each move SHALL be one undo step.
   *(Drag was dropped as built: a section and a trip are never both in the
   left panel, so there is nothing to drag between. Dragging onto a day of a
   trip's plan is Requirement 12.7.)*
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

## Requirement 11: One place for each fact

Added 13 November 2026 from the owner's feedback on the trip editor: "we're
duplicating information between the left and right. Key items should be
left, details right." Drawn in `docs/design/trip-editor/round-2/`.

**User story:** As a user, I want each thing shown once, in the place I
change it.

1. THE left panel SHALL hold what a trip contains and its order, and the
   changes to that structure: adding, removing, reordering and renaming.
2. THE right panel SHALL hold the details of the one selected thing. Nothing
   SHALL appear in both panels except the selection's name, as the right's
   heading.
3. THE trip's name SHALL be renamed in place in the trip page's header.
4. EACH day card SHALL have Add. It SHALL open a search in place over the
   trip's waypoints and routes, items outside a trip, routes, tracks and
   waypoints in other trips, offline places and postcodes, and points of
   interest along the route. The companion SHALL show what adding the
   highlighted result would do before it is added.
5. A stop SHALL be reordered by drag, within its day and between days, and
   removed from the plan by ×. A removed stop's waypoint SHALL stay in the
   trip, under Not in the plan.
6. A trip's description and notes SHALL NOT be shown in the panels. They
   SHALL be kept in the trip's data and its exports, and reached from the
   trip's ⋯ menu, which also holds Remove the plan and Delete trip.
7. COUNTS, status and the created date SHALL NOT be repeated in the right
   panel. Import, export and linking a folder SHALL stay in the trip page's
   header only.

## Requirement 12: Things made outside a plan

Added 13 November 2026 from the owner's feedback: "a route/tracks/waypoints
should be able to be defined outside a plan, and then included into a plan."
Drawn in `docs/design/trip-editor/round-3/`.

**User story:** As a user, I want to make a route, a track or a waypoint on
its own, and put it into a trip's plan when I am ready.

1. AN item SHALL be in one of three places: outside any trip (Requirement 9),
   in a trip but not in its plan, or in the plan. It SHALL move inward and
   back out one step at a time. Adding it to a day SHALL also put it in that
   day's trip.
2. A waypoint in the plan SHALL be a stop.
3. A route in the plan SHALL be the drive between two stops, followed exactly
   and linked, not copied: editing the route SHALL change the drive. If both
   its ends are within 1 km of the stops either side, it SHALL replace the
   drive planned by road. If not, TrailRT SHALL say so and offer to add its
   ends as stops, each joined by road to the stop beside it. Nothing SHALL be
   joined without asking. *(The drawing offered "join it by road" as a second
   choice. A leg runs between two stops, so a route whose ends are not stops
   cannot be joined any other way; the choice is recorded in design §5.5.)*
   *(Superseded 14 November 2026 by Requirement 13.4: a route is no longer
   refused or questioned for its ends.)*
4. A track SHALL be placed on the day and at the hour it was recorded, from
   its own times. A track with no times SHALL say it cannot be placed on a
   day (Requirement 4.7); TrailRT SHALL NOT invent a time for it.
5. A route's details SHALL offer Put it in a plan: a trip, a day, and the
   stop it follows, with what adding it would do.
6. AN item in another trip SHALL be added by moving or copying it, chosen by
   the user each time, with copying as the default.
7. WHAT is in a trip but not in its plan SHALL be listed at the foot of the
   Plan tab, and SHALL be dragged onto a day to add it there.
8. TAKING a route out of the plan SHALL return its drive to by road and leave
   the route in the trip.

## Requirement 13: Less strict, and quicker to start

Added 14 November 2026 from the owner's feedback on tasks 8 to 11: "Right
click on Routes says New Trip, not New Route. Right click on the map should
have a pop up, with Add Waypoint, Start new Route. Don't be so strict on
Trips, you shouldn't need a Waypoint to start/end. You should be able to drop
in routes into a trip, and then if selecting two routes, waypoints you can
then link with creating a new route."

**User story:** As a user, I want to start from wherever I am, build a trip
from the routes I already have, and join them up without ceremony.

1. A right-click in a list's empty space SHALL offer what that list makes: a
   route in Routes, a waypoint in Waypoints, an import in Tracks and
   Imported, a linked folder in Photos, a route or waypoint on a trip's page,
   and a trip or folder in the trip list.
2. A right-click on the map's ground SHALL offer Add a Waypoint Here and
   Start a New Route Here, made where the user is (Requirement 9.2). Routes,
   tracks and waypoints on the map keep their own menus.
3. A stop SHALL NOT need a waypoint. A stop may be a point where a route
   starts or ends; it is shown in the plan but is not a waypoint in the trip.
   A plan SHALL be able to begin and end with a route. *(Superseded the same
   day by Requirement 14: a route is an entry of its own, so no point is made
   for its ends. Points made before then still show.)*
4. A route added to a plan SHALL go in whatever its ends: an end within 1 km
   of the stop beside it joins that stop; otherwise a point stop is made at
   that end and joined by road. *(Amends 12.3. Superseded by Requirement 14.2:
   no point is made; the gap is a drive by road.)*
5. WITH two routes or waypoints selected, Join with a New Route SHALL make a
   route from the first one's end to the second one's start, by road when
   routing is available, and Join with a Straight Line SHALL do the same with
   a straight line. Each SHALL be one undo step.
6. FILES dropped on the window while a trip's page is open SHALL be imported
   into that trip by default (Requirement 9.6).

## Requirement 14: Routes and waypoints in any order

Added 14 November 2026 from the owner's feedback on task 13: "Trips don't
need a start / end point, you should just be able to drag/drop routes and
waypoints into it, organise the order freely."

**User story:** As a user, I want a trip's plan to be the routes and
waypoints I put in it, in the order I choose.

1. A plan SHALL be an ordered list of entries, each a waypoint or a route.
   Routes and waypoints SHALL be dragged into it, from Not in the plan or onto
   any day, including an empty one, and every entry SHALL be dragged to any
   position. A plan SHALL need no stop to start or end it.
2. A route in the plan SHALL be one entry: reached at its start, driven, and
   left at its end. No stop or point SHALL be made for its ends.
3. WHERE an entry starts within 1 km of where the one before it ends, nothing
   SHALL join them. Otherwise the gap SHALL be a drive by road, planned as the
   drive between two stops is, or shown as not planned.
4. A route entry's driving SHALL count on the day it starts, towards the
   daily limit and the day's totals.
5. TAKING a route entry out of the plan SHALL leave the route in the trip,
   and undo SHALL bring the entry back where it was.

## Requirement 15: Adding and removing days

Added 14 November 2026 from the owner's feedback on task 15: "On the trip
section, we need to be able to add a day easily and remove a day, on removing
a day the objects should move to not in the plan."

**User story:** As a user, I want to add a day to a trip, or take one away,
in one step.

1. EACH day card SHALL offer Add a Day After, and the plan SHALL end with
   Add a Day. A new day SHALL start empty, at the plan's usual leaving time,
   and the days after it SHALL move on by one.
2. EACH day card SHALL offer Remove This Day. Its routes and waypoints SHALL
   leave the plan and stay in the trip, under Not in the plan. Removing the
   first day SHALL start the plan on the next day, keeping that day's date.
   Each SHALL be one undo step.
3. AN entry whose time is not known yet SHALL be shown on the day it follows
   in the plan, in plan order, rather than apart from the days.

## Requirement 16: Right-click in the plan, and reordering within a day

Added 14 November 2026 from the owner's feedback on task 16: "Not in the
plan items need a right click to allow remove from plan, and delete.
Allowing re-ordering also within a trip day with drag drop."

1. AN entry of the plan SHALL have a menu with Take Out of the Plan, and
   Delete Waypoint or Delete Route.
2. DELETING a route or waypoint from the plan SHALL also remove every entry
   of the plan that uses it, and unlink a drive that followed it, as one undo
   step, so nothing in the plan points at something deleted.
3. AN item under Not in the plan SHALL have a menu with Add to the End of
   the Plan, Move Out of the Trip, and Delete (a track through the
   confirmation that it cannot be undone).
4. AN entry dropped on another entry SHALL take its place, in either
   direction, so two entries in a day swap in one drag.

## Requirement 17: Region builds that can be tried again

Added 14 November 2026 from the owner's report: "Downloading new regions,
the download worked, but when building the new combined the system
reported a SIGTERM message, we need to work out why, perhaps split the
download & build to two processes, as we don't need to re-download every
time." Amends Phase 7 Requirement 1.11.

1. DOWNLOADING and building SHALL be separate steps. A region downloaded in
   the last 30 days SHALL be reused rather than downloaded again, so a build
   that fails is tried again without downloading, and the progress SHALL say
   when a download is reused. A download SHALL be kept only once complete.
2. EACH build SHALL keep its whole log, with when it started, the machine's
   memory at its start and end, its stage, and how it ended, and a failure
   SHALL say where the log is.
3. A tool stopped by a signal TrailRT did not send SHALL say so, and that the
   downloads are kept for another try.
4. THE graph-building tools that development and the tests run SHALL be
   signed as the app signs them, with the entitlement LuaJIT needs, and a
   test SHALL fail if they are not. *(The cause of the report: macOS's own
   crash report shows the tile builder killed with "Code Signature Invalid /
   Invalid Page" inside LuaJIT while reading roads.)*

## Requirement 18: Routes that look movable, and photos as waypoints

Added 14 November 2026 from the owner's feedback: "when working with the map
& routes, when the cursor goes over a route that it could move, it should
change to a hand perhaps. As it's difficult to change an existing route.
Additionally, photographs could be used as waypoints."

1. OVER the line of a route that can be shaped by dragging, the pointer SHALL
   be an open hand, and the part of the line that would be taken SHALL be
   shown faintly. WHILE it is being dragged the pointer SHALL be a closed
   hand, wherever it is on the map.
2. OVER any point that can be dragged (a route's points, a shaping point, a
   waypoint) the pointer SHALL be an open hand, and a closed hand while it is
   dragged. A route that is not selected keeps the pointing hand, because a
   click selects it rather than moving it.
3. A PHOTO with a location SHALL be usable as a waypoint, from the preview
   box and by right-clicking it on the map. The waypoint SHALL be at the
   photo's location, named from its file, with the photo's altitude when it
   has one and none when it does not, the photo symbol, and its source
   recorded as a photo. It SHALL go in the open trip, or else the photo's own
   trip (outside any trip for a folder linked outside one), and be one undo
   step. A photo with no location SHALL say why it cannot be used.
4. A LOCATED photo SHALL be addable to the open trip's plan as a stop from
   the same two places, in one undo step: on the day it was taken when the
   plan has that day, and at the end of the plan otherwise.
5. USING the same photo again in the same trip SHALL reuse the waypoint it
   already made rather than make another at the same place.

## Requirement 19: Waypoints off the map from the left panel

Added 14 November 2026 from the owner's feedback: "show/hide waypoints on
the left menu as a little toggle, due to large numbers of waypoints in some
circumstances". Asked what it should hide, the owner chose the map.

1. THE left panel's top row SHALL have a small toggle that hides and shows
   waypoints on the map, whatever section or tab is open.
2. IT SHALL be the same saved setting as Layers › Waypoints, so each shows
   what the other did, and it SHALL survive a restart.
3. WHILE waypoints are hidden the toggle SHALL look pressed, so a map
   without them is never a surprise. The lists in the left panel SHALL be
   unchanged.

## Requirement 20: Search by pattern, across routes too

Added 16 November 2026 from the owner's feedback: "Search trips/routes should
use regex".

1. THE left panel's search SHALL match the names of trips, routes and
   waypoints. Routes were not searched before.
2. THE search text SHALL be a regular expression, matched anywhere in the
   name and ignoring case, so plain text still finds what it did (`peak`
   finds "Peak District Weekend"), and `^Day [0-9]`, `wales|scotland` and
   `20(24|25)` work as patterns. Items outside a trip SHALL be found too and
   shown as "Not in a trip", never as a trip (Requirement 9.7).
3. A PATTERN that is not valid, often one half typed such as `(`, SHALL say
   what is wrong in place of the results, and SHALL NOT show results from
   an earlier pattern as if they matched this one.
4. THE search field SHALL say that it takes a pattern, so the behaviour is
   discoverable rather than a surprise.

Criteria 5 to 7 were added the same day, after task 21 was built, from the
owner's next note: "The search does not appear to be working relevant to the
section that is open in the menu". Task 21 searched the whole library from
every section.

5. THE search SHALL narrow the list that is open, in place: the trips in the
   trip list, the routes, tracks, waypoints, photos or imported data in their
   sections, and a trip's routes, tracks and waypoints on its page. A group or
   folder holding a match SHALL open to show it, and one whose own name
   matches SHALL keep everything in it. The narrowed rows SHALL be ordinary
   rows: selected, opened and right-clicked as ever.
6. WHILE there is search text, a switch SHALL offer In the open list or
   Everywhere. Everywhere SHALL search trips, routes and waypoints across the
   library as in criterion 1. Clearing the search SHALL return it to the open
   list.
7. WHEN nothing in the open list matches, it SHALL say so and offer to search
   everywhere.

## Requirement 21: Move to any trip from the right-click menu

Added 16 November 2026 from the owner's feedback: "Right click should be able
to pick from a long list of trips."

1. A ROUTE, track or waypoint's right-click menu, and a multi-selection's,
   SHALL offer Move to Trip…, which opens a list of every trip, with "Not in
   a trip" first. The menu listed only the first eight or nine before, so
   most trips could not be reached.
2. THE list SHALL scroll, and SHALL have a filter at the top that takes the
   same patterns as the search (Requirement 20), with the focus in it when
   the list opens.
3. THE list SHALL work from the keyboard: the arrow keys move through the
   trips shown, Return moves to the one highlighted, and Escape closes the
   list without moving anything.
4. A MOVE SHALL be one undo step, through the batch path, as before
   (Requirement 9.5). Choosing Move to Trip… SHALL NOT itself move anything:
   the multi-selection's version moved to the first trip in the list.

## Requirement 22: Tracks by name or by date

Added 16 November 2026 from the owner's feedback: "Tracks list, this should
be sortable/group by either name or date year/month/day. (Tree Style)".

1. THE Tracks section SHALL offer to arrange its tracks by Name, as a flat
   list, or by Date, as a tree of year, month and day holding the tracks
   recorded then. Distance, which the library options offered before, SHALL
   stay as a third arrangement.
2. EACH arrangement SHALL run either way: A to Z or Z to A, newest or oldest
   first, longest or shortest first. Choosing Date SHALL start newest first.
   The arrangement and its direction SHALL survive a restart.
3. A TRACK SHALL be dated by its first timed point, in the time zone where it
   starts. Where TrailRT does not know that zone, the computer's SHALL be used
   and the track SHALL say so (ADR 0019 §3).
4. A RECORDING with no times SHALL be listed under No date, last, and SHALL
   NOT be given a date.
5. EVERY year, month and day SHALL show how many tracks it holds. The newest
   year, its newest month and that month's days SHALL be open the first time,
   so the latest tracks show at once; later collapsing is respected.
6. THE search (Requirement 20.5) SHALL narrow the tree, opening the way to a
   match.

Criterion 7 was added the same day from the owner's next note: "Tracks that
don't have a date, most probably have the date in the name, look for
dd-mm-yy, dd-day-yyyy etc." It amends criterion 4.

7. A TRACK with no times whose name holds a date (16-05-25, 16/05/2025,
   16 May 2025, 16th-May-25, 2025-05-16, 20250516, May 16, 2025) SHALL be
   placed under that day, after the day's recorded tracks, marked as dated
   from its name and saying which text was read. Numbers SHALL be read day
   first; month first only where day first is not a date. The date SHALL NOT
   be written into the track, whose times stay missing. A track with neither
   stays under No date.

## Requirement 23: Show tracks on the map from the list

Added 16 November 2026 from the owner's feedback: "Tracks when clicking on a
single track, or a year/month/day should be shown on the map when clicking on
the detail arrow (which we don't have yet)".

1. IN the Tracks section, every track row and every year, month and day row
   SHALL have an arrow that shows those tracks on the map and fits the map to
   them. It SHALL appear on hover and focus, and stay while a track's row is
   selected.
2. THE tracks SHALL be shown whichever trips they belong to, beside what the
   map already shows, and even with the Tracks layer hidden, since they were
   asked for.
3. THE map SHALL say what it is showing ("May 2026 · 3 tracks") with a way to
   clear it. A new request SHALL replace the last.
4. A TRACK's arrow SHALL also select the track, as clicking its row does.

## Requirement 24: A space limit on backups

Added 16 November 2026 from the owner's feedback, after their disk filled:
"Lets add a max backup space, 2GB as default, make it rolling", and "we need
to separate user data backup, and offline backup of maps which we shouldn't
backup". ADR 0025.

1. BACKUPS SHALL be kept within a space limit, 2 GB by default and set in
   Settings, as well as the existing count. The oldest SHALL be removed first,
   whichever limit is reached.
2. THE newest backup SHALL always be kept, even when it alone is over the
   limit, and Settings SHALL say when that is so.
3. A BACKUP SHALL NOT be written when it would leave the disk with less than
   1 GB free; it SHALL say why instead.
4. A RESTORE's safety copy SHALL NOT remove the backup being restored, and a
   backup SHALL NOT be removed by its own clean-up.
5. SETTINGS SHALL show how much space the backups use against the limit, and
   say what a backup holds: everything the user made, and not map regions,
   terrain, place and postcode search or photo thumbnails, which are
   downloaded or rebuilt and are never backed up.

## Requirement 25: Each imported file kept once

Found while measuring the owner's library for Requirement 24. ADR 0025.

1. AN imported file's original bytes SHALL be stored once, however many tracks
   were read from it, and every track SHALL still reach its original byte for
   byte.
2. A file SHALL be removed when the last track read from it is removed.
3. AN existing library SHALL be upgraded in place: the copies collapsed and the
   database compacted, with nothing lost.

## Requirement 26: Show routes and waypoints on the map from the list

Added 24 November 2026 from the owner's feedback: "the Routes in the left
menu should have the same arrow when selected and then click on the arrow to
show the route on the map. this should also be on the waypoints too." It
extends Requirement 23 to the Routes and Waypoints sections.

1. IN the Routes and Waypoints sections, every route and waypoint row SHALL
   have the arrow of Requirement 23. It SHALL appear on hover and focus, and
   stay while the row is selected.
2. A ROUTE's arrow SHALL select the route and fit the map to it. A route with
   no points SHALL say so rather than leave the map where it was.
3. A WAYPOINT's arrow SHALL select the waypoint and centre the map on it,
   zoomed in to at least street level but never zoomed out.
4. THE route or waypoint SHALL be drawn even with its layer hidden, since it
   was asked for, for as long as it stays selected.

## Requirement 27: A folder's photos under the Photos list

Added 24 November 2026 from the owner's feedback: "when selecting photo's the
preview of each photo should be underneath, and then when you select it, then
navigate the map to the position."

1. IN the Photos section, selecting a linked folder SHALL show its photos as
   thumbnails underneath the list, grouped by the day they were taken, undated
   last, as the trip page's Photos tab does.
2. THE grid SHALL stay responsive with a folder of tens of thousands of
   photos: only the rows on screen are drawn, and a thumbnail is made only for
   a cell that is on screen (Requirement 7.3).
3. SELECTING a thumbnail SHALL select the photo, as clicking it on the map
   does, and move the map to where it was taken, zoomed in to at least street
   level but never zoomed out.
4. A PHOTO with no location SHALL be marked as such in the grid, and selecting
   it SHALL say why it cannot be shown on the map rather than move the map.

## Requirement 28: Remove duplicates by content

Added 24 November 2026 from the owner's request: "need a remove duplicates,
from trails, routes, waypoints, based on content, not on name". ADR 0027.

1. THE Tracks, Routes and Waypoints sections SHALL each offer Remove
   Duplicates…, from the panel's More menu and from a right-click on the
   list's empty space.
2. TWO items SHALL be duplicates when their content is exactly the same,
   whatever their names, descriptions, colours or symbols:
   - tracks: every recorded point in order, with its position, elevation and
     time, and where each segment breaks;
   - routes: every point of the drawn line in order, with its position and
     elevation;
   - waypoints: the position and elevation.
   Content SHALL be compared exactly. Items that are only nearly the same are
   not duplicates.
3. ONLY items in the trips the library shows SHALL be compared, with those
   outside a trip; archived trips SHALL count only while they are shown.
4. FROM each group of duplicates one copy SHALL be kept: one a trip's plan
   uses first, then one in a trip rather than outside one, then the oldest.
   A copy a plan uses SHALL never be removed, and SHALL be listed as kept and
   why.
5. BEFORE anything is removed, a dialog SHALL list each group: the copy kept
   and the copies to remove, with the trip each is in. Each group SHALL have
   a tick box. A group whose copies sit in more than one trip SHALL start
   unticked and say so, since copying an item to another trip may be
   deliberate; items outside a trip do not count as another trip.
6. REMOVING SHALL be one undo step that puts every copy back as it was, with
   its name, trip, metadata and original file. A removed track SHALL be
   rebuilt from the copy that was kept, and SHALL refuse with a reason if that
   copy has since changed or gone. If the routes removed hold more points
   than one undo step carries, the dialog SHALL say before removing that it
   cannot be undone.
7. AN item that changed between the dialog opening and the removal SHALL be
   skipped rather than removed, and the result SHALL say how many were.
8. WITH no duplicates, the dialog SHALL say how many items it compared and
   that none are the same.

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
- **Phase 3: original files.** Kept once per file rather than once per track
  (Requirement 25, ADR 0025). What is kept is unchanged.
- **Phase 11 Requirement 1: a folder is linked to a trip.** A folder can now
  be linked outside any trip too (Requirement 9.2).

## Out of scope

- A ⌘K command palette (the review's eighth direction).
- Pinned-trip tiles in the rail (Option F); possible later.
- Recently Used, which stays "later".
