# Phase 14: The library and the day companion — design

Written 12 November 2026 against the code at commit `3c30338` (Phase 11
tasks 1 to 11). Amended 13 November 2026 with the owner's feedback on tasks 4
and 5: items outside a trip (§5.4) and building to the drawings (§4.6); and
the same day with the trip list flow (§4.7); and later that day with one
place for each fact (§4.8, §4.9) and things made outside a plan (§5.5),
drawn in `docs/design/trip-editor/round-2/` and `round-3/`. The mock-ups are `docs/design/library-panel/option-e/`; this
document says how they are built on what exists.

## 0. The shape

```
 rail │ left panel: structure │      map: place       │ right panel: time
──────┼───────────────────────┼───────────────────────┼────────────────────
 Trips│ trip list ⇄ trip page │ the open trip, or all │ companion (reading)
 Rts  │   Plan · Objects ·    │ trips' photos in the  │   ⇄ editor (pencil):
 Trks │   Photos tabs         │ Photos section        │   today's properties
 Wpts │ flat lists for the    │                       │
 Phot │ cross-trip sections   │                       │
```

Two choices keep this from being a rewrite:

- **The right panel's editors are today's properties panel.** Route snapping,
  road data, the profile, track editing and the trip and folder fields are
  rich and tested. The companion is a reading view in front of them; its
  pencil opens them unchanged.
- **The hour scale is the Phase 10 calendar's layout.**
  `renderer/features/itinerary/calendarLayout.ts` already places a day's
  blocks with zones, overlaps and the 45-minute minimum, and snaps dragged
  stays. It moves to `shared/itinerary/` and gains the Recorded lane and photo
  times. The calendar drawer's day, week and month views move into the
  companion rather than being redrawn.

## 1. What this collides with

| Existing | Collision | Resolution |
| --- | --- | --- |
| Phase 1 Requirement 4: a tree rooted at My Collection, placeholder branches, persisted expansion | The tree is replaced | Amended by ADR 0021. Expansion state gives way to the section, open trip and tab, persisted as settings (§3.3). |
| ADR 0004: top-level Routes, Tracks… are views, not containers | They leave the tree | They stay views, now sections of the rail fed by the same queries (`libraryService.tree`'s view branches). |
| Phase 5: multi-selection, keyboard model, batch move and delete, drag | Lived in `LibraryPanel` with `treeSelection.ts` | `treeSelection.ts` is generic over ordered rows and is reused by every list. Batch actions and dialogs are unchanged. Drag between trips: onto a trip row in the list, or onto "‹ Trips" which opens the list. |
| `selectionStore`: one anchor, its trip loaded on the map | A selected **day** is not an object | Selecting a day selects its trip and sets `companionStore.day`. The trip stays the anchor, so the map's one-trip rule holds. |
| `select(null)` clears the map | Selecting the Photos section clears the selection | Unchanged: the Photos section is all-trips mode (Phase 11 §9), which shows no single trip. |
| Phase 10 calendar drawer | The companion shows the same hours | The drawer's three views move into the companion (§5.2); `planDrawer: calendar` goes. Places along the way stays a drawer. |
| Phase 10 Requirement 14: a dated trip summarised in the tree | No tree | The trip list's second line uses `tripSummary`; the day cards use `itineraryTreeChildren`'s grouping logic, extracted (§3.1). |
| Phase 11 §8: Linked folders row, Photos view and its filters in the tree | No tree | The trip page's Photos tab and the rail's Photos section. `libraryService`'s photo filter is reused for the section's folder groups. |
| Phase 11 photo selection lives in `photoStore`, apart from `selectionStore` | The companion must know which was chosen last | `companionStore.focus` records the last of: object, day, photo (§4.3). |
| End-to-end tests: about 100 references to tree rows across 11 specs | Every spec that creates a trip goes through the tree | `tests/e2e/helpers.ts` gains the new verbs first (`createTrip`, `openTrip`, `openSection`, `rowFor`), and specs move to them task by task (§7). |

## 2. Accessibility and roles

The tree's `role="tree"` was right for a tree. The new panels are lists:

- the rail is a `tablist` of `tab`s controlling the left panel (`tabpanel`);
- the trip list, section lists and Objects tab are `listbox`es with
  `aria-multiselectable` where batch actions apply, rows are `option`s;
- the trip page's tabs are a `tablist`;
- day cards are `group`s labelled with the date; their rows are `option`s.

The roving tab stop and arrow keys of Phase 5 carry over through
`treeSelection.ts`, which needs only an ordered list of rows.

As built (task 4): the lists keep `role="tree"` and `treeitem`. A trip's
page holds day groups and linked folders that expand, which is a tree, and
one component draws every list (§4.2), so they share one role. The rail is a
`tablist` of `tab`s as planned. End-to-end tests that find rows by name kept
working because of this.

## 3. Data

### 3.1 Pure modules (shared, unit tested)

- `shared/itinerary/calendarLayout.ts` — moved from the renderer unchanged; the
  renderer path re-exports it until its last importer moves.
- `shared/itinerary/dayScale.ts` — a day's scale: the range (an hour before
  the first event to an hour after the last, on whole hours, within the day),
  the Plan lane (`placeDay`), the Recorded lane (tracks by `startedAt` and
  `endedAt`, clipped to the day, lanes when they overlap), and photo times
  (`takenLocal` with its offset; without one, read in the day's zone and
  marked camera time). Untimed legs are returned as untimed, never zero.
- `shared/library/tripGroups.ts` — trips into Coming up, Ideas and past
  years, with "Today" and "Tomorrow" labels, from overview rows and today's
  date.
- `shared/itinerary/dayCards.ts` — the day-by-day rows of a dated trip, from
  `itineraryTreeChildren`'s logic, as data rather than tree nodes. The tree
  function is deleted with the tree.

### 3.2 New channels

| Channel | Returns | Why |
| --- | --- | --- |
| `trips:overview { includeArchived }` | `TripOverview[]`: id, name, folder, status, start and end date, days, distance, counts of routes, tracks, waypoints, photos and linked folders, updated | One call for the trip list and the year view. Built in `libraryService` beside the tree it replaces, reusing `itineraryService.listAll`. |
| `photos:forTrip { tripId }` | `Photo[]` of every linked folder of the trip, taken order | Day cards' photo counts, the Photos tab, the hour scale's photo times. |

Both are zod-validated, preload by name, and added to the bridge's exact
namespace test.

### 3.3 Settings

`librarySection` (`'trips' | 'routes' | 'tracks' | 'waypoints' | 'photos' |
'imported'`), `openTripId` (`string | null`, ignored when the trip is gone),
`tripTab` (`'plan' | 'objects' | 'photos'`). `expandedNodeIds` stays in the
schema for one release so an older build can still read it, and is no longer
written.

## 4. Renderer

### 4.1 Stores

- `navStore` — section, open trip, trip tab; open and back; persisted
  through `settings:set`. Opening a trip selects it.
- `companionStore` — `day: string | null`, `editing: boolean`, `focus:
  'object' | 'day' | 'photo'`. Cleared when the open trip changes.
- `photoStore` gains `tripPhotos` from `photos:forTrip`.

### 4.2 Left panel — `features/library/`

| Component | From the mock-up |
| --- | --- |
| `SectionRail.tsx` | the rail |
| `LeftPanel.tsx` | switches on the section |
| `TripList.tsx` | view 1, left |
| `TripPage.tsx`, `PlanTab.tsx`, `DayCard.tsx`, `ObjectsTab.tsx`, `PhotosTab.tsx` | views 2 to 9, left |
| `SectionList.tsx` | Routes, Tracks, Waypoints, Imported |
| `PhotosSection.tsx` | view 10, left |
| `libraryMenus.ts` | the context menus, extracted from `LibraryPanel.tsx` so every list builds them the same way |

As built (task 4):

- `LibraryPanel.tsx` became `LibraryList.tsx` (`git mv`): the same selection,
  keyboard, drag, rename and context menus, drawn from a root it is given.
  `libraryRoots.ts` builds the roots: the trip list (grouped by
  `tripGroups`, folders after), a trip's contents, and each cross-trip view.
  The context menus stayed in `LibraryList` rather than moving to
  `libraryMenus.ts`: with one component drawing every list, they are already
  built the same way everywhere.
- `TreeRow.tsx` stays, with two-line trip rows and group headings. The main
  process still builds the tree; the renderer picks the part each list shows,
  so `library:tree` is unchanged and the My Collection root is simply not
  drawn.
- The header is one row: search, Import, Library options (sort, objects sort,
  Archived) and More (new trip or folder, import, export, link a folder). A new
  trip or folder is asked for through `navStore.ask`, which the mounted list
  takes once and names in place.
- A trip's page header has Back, the name (click to select the trip, double
  click to rename), its dates, and its actions; More adds New Route, New
  Straight-Line Route and New Waypoint, which empty space on the page offers
  too. Dragging onto Back opens the list for a drop onto another trip.
- Group headings accept a dropped trip or folder as "move to the top level".
- Context menus are drawn into the document body above the map: a menu opened
  near the panel's edge extends over the map, whose panes covered it.
- Expansion of headings, folders and days still uses the persisted
  `expandedNodeIds`; it is not removed as §3.3 first said.

### 4.3 Right panel — `features/companion/`

`CompanionPanel.tsx` chooses what to show:

| Focus | Shows | View |
| --- | --- | --- |
| no trip open | `YearView` | 1 |
| trip, nothing narrower | `TripView` (the calendar's week, and month as a toggle) | 2 |
| day | `DayView` (`HourScale`) | 3 |
| object: stop waypoint | `StopCard` + `DayView` + photos here + nearby | 4 |
| object: route that is a leg | `DriveCard` + `DayView` + along the way | 6 |
| object: route not in the plan, waypoint, folder | its card, and its day when it has one | — |
| object: track | `TrackCard` + its day's Recorded lane, or "no timestamps" | 8 |
| photo | `PhotoMoment` + `DayView` | 7, 10 |
| undated trip | `UndatedPrompt` | 9 |

With `editing`, the panel shows the editor instead: `RouteProperties`,
`TrackProperties`, `WaypointProperties`, the trip and folder fields, or the
stop editor (§5.3). Back returns to the card.

As built (task 6):

- `companionView.ts` chooses the view from the selection, the open trip, the
  editing flag and whether the itinerary store has answered for the trip. A
  trip whose plan has not answered shows "Loading…" rather than guessing
  dated or undated. (A trip still selected after Back gave way to the year;
  task 7 replaced that rule, see §4.7.)
- `companionStore.editing` stays on while the selection moves between
  objects, so editing several in turn takes one press of the pencil. It goes
  off when nothing is selected or another trip opens.
- `YearView` marks each trip from its start to its end, or only its start
  when the end is unknown (`shared/library/yearMarks.ts`). Its today and
  tomorrow cards read the first stop and leaving time from the overview,
  which gained `startPlace`, `startTime` and `driveSeconds` for it.
- `TripView` draws the days on one window of hours (`tripHours`, the widest
  of the days' own ranges), with drives, stays, the Recorded lane as a thin
  bar and photo times as dots. Days and Month are a toggle. Places along the
  trip opens the drawer below the map; Save to a calendar writes the `.ics`
  file as the editor's button does.
- The drawer's week grid, day list, Earlier and Later, and Go to start are
  not carried over: a trip's days are all shown at once, which is what the
  week was used for. The drawer's day view becomes the day view of task 19.
- `UndatedPrompt` is built here rather than in task 19, because Plan by date
  left the trip properties with it.

### 4.4 The map

Unchanged, except: the open trip is what `geometryStore` shows (opening a trip
selects it, so this already holds), and the selected day draws its drives in
the selection colour.

### 4.5 The trip page, as built (task 5)

- `TripPage.tsx` holds the header (moved from `LeftPanel`) and the Plan,
  Objects and Photos tabs. Plan and Objects are `LibraryList`s over roots
  from `planRoot` and `objectsRoot`, so selection, multi-selection, keyboard,
  drag and menus are the shared ones.
- `planRoot` reads the itinerary view, the trip's geometry and its photos in
  the renderer and builds the days with `dayCards`, so recorded tracks land on
  their day and each day says its driving and its photos. An undated trip's
  Plan lists its objects flat under a "No plan yet" note whose button selects
  the trip, where the start date is set.
- The trip's geometry now reloads on every library change (it fed only the
  map before), because the tabs read the objects' names from it.
- The Photos tab lists the linked folders (from the tree's trip node), then
  the trip's photos by the wall-clock day they were taken, fetched with
  `photos:forTrip`. Thumbnails are requested only when a cell scrolls into
  view. The tab is not virtualised: a trip's photos are hundreds, not the
  library's tens of thousands, which is the Photos section's case (task 29).
- Linking a folder opens its trip on the Photos tab, where the new folder is.

### 4.6 As drawn (Requirement 10)

The tree rows of tasks 4 and 5 are close to the mock-ups in structure but not
in look: emoji glyphs, day groups drawn as expandable rows rather than cards,
and the search field where the section's title should be. Task 20 closes the
gap: `TreeRow` takes a lucide icon per kind (the `Route`, `Activity`,
`MapPin`, `Folder` and `Camera` line icons the mock-ups use), a day group
draws as a card with its heading on a band, and the Trips header becomes the
title, count, options and add, with search beneath. The companion is built to
the mock-ups from the start (tasks 6, 9, 10 and 19).

### 4.7 The trip list flow (Requirement 2.4, 2.6, 2.7)

Owner feedback on 13 November 2026: a click on a trip brought up its routes,
which was right, but swapped the list for the trip page, which ruined the
flow of looking through trips. Drawn in
`docs/design/library-panel/trip-list-flow/` and approved before building.

- **Selecting is not opening.** `LibraryList` no longer calls
  `navStore.openTrip` on a click. The click selects the trip, and selection
  already loads it on the map (`selectionStore.ensureGeometry`) and its plan
  in `itineraryStore`.
- **The companion follows the selection.** `companionView` lost its `section`
  input and the rule that showed the year with something still selected back
  at the list. A selected trip shows by the hour whether or not it is open;
  with nothing selected, the open trip shows; with neither, the year.
  `OpenTripButton` sits beside the pencil in `TripView` and `UndatedPrompt`
  while the trip is only selected.
- **Trips open in place.** `tripListRoot` keeps each trip's children, the
  same nodes the trip used to have in the Phase 1 tree, so the chevron, → and
  ← open it, and what is inside selects, drags and has its context menu as it
  does anywhere else.
- **Opening is its own step.** `TreeRow` takes an optional `onOpen`; given,
  a double-click opens rather than expands, and the selected row shows an
  arrow, labelled "Open {trip}". Return on a trip row opens it.
- **Back is where you were.** `navStore.backToList` closes the page and
  selects the trip that was open. Expanded rows were already kept in
  `libraryStore.expanded`; `LibraryList` now records its scroll position per
  root on scroll and restores it on mount, because the list unmounts while a
  trip page is open. `closeTrip` stays for the cases that should not select,
  a deleted trip and a new one being named.
- **The year is one gesture away.** Since Back leaves a trip selected,
  Escape on a single selection now clears it (a batch still collapses to its
  anchor), and a click on the list's empty space does the same. Either brings
  the year back on the right.

### 4.8 Details on the right (Requirement 4.2, 4.4, 4.5, 5, 11)

The companion stops repeating the left panel. What it shows is decided by
`companionView` as before; three of its views change.

- **A trip** (`TripDetails`, replacing the hour grid of `TripView`): when it
  leaves (`itinerary.update` start date and time), one line saying whether
  every day fits the daily limit and whether the fuel lasts (from the
  timeline's day totals and `rangeCheck`), the driving rules as fields (limit,
  vehicle, range, reserve, later days' leaving time), and Places along the
  trip and Save to a calendar. The heading is "This trip", not its name. ⋯
  holds Description and notes (a small dialog over the trip's two text
  fields), Remove the plan and Delete trip. An undated trip keeps
  `UndatedPrompt`.
- **A stop** (`StopDetails`): shown when the selection is a waypoint that is a
  stop in the plan of the trip it belongs to. The stay is the field (hours
  and minutes, or days and the leaving time for a day-stay). While it is
  being changed, a line says what would move: the next stop's arrival and
  whether later days change, from `computeTimeline` run in the renderer on
  the edited stops. Notes for the stop, photos taken within a kilometre (the
  trip's photos already in `photoStore`), and nearby places. ⋯ holds Edit the
  place, which opens today's waypoint editor.
- **A drive** (`DriveDetails`): shown when the selection is the route of a
  leg. How is a field: follow a route (`linkLeg`), by road or other transport
  (`setLegMode`). Distance, height and road mix come from the route as the
  route card has them; places on the way open the drawer's POI panel for the
  leg. ⋯ holds Edit the route.
- **No pencil for these three.** Their fields save on change, one undo step
  each, through the commands the itinerary editor already uses. Routes,
  tracks, waypoints and folders outside a plan keep the pencil and today's
  editors (Requirement 5.1).

As built (task 9):

- The consequence line is not a second run of `computeTimeline`. The zone
  resolver is the main process's, so the renderer works from the timeline it
  already has: a longer stay pushes later times back until a night's stay,
  whose leaving time is fixed, takes it up on the same date
  (`shared/itinerary/consequence.ts`).
- The trip's check line covers the daily driving limit. Whether the fuel
  lasts needs the fuel stations along the way, which Places along the trip
  already finds; it is not repeated here.
- Nearby places for a stop are task 19's, with the day cards that place
  them. The stop shows how many photos were taken within a kilometre.
- Until task 10 puts the plan's structure on the left, the trip's ⋯ keeps
  Edit the Plan, which opens the itinerary editor. An undated trip's prompt
  keeps its pencil for the same reason.

### 4.9 Structure on the left (Requirement 11)

The Plan tab of a dated trip stops being a tree. `PlanCards` draws the days
as the drawings do, from `dayCards`:

- Rows are buttons that select their object. A stop row is draggable
  (`application/x-trailrt-stop`) and has × to remove it from the plan
  (`removeStop`); a drop between rows or on a card moves it (`moveStop` to
  the index the drop names). Alt-↑ and Alt-↓ move a selected stop by one, so
  reordering does not need a pointer.
- Each card ends in Add. It opens `AddSearch` in place, which queries the
  trip's waypoints and routes, items outside a trip, other trips' routes,
  tracks and waypoints, offline places and postcodes (`search:query`), and
  points of interest along the leg it would interrupt. The highlighted result
  is the candidate; `addStore` holds it, and the companion shows
  `CandidateDetails`: for a place or waypoint, how far it is from the stops
  either side; for a route, whether its ends match, and its distance and
  time at the planning speed. Distances are straight-line until the leg is
  planned, and labelled so.
- Not in the plan lists the trip's routes, tracks and waypoints that are on
  no day; its rows drag onto a card.
- The trip's name in the page header is renamed in place by double-click or
  Return.
- The tree's context menus stay on the Objects tab, which keeps the tree.

As built (task 10):

- A new stop goes after the selected stop when it is that day's, otherwise
  at the end of the day (`shared/itinerary/planEdit.ts`). A plan with no
  stops shows its first day to add to.
- Add's search covers the trip's waypoints and the offline places and
  postcodes. Items outside a trip and in other trips join it in task 11,
  with moving or copying. Points of interest along the way are added from
  Places along the trip, which already lists them with their detours, rather
  than repeated in the search.
- A drive with no route has nothing to select. Clicking it selects its trip,
  so the plan stays loaded on the map, and focuses the drive in `planStore`;
  the companion shows the focused drive first.
- The itinerary editor is no longer reached from the trip. Everything it did
  is in place: the leaving time and driving rules in the trip's details;
  adding, reordering and removing stops on the left; the stay, arrive by,
  leave at and notes in a stop's details; how a leg is travelled in a
  drive's; Plan the drives by road in the trip's details.

## 5. Behaviour

### 5.1 Selection everywhere

A click in the left panel, on the map, in the hour scale or in the photo grid
selects the same thing everywhere: one highlight in the place it was clicked,
the ring on the map, the companion's focus.

### 5.2 Retiring the calendar drawer

| Drawer feature | Moves to |
| --- | --- |
| Week time grid | `TripView` |
| Day view | `DayView` |
| Month grid | `TripView`, as a toggle |
| Drag to change a stay (`snapDuration`) | `DayView` and `TripView` |
| Unknown-time list | under the scale, as now |
| Export to a calendar file | `TripView` action |

`uiStore.planDrawer`'s `calendar` kind and `CalendarPanel.tsx` are deleted when
every row above is done and tested.

### 5.3 The stop editor

One form for a stop: the itinerary stop's arrive by, stay, leave and notes,
and its waypoint's name, position and symbol. A timing change is previewed by
running `computeTimeline` on the edited stop list in the renderer (it is pure)
and drawing the next stops as they would be. Done sends the itinerary update
and the waypoint update as one batch, one undo step (`compose.batch`, as
Phase 10's `withPlanning` does).

### 5.4 Items outside a trip (Requirement 9, ADR 0022)

- **Data.** `trips.role` (`'trip' | 'loose'`), one holder at most, made on
  first use by `tripService.looseTripId(db)`. `listTrips`, `searchTrips`, the
  overview and the tree's Trips view skip it. The tree's view branches name a
  row's trip "Not in a trip" when it is the holder, and sort those rows first.
- **Sections.** Each section's header gains its own add menu: New Route and
  Import in Routes, Import in Tracks, New Waypoint and Import in Waypoints,
  Link a folder in Photos. Each targets the holder. `actions.startDrawingRoute`
  and `startPlacingWaypoint` take the trip to draw into, rather than reading
  the selection, so the section can name the holder.
- **Selection.** Selecting an item outside a trip selects it as now; its
  trip, the holder, loads on the map. `navStore.openTrip` is never called for
  the holder, so the section stays where it was.
- **Moving.** The Move to Trip lists gain "Not in a trip" first; moving to it
  moves to the holder with the existing commands.
- **Import.** `importService` takes the destination it is given. The left
  panel passes the open trip on a trip page, the holder in a section, and
  nothing from the trip list (a new trip named after the file, as now).
- **Guards.** `trips:update`, `trips:delete`, `trips:duplicate`, archiving and
  the itinerary channels refuse the holder with `VALIDATION`, so no route to
  it exists even through a stale id.

As built (task 8):

- Migration 0007 adds `trips.role` with a check and a partial unique index.
  `tripRepo.insertTrip` writes the column only for the holder, so the
  column's default covers every other trip and the upgrade tests can still
  write a pre-0007 trip. Those tests now insert their old rows with plain SQL,
  as an old build would.
- `tripService.looseTripId` makes the holder on first use; `trips:loose` hands
  its id to the renderer, which keeps it in `libraryStore.looseTripId` to
  name rows and the companion card "Not in a trip". Guards refuse renaming,
  deleting, duplicating, archiving, foldering and planning it.
- New routes and waypoints go where the user is (`actions.destinationTripId`):
  the open trip, or the selected item's trip, in the Trips section; outside
  any trip in a cross-trip section. The header's add menu offers New Route,
  New Waypoint or Link a Folder by section. Import defaults its Destination
  the same way, with "Not in a trip" as a choice.
- An item moves in or out from its own menu's Move to list, through the
  batch move, so each move is one undo step. Drag between a section and a
  trip is not built (Requirement 9.5).
- A full export and a JSON collection include the holder's items. The
  collection carries the holder as a trip named "Not in a trip", so
  importing it back makes an ordinary trip of that name: recorded rather
  than changing the collection format.

### 5.5 Things made outside a plan (Requirement 12)

- **Three places.** Outside any trip is ADR 0022's holder (task 8). In a trip
  but not in its plan is `dayCards`' `notInPlan`. In the plan is a stop, a
  leg's route, or a track placed by its own times.
- **One undo step per addition.** Two new commands, each a single undo entry:
  `itinerary:addPlaceStop` (a waypoint made from a place or postcode, then a
  stop) and `itinerary:addRouteLeg` (a route brought into the trip by moving
  or copying it if it is elsewhere, then linked as the leg, or with its ends
  added as stops). Adding a waypoint uses `addStop`, after moving or copying
  it into the trip in the same command.
- **Matching.** A route's ends match when each is within 1 km of the stop
  beside it (`shared/itinerary/routeFit.ts`, pure, with the 1 km as a named
  constant). The leg already records `fits` for a linked route; the same
  function decides it.
- **Ends that do not match.** The drawing offered "join it by road" as a
  second choice. A leg runs between two stops, so there is nothing to join a
  route to except new stops at its ends. TrailRT therefore offers one thing:
  add its ends as stops, named from the nearest offline place or "Start of"
  and "End of" the route, each joined by road to the stop beside it.
- **Tracks** are never stops. A track in the trip with times is placed by
  `dayCards` already; adding one from elsewhere moves or copies it into the
  trip. One with no times says it cannot be placed on a day, and nothing is
  invented for it. The drawing's "say how long it took" is not built.
- **Move or copy.** From another trip, a dialog asks, with Copy first.
- **Out of the plan.** Taking a route out sets its leg back to by road; the
  route stays in the trip.

As built (task 11):

- The 1 km rule is `ROUTE_FIT_M` in `shared/itinerary/routeFit.ts`, and the
  itinerary's own check of a linked leg uses the same function, so a route
  offered as joining two stops is never then refused for timing.
- Ends added as stops are named "Start of" and "End of" the route. Naming
  them from the nearest offline place would need the place search in the
  service; it is left as a later refinement.
- A track from another trip is moved, not copied: copying a recorded track's
  points and times is not built, and the panel says so.
- `trips:loose`, `routes.listAll`, `waypoints.listAll` and `tracks.listAll`
  feed Add's search; a route's ends are fetched only when it is highlighted.

### 5.6 Less strict, and quicker to start (Requirement 13)

- **Right-click.** `LibraryList`'s menu for its own space switches on the
  list's root: each section offers what it makes, a trip's page a route or
  waypoint, the trip list a trip or folder. The map listens for
  `contextmenu` on its ground; a click that lands on a route, track or
  waypoint (`.leaflet-interactive`, a marker) belongs to that layer's menu.
  Nothing is offered while a drawing tool is active.
- **A stop without a waypoint.** `itinerary_stops.waypoint_id` becomes
  nullable, with `point_lat`, `point_lon` and `point_name` for a stop that is
  only a point (migration 0008 rebuilds the table, as SQLite cannot drop
  `NOT NULL` in place; a check keeps one of the two). `StopView.place` is
  read from whichever is set, so the timeline, planning, day cards and the
  companion need no second path; places that list waypoints skip a point.
  A point stop is selected through `planStore`'s focus, as a drive without
  a route is, since it has no object of its own.
- **Any route goes in.** `addRouteLeg` with `ends: 'auto'` (now the default)
  joins each end to the stop beside it when within `ROUTE_FIT_M`, and
  otherwise makes a point stop at that end, named "Start of" or "End of" the
  route, joined by road to its neighbour. An empty plan takes a route as its
  first item.
- **Join two.** `routes:join` takes two references, a route or a waypoint
  each. The new route runs from the first's end (a route's last point, a
  waypoint's place) to the second's start, in the trip they share, or the
  first one's. By road it is routed and saved as `planLeg` does; without
  routing it is refused with the reason, and Join with a Straight Line makes
  a two-point line instead.
- **Dropping files.** Import's default destination is already the open trip
  (task 8), so files dropped while a trip's page is open go into it.

### 5.7 Routes and waypoints in any order (Requirement 14)

- **An entry is a stop or a route.** Migration 0009 rebuilds
  `itinerary_stops` again, adding `entry_kind` (`stop`, `route`) and
  `entry_route_id`, with one check covering both kinds. A route entry has no
  waypoint and no point. The table keeps its name; "stop" in the code now
  means an entry.
- **Where an entry is.** `stopPlace` is where it is reached (a route's
  start) and `stopPlaceOut` where it is left (a route's end). Legs, planning
  and the companion read the previous entry's place out and this entry's
  place in, so a gap after a route is measured from its end.
- **Joined.** An entry within `ROUTE_FIT_M` of where the one before ends is
  `joined`: no leg, no plan issue, and a zero-time leg in the timeline
  (`TimelineLeg.joined`). Anything else is a by-road gap, planned by
  `autoPlanService` as between two stops.
- **The timeline.** `TimelineStopInput.drive` makes an entry a drive:
  reached at the arrival the leg gives, left after the route's driving time,
  with no stay. A plan that begins with a route sets off along it at the
  start time. `buildDays` counts a drive's time and length on the day it
  starts, so the daily limit sees it.
- **Day cards.** A route entry is one row of kind `drive`, its times start
  to end, selecting the route; its details say what joins it either side and
  offer Take Out of the Plan. A day card accepts a drop anywhere on it, at
  the end of the day, so an empty plan can be filled by dragging.
- **Points.** Point stops from task 13 are no longer made. Those already
  made still read and show, and can be taken out.

### 5.8 Adding and removing days (Requirement 15)

- **A day break is an entry.** Migration 0010 widens `entry_kind` to `day`
  (a rebuild, as the CHECK changes). It has no place and takes no time; the
  timeline starts the next calendar day there, after the day the entry
  before it is left, at its own `depart_time` or the plan's usual one. Legs,
  joins and planning skip it to the entry before.
- **Which day an entry is on** is `entryDays` (`shared/itinerary/planEdit.ts`):
  its own date when its time is known, otherwise the day it follows in the
  plan. Without it, an entry after a drive not yet planned would sit apart
  under Unknown times and could not be removed with its day. The day cards
  use the same rule, so what a card shows is what removing it takes.
- **Add a Day** puts a break after the day's last entry, or at the end;
  what followed moves on a day. **Remove This Day** removes the day's
  entries and its break as one batch; removing the first day also moves the
  plan's start date and time to the next day's, so later days keep their
  dates. A day that only a night's stay runs into has no break of its own;
  removing it removes its entries.

### 5.9 Right-click in the plan, and reordering within a day (Requirement 16)

- **Deleting from the plan** is `poiTripService.deleteItem`: the entries that
  use the route or waypoint are removed, a leg that used the route is
  unlinked, and the item deleted, in one batch. Deleting it elsewhere, from a
  section, still leaves a plan entry showing it as deleted, as Phase 10 did;
  the plan's own menu is the way to delete both.
- **Menus.** A plan entry offers Take Out of the Plan and Delete; an item
  under Not in the plan offers Add to the End of the Plan, Move Out of the
  Trip (to Not in a trip, through the batch move) and Delete. A track's
  delete goes through the same confirmation as the lists', since it cannot
  be undone.
- **Dropping on an entry takes its place.** A drag's data cannot be read
  until the drop, so the dragged entry's index is kept while it moves; a
  drop on an entry below lands after it, on one above lands before it. Other
  drops keep the upper and lower halves.

### 5.10 Region builds that can be tried again (Requirement 17)

- **What happened.** A three-county build from the development checkout was
  killed partway through reading roads. macOS's crash reports (type 309,
  `~/Library/Logs/DiagnosticReports/valhalla_build_tiles-*.ips`) say SIGKILL,
  "Code Signature Invalid", namespace CODESIGNING, "Invalid Page", in
  `lua_pcall` under `PBFGraphParser::ParseWays`. LuaJIT writes machine code
  into ordinary pages; under the hardened runtime that needs
  `allow-unsigned-executable-memory` (ADR 0013). The packaged app signs the
  tools with it; the copy in `resources/valhalla/bin` had been re-signed with
  the hardened runtime and without it. A small region can finish before
  LuaJIT compiles a trace, which is why single counties had built.
- **The fix.** `bundle-valhalla.sh` signs the two tools exactly as
  `build/sign-mac.cjs` does, and `toolSigning.test.ts` reads their
  entitlements on every `npm test`, as `verify:package` already does for
  the app.
- **Downloading and building apart.** Downloads go to `.part` and are
  renamed only when whole, so a file under its final name is complete.
  `cachedExtract` reuses one for 30 days; `pruneDownloads` removes older
  ones and leftover `.part` files when a job starts. The merged file is
  still removed after each build, as it is remade in seconds. The picker's
  progress says "Using the downloaded …" for a reused file.
- **The log.** `build.log`, beside the graph, holds the builder's whole
  output, its command, the time, the machine's free memory at start and
  end, the last stage reached and how it ended. A failure's message names
  it. A SIGTERM, which TrailRT never sends to a build that was not
  cancelled, is said to have come from outside.

### 5.11 Routes that look movable, and photos as waypoints (Requirement 18)

- **Why shaping was hard to find.** Leaflet gives every interactive layer the
  same pointing hand, so the selected route's shaping line
  (`useRouteShaping`'s 16 px hit area), its handles and an unselected route
  all looked alike, and nothing said the line could be dragged. The hit line
  is SVG in its own pane (`interactivePane`), so it can take a class and
  CSS: `.trailrt-shaping-hit` has `cursor: grab` and, on hover, a faint
  stroke in the route's colour. A line drag adds `trailrt-shaping-drag` to
  the map container until release or Escape, which makes the pointer
  `grabbing` everywhere, since the pointer leaves the line as it drags.
  Draggable markers carry Leaflet's `leaflet-marker-draggable`, which takes
  `grab`; Leaflet already gives `grabbing` to a marker being dragged. The
  routes themselves are drawn on canvas and keep the pointing hand: a click
  there selects.
- **A photo's waypoint.** `photoWaypointFields(photo)` in
  `shared/photos/photoWaypoint.ts` is pure: null without a location;
  otherwise the file's name without its extension, the location, the
  altitude or null, the `photo` symbol, and a description naming the file
  and when it was taken. The photo's link is not kept in the waypoint's
  `metadata`, because that column is imported passenger data the Garmin
  phase writes back out.
- **Where it goes, and once.** `waypoints:fromPhoto { photoId, tripId? }`:
  the renderer passes the open trip; without one the photo's folder's trip is
  used, which is the holder for a folder outside a trip. A waypoint in that
  trip with source `photo`, the same name and the same coordinates is the
  one this photo made, and is returned with no new undo step.
- **Into the plan.** Not by dragging: the Photos and Plan tabs of the trip
  page are never on screen together, so there is nothing to drop on. Add to
  the Plan sits beside Use as a Waypoint when a trip with a dated plan is
  open. `photoStopIndex` in `shared/itinerary/planEdit.ts` puts it after the
  last entry of the day it was taken, by `entryDays`, or at the end when the
  plan has no such day or the photo no date. `itinerary:addPhotoStop
  { tripId, photoId, index }` makes or reuses the waypoint and adds the stop
  in one batch, then plans the legs.

### 5.12 Waypoints off the map from the left panel (Requirement 19)

`WaypointsOnMap` in `LeftPanel.tsx` sits in the header row beside Import. It
reads and writes `settings.layerVisibility.waypoints`, the setting the
Layers menu already uses, so there is one source of truth and nothing new to
persist; `MapView` already passes no waypoints to the layer when it is off.
The button keeps one label, "Hide waypoints on the map", with `aria-pressed`
true while they are hidden, the accent outline, and a crossed-out pin.

### 5.13 Search by pattern, across routes too (Requirement 20)

**One compiler, in `shared/search/namePattern.ts`.** `compileNamePattern(text)`
trims the text and returns `{ ok: true, regex }` or `{ ok: false, message }`,
where the message is the engine's own, without its `Invalid regular
expression: /…/i:` prefix. The flag is `i` alone. `u` would reject escapes
people type out of habit, such as `\-` and `\ `, and without it `i` still
folds accented Latin letters. Both processes use it: the renderer to explain
a bad pattern without a round trip, and the request schemas to refuse one.

**Matching in SQLite, with a JavaScript engine.** `createDatabase` registers
a deterministic `regexp(pattern, value)` function on the connection, which is
what SQLite's `X REGEXP Y` calls. It compiles through `compileNamePattern` and
keeps the last pattern compiled, because one query tests it against every row.
The three repositories change `lower(name) LIKE …` to `name REGEXP ?`, so
ordering, the join to the trip's name and the trip counts stay in SQL. The
`LIKE` escaping goes, since a pattern's `%` and `_` are already literal.

**Routes.** `routes:search` mirrors `waypoints:search`: `searchRoutes`
returns `RouteWithTrip`, through `routeService.search`, its handler, the
preload and `ApiSurface`. `tripSearchRequest`, `waypointSearchRequest` and
the new `routeSearchRequest` share one `nameSearchRequest`, which refines the
query with `compileNamePattern`.

**The renderer.** `libraryStore.setSearch` compiles first. A bad pattern sets
`searchError` and clears all three result lists before any request, so stale
results are never shown under a new pattern; a good one runs the three
searches in parallel behind the existing sequence guard. `SearchResults`
shows the error in place of the count. Otherwise it shows trips, then routes,
then waypoints, each with its line icon (Map, Route, MapPin) rather than an
emoji (Requirement 10.3). An item outside a trip names its trip "Not in a
trip" and, as a waypoint already did, opens its section instead of a trip
page. The field reads "Search names (pattern)", and its hint gives the
examples.

**A pattern cannot be interrupted.** V8 has no time limit on a match, and a
pattern such as `(a+)+$` can backtrack for seconds against a long run of one
letter. The text is the user's own and names are at most 200 characters, so
this is accepted rather than defended against; it is written down so it is
not rediscovered as a bug.

### 5.15 Search the list that is open (Requirement 20.5–20.7)

**Narrowed in the renderer.** Every list in the left panel is drawn from a
`TreeNode` root the renderer already holds, so a search here needs no request.
`filterTree(root, regex)` in `libraryRoots.ts` returns the same root holding
only matches and the rows that lead to them, with the ids of those rows to
open and a count of matched objects. A row whose own name matches keeps all
it holds, closed; a row kept for a match inside it is opened. The root keeps
its id, so the list keeps its behaviour (the trip list's flow, drag, menus).
Tracks become searchable this way, though task 21 gave them no channel.

**`LibraryList` takes `openIds`.** A row is open when the user opened it or
the search opened it. The search's set is not written into the user's own
expansion state, so clearing the search leaves the tree as it was.

**Where it applies.** `LeftPanel` compiles the text with `compileNamePattern`
and narrows its `root`. On a trip's page, `TripPage` takes the pattern and
shows that trip's objects root narrowed, whichever tab was open, because day
cards and photos are not rows; the tabs return when the search is cleared.

**The switch.** `libraryStore.searchScope` is `here` or `everywhere`, shown
as a two-way switch under the field while there is text ("In Routes", "In
this trip", "Everywhere"). Only `everywhere` sends the three `*:search`
requests of §5.13, and shows `SearchResults`. Clearing the text resets the
scope to `here`. An empty narrowed list says "Nothing in Routes matches." with
a Search everywhere button. A bad pattern is explained by one `SearchProblem`
in either scope.

### 5.16 Tracks by name or by date (Requirement 22)

**Built in the main process, arranged by a pure function.** The Tracks view
is part of `libraryService.tree`, so the arrangement travels in the tree
request (`trackArrangement`, `trackSortDirection`, both persisted settings)
and `arrangeTracks` in `shared/library/trackGroups.ts` builds the rows. Name
and Distance stay flat, items outside a trip first (ADR 0022); the Library
options' "Sort objects by" becomes "Sort routes by".

**Dating a track.** `startedAt` is the first timed point. The zone is
`resolveTimeZone` at the track's first point, which `tracks.startPoint` reads
through the `(track_id, segment_index, seq)` index, and only in the Date
arrangement. An unknown zone falls back to `systemZone()` and the row's hint
says so, as a stop's times do. A track with no times goes under No date.

**The tree.** Year, month and day are `group` rows with stable ids
(`view:tracks/year:2026/month:05/day:16`), so expansion survives a refresh, a
count as detail, and the direction applies at every level. The first year,
its first month and that month's days carry `defaultExpanded`, which
`offerExpansion` honours once. A track's row reads its local start time and
its trip.

### 5.17 Dates from names, and tracks on the map (Requirements 22.7, 23)

**Dates from names.** `dateFromName` in `shared/library/nameDate.ts` tries
readers in order: year first, a named month after the day, a named month
before it, then all-number dates day first with month first only when day
first is impossible, then `yyyymmdd`. Each reader refuses a day the calendar
does not have; a digit next to a match blocks it, so "Track 123456" and "Lap
12-14" are not dates. `arrangeTracks` uses it only for a track with no
`startedAt`, puts it under that day after the recorded tracks, and gives the
row "date from name" and a hint naming the text read. Nothing is written.

**The arrow.** `TreeRow` takes `onShow` and `showLabel`, drawn like the trip
list's open arrow but visible on hover and focus as well as when selected,
because a heading cannot be selected. `LibraryList` gives it to every row in
the Tracks section that holds a track, collecting the ids beneath it; group
rows carry `fullName` ("May 2026") for the label and the map.

**On the map.** `mapFocusStore` holds the label, the tracks' metadata from
`tracks:listAll` and their box from the new `tracks:bounds`, a min/max
aggregate over `track_points` like a trip's. `MapView` draws them beside the
trip's tracks, de-duplicated, fits once per request, and shows a strip at the
top right with Clear. Nothing is persisted.

### 5.14 Move to any trip from the right-click menu (Requirement 21)

`TripPickerDialog` in `features/library/` takes the destinations, a title and
`onPick`. It is a `Dialog` with a filter field and a `listbox` of `option`s
underneath, which scrolls on its own so the filter stays in view. The filter
goes through `compileNamePattern`, so one syntax works in both places, and a
bad pattern says why rather than emptying the list without explanation. The
highlighted option follows the arrow keys and the pointer, Return picks it,
and Escape is the dialog's own cancel.

`LibraryList` keeps `movePicker: BatchMember[] | null`. The single-item
`moveTo` and the multi-selection menu both become one Move to Trip… item that
sets it, so the eight- and nine-trip caps and the inline "→ trip" rows go,
and so does the multi-selection header that moved to the first trip when
clicked. Picking calls `moveBatchToTrip`, unchanged, so a move is still one
undo step. The list is `moveDestinations(overview, looseTripId)` as before.
It is not virtualised: a long list here is hundreds of trips, not the
photos' tens of thousands.

## 6. Risks

- **Scope.** The largest UI change since Phase 1. Mitigated by the order of
  tasks: data and pure layout first, then the left panel, then the companion,
  each verified before the next.
- **Lost behaviour.** Requirement 8.3 makes the old tree's behaviours a
  checklist (task 30).
- **Performance.** The Photos section and tab are virtualised; thumbnails are
  made only for visible cells.

## 7. Tests

- Unit: `dayScale`, `tripGroups`, `dayCards`, the moved `calendarLayout`
  (its existing tests move with it), the two channels.
- End-to-end: helpers first; then every spec that touched the tree; a new
  `library.spec.ts` for the rail, the trip list, the trip page and the
  companion's views; `photos.spec.ts` moves to the Photos tab and section.
