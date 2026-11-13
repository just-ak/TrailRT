# Phase 14: The library and the day companion — design

Written 12 November 2026 against the code at commit `3c30338` (Phase 11
tasks 1 to 11). Amended 13 November 2026 with the owner's feedback on tasks 4
and 5: items outside a trip (§5.4) and building to the drawings (§4.6). The mock-ups are `docs/design/library-panel/option-e/`; this
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
  dated or undated. A trip still selected after Back gives way to the year.
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
  week was used for. The drawer's day view becomes the day view of task 8.
- `UndatedPrompt` is built here rather than in task 8, because Plan by date
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
  library's tens of thousands, which is the Photos section's case (task 9).
- Linking a folder opens its trip on the Photos tab, where the new folder is.

### 4.6 As drawn (Requirement 10)

The tree rows of tasks 4 and 5 are close to the mock-ups in structure but not
in look: emoji glyphs, day groups drawn as expandable rows rather than cards,
and the search field where the section's title should be. Task 10 closes the
gap: `TreeRow` takes a lucide icon per kind (the `Route`, `Activity`,
`MapPin`, `Folder` and `Camera` line icons the mock-ups use), a day group
draws as a card with its heading on a band, and the Trips header becomes the
title, count, options and add, with search beneath. The companion is built to
the mock-ups from the start (tasks 6 to 9).

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

## 6. Risks

- **Scope.** The largest UI change since Phase 1. Mitigated by the order of
  tasks: data and pure layout first, then the left panel, then the companion,
  each verified before the next.
- **Lost behaviour.** Requirement 8.3 makes the old tree's behaviours a
  checklist (task 10).
- **Performance.** The Photos section and tab are virtualised; thumbnails are
  made only for visible cells.

## 7. Tests

- Unit: `dayScale`, `tripGroups`, `dayCards`, the moved `calendarLayout`
  (its existing tests move with it), the two channels.
- End-to-end: helpers first; then every spec that touched the tree; a new
  `library.spec.ts` for the rail, the trip list, the trip page and the
  companion's views; `photos.spec.ts` moves to the Photos tab and section.
