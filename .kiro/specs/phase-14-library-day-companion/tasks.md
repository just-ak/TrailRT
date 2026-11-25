# Phase 14: The library and the day companion — tasks

Built ahead of Phase 11's tasks 12 and 13 at the owner's request; those finish
after task 36 here, against the new panels.

- [x] 1. Spec, ADR 0021 and the out-of-order build
  - `requirements.md`, `design.md` and this file; ADR 0021; the spec index and
    decision index in `.kiro/specs/README.md`; Phase 14 on the progress mindmap
  - Done: written 12 November 2026 from the owner's choice of Option E in the
    design review (`docs/design/library-panel/`)
  - _Requirements: all, as the plan_

- [x] 2. Pure layout: the day scale, trip groups and day cards
  - Move `calendarLayout.ts` and its tests to `shared/itinerary/`, with a
    re-export at the old path
  - `shared/itinerary/dayScale.ts`: range, Plan lane, Recorded lane, photo
    times (design §3.1)
  - `shared/library/tripGroups.ts` and `shared/itinerary/dayCards.ts`
  - Unit tests: the range is an hour either side on whole hours, within the
    day; an overnight stay runs to the end; an untimed leg is untimed, never
    zero; overlapping tracks take two lanes; a track with no timestamps is not
    placed; a photo with no zone is camera time in the day's zone; trips group
    as Coming up, Ideas and past years, with Today and Tomorrow; day cards
    match the tree's current grouping for the Phase 10 fixtures
  - Done: `calendarLayout.ts` and its tests moved with `git mv` (only the
    calendar drawer imported it, so no re-export was needed);
    `dayScale.test.ts` (11), `dayCards.test.ts` (7, including a check that the
    days group exactly as the tree did), `tripGroups.test.ts` (7); the example
    weekend is shared in `testViews.ts`. A day spent wholly in one place shows
    08:00–18:00 rather than all 24 hours. `npm run verify` passes (1,958 unit,
    154 end-to-end)
  - _Requirements: 4.3, 4.7, 4.9, 2.1, 2.2, 3.2, 8.1_

- [x] 3. Data: trip overview, a trip's photos, navigation settings
  - `trips:overview` and `photos:forTrip` (design §3.2), schemas, preload,
    bridge namespace test
  - Settings `librarySection`, `openTripId`, `tripTab` with schema and defaults
  - Unit tests: counts and dates for dated, undated, archived and empty trips;
    photos of every folder of a trip in taken order; malformed payloads refused
  - Done: `libraryOverview.test.ts` (5) against a real database, including a
    half-planned trip whose end and length stay missing, never zero; the
    trips channel joins the malformed-payload handler test; settings schema
    tests for the three keys. The tree's plan building is shared with the
    overview (`allPlans`). `npm run verify` passes (1,967 unit, 154
    end-to-end)
  - _Requirements: 1.2, 2.1, 2.2, 3.5, 4.1_

- [x] 4. The rail and the left panel's lists
  - `navStore`, `SectionRail`, `LeftPanel`, `TripList`, `SectionList`,
    `libraryMenus.ts`; one header row with search, options and add menus
  - Context menus, rename, drag and the Phase 5 multi-selection and keyboard
    model on every list; the tree and its view branches removed
  - End-to-end helpers first, then the specs that used the tree
  - Unit tests: section and open trip persist; menus built the same for every
    list
  - Done: the rail, the one-row header and the trip list are in; a trip opens
    into a page listing its contents (task 5 adds the tabs). `LibraryPanel`
    became `LibraryList`, drawn from roots built in `libraryRoots.ts`, so
    selection, keyboard, drag, rename and menus are shared by every list.
    `libraryRoots.test.ts` (6) and `navStore.test.ts` (5). The end-to-end
    helpers gained `showTripList`, `openTrip` and `tripAction`; eleven specs
    moved to them, and `app.spec` tests the rail instead of My Collection.
    Found on the way: menus opened near the panel's edge were covered by the
    map, so menus now draw above it. `npm run verify` passes (1,978 unit, 155
    end-to-end). Recorded in design §2 and §4.2
  - _Requirements: 1.1–1.5, 2.1–2.5, 3.6, 8.2_

- [x] 5. The trip page
  - Header, actions and tabs; Plan with day cards and Not in the plan; the
    undated state; Objects with multi-selection and batch actions; Photos by
    day with linked folders; drag onto "‹ Trips" to move
  - Unit tests: tab counts; day cards for one-day, multi-day and undated
    trips
  - Done: `TripPage.tsx` with the header and the Plan, Objects and Photos
    tabs; `planRoot`, `objectsRoot`, `linkedFoldersRoot` and `photosByDay` in
    `libraryRoots.ts`, five more tests there (11 in all). Linking a folder now
    opens its trip on the Photos tab. The undated trip's note says "Choose
    dates…", not a second "Plan by date". `npm run verify` passes (1,983 unit,
    155 end-to-end). Recorded in design §4.5
  - _Requirements: 3.1–3.6_

- [x] 6. The companion, its editors, and the trip's hours
  - `companionStore`, `CompanionPanel` with the pencil to today's editors;
    `YearView`; `TripView` with the days side by side, the month as a toggle,
    Places along the trip and Save to a calendar; `UndatedPrompt`; the
    calendar drawer retired (design §5.2)
  - Unit tests: which view shows for each focus (design §4.3); the year's
    marked days; the trip's hour range
  - Done: `features/companion/` with `CompanionPanel`, `YearView`,
    `TripView`, `UndatedPrompt` and `ObjectCard`; `companionView.test.ts`
    (6), `yearMarks.test.ts` (3), two `tripHours` tests. The overview gained
    the first stop, leaving time and driving for the year's cards. Blocks are
    drawn at their real times (`exactTop`, `exactHeight`), not the drawer's
    45-minute minimum, so a day reads as the mock-up does. The calendar
    drawer and `CalendarPanel.tsx` are gone; its end-to-end tests now drive
    the right panel, and a new one opens a trip from the year. Back at the
    trip list the year shows even with an object still selected (superseded
    by task 7: the companion now follows the selection). Ten specs
    reach the editors through the pencil (`editSelection`) or the trip
    page's More menu. `npm run verify` passes (1,994 unit, 156 end-to-end).
    Recorded in design §4.3
  - _Requirements: 4.1, 4.2, 4.8, 5.1, 6.1, 6.2, 10.4_

- [x] 7. The trip list flow
  - Owner feedback, 13 November 2026: the jump from the list to the trip
    page on every click ruined the flow. Drawn first, in
    `docs/design/library-panel/trip-list-flow/`, and approved
  - Selecting a trip in the list selects it; the list stays. Trips keep their
    contents in the list and open in place. Double-click, Return, the
    selected row's arrow and Open in the companion open the trip page;
    ‹ Trips comes back with the trip selected and the list scrolled where it
    was (design §4.7)
  - Unit tests: the companion follows the selection, not the left panel's
    page; trip rows keep their contents; Back leaves the trip selected
  - Done: `companionView` lost its `section` input and the rule that showed
    the year with something selected; `OpenTripButton` in `TripView` and
    `UndatedPrompt`; `TreeRow` takes `onOpen`; `LibraryList` handles Return
    and remembers its scroll by root; `navStore.backToList`. The end-to-end
    `openTrip` helper double-clicks, and `trip-list.spec.ts` drives the whole
    flow. With Back leaving the trip selected, Escape on a single selection
    and a click on the list's empty space clear it, so the year can be
    reached again. Three older specs clicked a trip to open it and now
    double-click or expect the list to stay. `npm run verify` passes (1,996
    unit, 159 end-to-end)
  - _Requirements: 2.4, 2.6, 2.7, 4.2_

- [x] 8. Items outside a trip
  - The holder trip, its migration and guards; sections name "Not in a
    trip" and list those first; each section's add menu; Move to; import
    where the user is (design §5.4, ADR 0022)
  - Unit tests: the holder is made once and never listed as a trip; guards
    refuse it; moving out and back is one undo step each; import from a
    section lands outside any trip
  - Done: migration 0007 (`trips.role`, one holder by partial unique index);
    `tripService.looseTripId`, `isLoose` and guards on update, move, archive,
    duplicate, delete and planning; `trips:loose`; the sections list holder
    items first as "Not in a trip"; new routes and waypoints go where the
    user is; Move to on each item's menu; Import defaults by section; a full
    export includes the holder's items. `looseTrip.test.ts` (5) and
    `loose.spec.ts` (3). Drag between a section and a trip was dropped:
    the two are never in the left panel together (Requirement 9.5 amended).
    Three upgrade tests now write their old trips with plain SQL. `npm run
    verify` passes (2,001 unit, 162 end-to-end). Recorded in design §5.4
  - _Requirements: 9.1–9.7_

- [x] 9. Details on the right
  - `TripDetails` replaces the hour grid; `StopDetails` and `DriveDetails`
    for a stop and a leg's route; no pencil for the three; ⋯ menus with
    Description and notes, Remove the plan, Delete trip, Edit the place and
    Edit the route (design §4.8, `docs/design/trip-editor/round-2/`)
  - Unit tests: which view shows for a stop and a leg's route; the day-limit
    and fuel line; the stay consequence from `computeTimeline`
  - Absorbs the old stop editor task
  - Done: `TripDetails`, `StopDetails` and `DriveDetails`, each with an
    options ⋯; `TripView` and its hour grid removed. `companionView` gained
    the stop and drive views and `editingRef`, so an editor opened for one
    thing does not cover another's details. `shared/itinerary/consequence.ts`
    works out what a stay change moves from the computed timeline (5 tests).
    The itinerary editor's leg, stay, notes and settings controls are reused,
    so nothing they did is lost. Until task 10 moves the plan's structure
    left, the trip's ⋯ keeps Edit the Plan. Not built here: the fuel line
    (the range check needs the places along the way, which Places along the
    trip already finds) and nearby places for a stop (task 19's day cards).
    `editSelection` reaches an editor through ⋯ where there is no pencil.
    `npm run verify` passes (2,008 unit, 163 end-to-end). Recorded in design
    §4.8
  - _Requirements: 4.2, 4.4, 4.5, 5.1, 5.2, 5.3, 11.2, 11.6, 11.7_

- [x] 10. Structure on the left
  - `PlanCards` for a dated trip's Plan tab: rows that select, drag to
    reorder, ×, Alt-↑/↓; Add in each card with `AddSearch` and the
    companion's `CandidateDetails`; Not in the plan; rename the trip in the
    header (design §4.9)
  - `itinerary:addPlaceStop` as one undo step
  - Unit tests: the drop index for a drag; the search's grouping; adding a
    place is one undo step
  - Done: `PlanCards` draws a dated trip's Plan tab as day cards (an
    undated trip keeps its list); rows select, stops drag to reorder or move
    with Alt and an arrow, and × takes one out of the plan. Add opens
    `AddSearch` in the card, over the trip's waypoints and the offline places
    and postcodes, and the companion's `CandidateDetails` shows what adding
    the highlighted result would do. `itinerary:addPlaceStop` (one undo).
    A drive with no route is focused through `planStore`, with its trip kept
    selected so the plan stays loaded. Not in the plan's waypoints drag onto
    a day. The trip's ⋯ no longer opens the itinerary editor; Plan the
    drives by road moved to the trip's details. `planEdit.ts` (5 tests),
    `addPlaceStop` (1), two companion rules; the roadtrip specs build and
    reorder the plan from the left. `npm run verify` passes (2,015 unit, 164
    end-to-end). Recorded in design §4.9
  - _Requirements: 10.2, 11.1, 11.3, 11.4, 11.5_

- [x] 11. Things made outside a plan
  - `routeFit` (pure); `itinerary:addRouteLeg` with move or copy and ends as
    stops; the route's Put it in a plan; drag from Not in the plan; Move or
    copy dialog; taking a route out of the plan (design §5.5,
    `docs/design/trip-editor/round-3/`)
  - Unit tests: matching at 1 km; a route from another trip copied and
    linked in one undo step; ends added as stops; a track is never a stop
  - Done: `shared/itinerary/routeFit.ts` (the itinerary's own leg check now
    uses it); `itinerary:addRouteLeg` and `itinerary:addWaypointStop`, each
    one undo step, moving out of Not in a trip and asking move or copy from
    another trip. Add searches this trip, Not in a trip and other trips, and
    the companion says whether a route joins the stops, with Use it as this
    drive or Add its ends as stops; Return never joins a route that does not
    fit. A route's card has Put it in a plan. Routes drag from Not in the
    plan onto a day; tracks do not, and say why. A track from elsewhere is
    moved, not copied. `routeFit.test.ts` (2), four service tests, two
    end-to-end tests in `loose.spec.ts`. The launch helper also waits for
    day cards, since a dated trip can now reopen without a list on screen.
    `npm run verify` passes (2,021 unit, 166 end-to-end). Recorded in
    design §5.5
  - _Requirements: 12.1–12.8_

- [x] 12. Right-click where you are
  - Each list's empty space offers what it makes; the map's ground offers
    Add a Waypoint Here and Start a New Route Here (design §5.6)
  - End-to-end: the Routes section's menu offers New Route; the map's menu
    adds a waypoint where it was opened
  - Done: `LibraryList`'s own-space menu switches on its root, a trip's
    lists included; `MapView` listens for `contextmenu` on the ground and
    leaves layers their menus; `actions.addWaypointAt`. `rightclick.spec.ts`
    (2). `npm run verify` passes (2,021 unit, 168 end-to-end)
  - _Requirements: 13.1, 13.2_

- [x] 13. A plan without waypoints
  - Migration 0008: a stop's waypoint becomes optional, with a point (where,
    and a name) instead; the timeline, planning, day cards, export and undo
    read a stop's place from either. `addRouteLeg` puts any route in: an end
    near the stop beside it joins it, otherwise a point stop is made there
    (design §5.6)
  - Unit tests: a plan that is one route; an end that does not match gets a
    point stop, joined by road; undo restores; an upgrade keeps every stop
  - Done: migration 0008 rebuilds `itinerary_stops` with an optional
    waypoint and a point, a check keeping one; `itineraryService.stopPlace`
    reads either, and planning, the timeline, the day cards, the tree summary
    and undo use it. `addStop` takes a point; `addRouteLeg` defaults to
    `auto`, joining an end to its neighbour within 1 km and otherwise making
    a point stop "Start of" or "End of" the route; `match` still refuses. Point
    rows have their own kind and are selected through `planStore`'s focus;
    their details offer no place to edit. Return and drag no longer refuse a
    route. Three service tests, the 0008 upgrade test, and a plan of one
    route end to end. `npm run verify` passes (2,024 unit, 169 end-to-end)
  - _Requirements: 13.3, 13.4_

- [x] 14. Join two with a new route
  - `routes:join` from the first's end to the second's start, by road or as a
    straight line, one undo step; Join with a New Route and Join with a
    Straight Line on a selection of two (design §5.6)
  - Unit tests: ends taken from a route's last and first points or a
    waypoint; refused without routing unless straight
  - Done: `poiTripService.joinWithRoute` and `routes:join`; Join with a New
    Route and Join with a Straight Line on any list's selection of two
    routes or waypoints, in list order; the new route is named "A → B",
    selected, and one undo step. Without routing, by road says why and points
    to the straight line. Dropped files go to the open trip by Import's
    default (task 8); dropping itself is not driven end to end. Three service
    tests, one end-to-end. `npm run verify` passes (2,027 unit, 170
    end-to-end)
  - _Requirements: 13.5, 13.6_

- [x] 15. Routes and waypoints in any order
  - Migration 0009: an entry is a stop or a route (`entry_kind`,
    `entry_route_id`); the timeline drives a route entry from its start to
    its end and counts it on its day; an entry that starts where the one
    before ends is joined, otherwise the gap is by road. `addRouteLeg` adds a
    route as an entry and makes no points. Day cards show a route entry once;
    drops land on rows or a day card, empty or not (design §5.7)
  - Unit tests: a plan of one route is timed and counts its driving; a joined
    entry has no drive between; taking an entry out and undoing restores it;
    a route entry is one day card row
  - Done: migration 0009; `stopPlaceOut`, `joined` and `StopView.drive`;
    `TimelineStopInput.drive` and `TimelineLeg.joined`; `addRouteLeg` adds a
    route entry; `dayCards` and the tree summary show it once; the drive
    details for a route entry say what joins it and offer Take Out of the
    Plan; day cards take drops anywhere. Five service tests, a day card test,
    and `loose.spec.ts` builds a plan of one route, drags a waypoint in and
    reorders. `npm run verify` passes (2,029 unit, 170 end-to-end)
  - _Requirements: 14.1–14.5_

- [x] 16. Adding and removing days
  - Migration 0010: an entry may be a day break (`entry_kind = 'day'`); the
    timeline starts the next day there; `addDay` and `removeDay`, one undo
    step each; `entryDays` places every entry on its day, by its time or by
    plan order; Add a Day After, Remove This Day and Add a Day in the day
    cards (design §5.8)
  - Unit tests: an empty day added at the end; a day removed, its entries in
    the trip and back with undo; the first day removed keeps the next one's
    date; a day added between two
  - Done: migration 0010; `TimelineStopInput.dayBreak`; `itineraryService`
    `addDay` and `removeDay` with `itinerary:addDay` and `:removeDay`;
    `entryDays` and `dayEntries`; `DayCard.breakId`; day cards with Add a Day
    After and Remove This Day, and Add a Day at the end. An entry whose time
    is unknown now sits on its day in plan order, so the Unknown times group
    is rarely seen. Four service tests, the day card test updated, and
    `loose.spec.ts` adds a day, drags into it, removes it and undoes.
    `npm run verify` passes (2,033 unit, 171 end-to-end)
  - _Requirements: 15.1–15.3_

- [x] 17. Right-click in the plan, and reordering within a day
  - `poiTripService.deleteItem` and `itinerary:deleteItem`; menus on plan
    entries and on Not in the plan; an entry dropped on another takes its
    place (design §5.9)
  - Unit tests: a waypoint deleted with its stop and back with undo; a route
    entry deleted with its route
  - Done: as above, with Move Out of the Trip through the batch move and a
    track's delete through the existing confirmation. `PlanCards` notes the
    dragged entry's index so a drop knows its direction. Two service tests;
    `loose.spec.ts` swaps two entries both ways and uses both menus, with
    undo. `npm run verify` passes (2,035 unit, 172 end-to-end)
  - _Requirements: 16.1–16.4_

- [x] 18. Region builds that can be tried again
  - Downloads written to `.part` and renamed when whole; `cachedExtract` and
    `pruneDownloads` (30 days); the merged file still removed after each
    build; `build.log` beside the graph with the machine's memory; a SIGTERM
    explained in the message (design §5.10)
  - Unit tests: a failed build keeps the downloads and the next builds from
    them with nothing downloaded; a stale download and a half-written one are
    replaced; the SIGTERM wording
  - Done: as above. The cause, from macOS's crash reports for the build at
    19:14 and two more: the tile builder was killed with "Code Signature
    Invalid / Invalid Page" inside LuaJIT while reading roads. The tools in
    `resources/valhalla/bin` had been signed with the hardened runtime but
    without `allow-unsigned-executable-memory`; the app is signed correctly
    by `build/sign-mac.cjs`, and `verify:package` checks that, but nothing
    checked the copy `npm run dev` runs. Re-signed; `bundle-valhalla.sh` now
    signs the two tools with their entitlements; `toolSigning.test.ts` fails
    if they lack it. `npm run verify:regions` builds Derbyshire, Cheshire and
    Staffordshire in 45 s, where it failed before. Unit tests: reuse, stale
    and half-written downloads, the SIGTERM wording. `npm run verify` passes
    (2,039 unit, 172 end-to-end)
  - _Requirements: 17.1–17.4_

- [x] 19. Routes that look movable, and photos as waypoints
  - `index.css`: `grab` over `.trailrt-shaping-hit` with a faint stroke on
    hover, `grabbing` under `.trailrt-shaping-drag`, `grab` on draggable
    markers; `useRouteShaping` sets the drag class from press to release or
    Escape (design §5.11)
  - `shared/photos/photoWaypoint.ts`; `photoStopIndex` in `planEdit.ts`;
    `waypoints:fromPhoto` and `itinerary:addPhotoStop`, reusing a waypoint
    the photo already made; Use as a Waypoint and Add to the Plan in the
    preview box and on a photo's right-click menu on the map
  - Unit tests: the fields from a photo, with no altitude invented and no
    waypoint without a location; the stop lands on the day it was taken;
    the second use reuses the waypoint; one undo removes waypoint and stop
  - End-to-end: the pointer over the selected route's line is a grab hand;
    a photo becomes a waypoint from the preview box
  - Done: as above. A photo goes into the plan by Add to the Plan rather
    than by dragging, because the trip page's Photos and Plan tabs are never
    on screen together (design §5.11). `photoWaypoint.test.ts` (shared and
    main) and `planEdit.test.ts` cover the fields, the refusal, the trip
    chosen, the reuse, the day and the one undo; `shaping.spec.ts` checks
    `grab` over the line and `grabbing` while held; `photos.spec.ts` makes a
    waypoint from the preview twice and undoes it. `npm run verify` passes
    (2,056 unit, 174 end-to-end)
  - _Requirements: 18.1–18.5_

- [x] 20. Waypoints off the map from the left panel
  - `WaypointsOnMap` in the left panel's header row, on
    `settings.layerVisibility.waypoints` (design §5.12)
  - End-to-end: the toggle hides the waypoint markers and unticks Layers ›
    Waypoints, and shows them again; the lists are unchanged
  - Done: as above. `routes.spec.ts` hides and shows the markers from the
    toggle and checks Layers › Waypoints follows. `npm run verify` passes
    (2,056 unit, 175 end-to-end)
  - _Requirements: 19.1–19.3_

- [x] 21. Search by pattern, across routes too
  - `shared/search/namePattern.ts`: `compileNamePattern`; the `regexp`
    function on the connection in `db/client.ts`; `REGEXP` in place of
    `LIKE` in `searchTrips` and `searchWaypoints`; new `searchRoutes`,
    `routeService.search` and `routes:search` through the handler, preload
    and `ApiSurface`; one shared `nameSearchRequest` (design §5.13)
  - `libraryStore`: `routeResults`, `searchError`; `SearchResults` with
    routes, line icons and the error; the field's label and hint
  - Unit tests: plain text still matches; anchors, alternation and groups
    work; case is ignored; a bad pattern gives the engine's message and is
    refused by the schema; the repositories match by pattern, and routes and
    items outside a trip are found
  - End-to-end: a pattern finds a route and a trip; a half-typed pattern
    explains itself and shows no results
  - Done: as above. `namePattern.test.ts` covers plain text, anchors,
    alternation, groups, literal `%` and `_`, accents and the engine's
    messages; the service tests search trips, routes and waypoints by
    pattern, across trips and outside one, and refuse `(`;
    `schemas.test.ts` refuses a bad pattern for all three; `search.spec.ts`
    finds trips and routes by pattern, opens a route in its trip or its
    section, and explains `peak (`. `npm run verify` passes (2,091 unit,
    186 end-to-end)
  - _Requirements: 20.1–20.4_

- [x] 22. Move to any trip from the right-click menu
  - `TripPickerDialog`; Move to Trip… on a route's, track's and waypoint's
    menu and on a multi-selection's, replacing the capped inline lists
    (design §5.14)
  - Unit tests: the filter narrows by pattern and explains a bad one; the
    arrow keys and Return pick the highlighted trip
  - End-to-end: an item moves to a trip beyond the old cap, picked through
    the filter by keyboard, and one undo moves it back
  - Done: as above. `tripPicker.test.ts` covers the filter, a bad pattern
    and the highlight's keys over 43 trips; `trip-picker.spec.ts` lists all
    18 destinations with the focus in the filter, moves to the last trip by
    filter and Return, moves a multi-selection by the arrow keys only once
    a trip is picked, picks with the pointer, and undoes each in one step;
    `loose.spec.ts` moves through the list. `npm run verify` passes (2,091
    unit, 186 end-to-end)
  - _Requirements: 21.1–21.4_

- [x] 23. Search the list that is open
  - `filterTree` in `libraryRoots.ts`; `openIds` on `LibraryList`;
    `searchScope` and `setSearchScope` in `libraryStore`, with requests sent
    only for Everywhere; the switch, the empty state and `SearchProblem` in
    `LeftPanel`; a trip's page narrows its objects (design §5.15)
  - Unit tests: a flat list narrows in place; a group or folder is kept and
    opened only for a match inside it; a matching one keeps all it holds;
    nothing matching leaves an empty root; the tree given is unchanged
  - End-to-end: Routes, Waypoints, the trip list and a trip's page each
    narrow their own list; nothing here offers everywhere, which finds it;
    the switch goes both ways and resets when the search is cleared; a bad
    pattern is explained in both scopes
  - Done: as above. `libraryRoots.test.ts` covers the flat list, the group
    and folder kept and opened for a match inside, the matching folder kept
    whole, the empty root and the unchanged input; `search.spec.ts` narrows
    Routes, Waypoints, the trip list and a trip's page, offers and runs the
    search everywhere, resets the switch, and explains `day (` in both
    scopes; `app.spec.ts` narrows the trip list. `npm run verify` passes
    (2,097 unit, 190 end-to-end)
  - _Requirements: 20.5–20.7_

- [x] 24. Tracks by name or by date
  - `shared/library/trackGroups.ts`: `arrangeTracks`; `tracks.startPoint`;
    `trackArrangement` and `trackSortDirection` in settings, the tree request
    and `libraryService.tree`; the Arrange control and direction in the
    Tracks heading; "Sort routes by" in the library options (design §5.16)
  - Unit tests: year › month › day with counts, either way, No date last;
    dated in the start's zone, the computer's when unknown with the note;
    the first year, month and days open; unique ids; name and distance
    either way; through the database, the start point's zone is used
  - End-to-end: flat by name; the date tree newest first and turned round;
    the note on a track in an unknown zone; search inside the tree; by
    distance; the choice survives a restart
  - Done: as above. `trackGroups.test.ts` covers the tree, both directions,
    the start's zone across midnight, the computer's zone with its note, No
    date, what opens, unique ids, and name and distance either way;
    `libraryTracks.test.ts` dates real tracks from their first point through
    the database; `tracks-arrange.spec.ts` covers the seven cases above. `npm
    run verify` passes (2,111 unit, 197 end-to-end)
  - _Requirements: 22.1–22.6_

- [x] 25. Dates read from track names
  - `shared/library/nameDate.ts`: `dateFromName`; `arrangeTracks` places a
    track with no times under the day in its name, after the recorded ones,
    with "date from name" and a hint (design §5.17)
  - Unit tests: each form day first, ambiguous dates never month first,
    month first only when day first is impossible, named months either
    side, year first and `yyyymmdd`, the century of a two-digit year, leap
    days, the text read, and names with no date; the tree places and orders
    them
  - End-to-end: a generated track with no times named Dovedale 16-05-26
    sits under Sat 16 May after the recorded track, with its hint
  - Done: as above. `nameDate.test.ts` (36 cases) and `trackGroups.test.ts`
    cover the reading and the placing; `tracks-arrange.spec.ts` imports the
    generated track. `npm run verify` passes (2,152 unit, 200 end-to-end)
  - _Requirements: 22.7_

- [x] 26. Show tracks on the map from the list
  - `onShow` on `TreeRow`; the Tracks section's rows in `LibraryList`;
    `fullName` on date rows; `tracks:bounds`; `mapFocusStore`; `MapView`
    draws, fits and labels them (design §5.17)
  - Unit tests: the box spans exactly the tracks asked for
  - End-to-end: a month's arrow shows its three tracks with the strip, and
    Clear removes it; a track's arrow shows and selects it
  - Done: as above. `libraryTracks.test.ts` checks the box over real points;
    `tracks-arrange.spec.ts` shows May 2026's three tracks across two trips,
    clears them, and shows and selects one track. `npm run verify` passes
    (2,152 unit, 200 end-to-end)
  - _Requirements: 23.1–23.4_

- [x] 27. Each imported file kept once
  - Migration 0011: `source_files`, `track_sources` as a link, the trigger;
    `insertTrackSource` and `findTrackSource`; `COMPACT_AFTER` and the
    `VACUUM` in `createDatabase`; ADR 0025 (design §5.18)
  - Unit tests: an old-format database upgrades with one copy per file, every
    track's own bytes, and a smaller file with no free pages; an empty one
    upgrades; new imports share a file; the file goes with its last track,
    and with a trip's cascade
  - Trial: the migration on a clone of the owner's database
  - Done: as above. `sourceFiles.test.ts` covers the upgrade, the empty
    upgrade, sharing and both ways a file goes. On a clone of the owner's
    12.4 GB database the migration and `VACUUM` took 9 seconds and left
    140 MB, with all 685 tracks reaching their originals, all five files
    matching their hashes and `integrity_check` ok. `npm run verify` passes
    (2,166 unit, 203 end-to-end)
  - _Requirements: 25.1–25.3_

- [x] 28. A space limit on backups
  - `planPrune`, the limits and protection in `createBackup` and
    `restoreBackup`, the free-space check; `backupMaxGb`; `BackupUsage` in
    Settings (design §5.18)
  - Unit tests: oldest first within space and count, the stricter limit,
    the newest always kept, protected files kept; on disk, a backup rolls,
    an oversized one is the only one kept, a new one survives its own clean-up
    whatever the dates, and a restore keeps its source
  - End-to-end: 2 GB to start with and what is not backed up; a backup in
    the usage; a changed limit kept across a restart
  - Done: as above. `backupService.test.ts` (10 cases) found and covers a
    backup removed by its own clean-up when a nearby file was dated in the
    future; `backups.spec.ts` covers Settings. `npm run verify` passes
    (2,166 unit, 203 end-to-end)
  - _Requirements: 24.1–24.5_

- [x] 29. Show routes and waypoints on the map from the list
  - `showRoute`, `showWaypoint`, `target` and `shown` in `mapFocusStore`,
    with the box from `boundingBox`; the arrow on route and waypoint rows in
    `LibraryList`; `MapView` moves to the target and draws the shown object
    with its layer hidden (design §5.19)
  - Unit tests: a route's arrow asks for its box, a waypoint's for its
    point, a route with no points asks for nothing; the shown object is
    forgotten when something else is selected
  - End-to-end: a route's arrow selects it and moves the map to it; a
    waypoint's centres on it zoomed in; a waypoint asked for is drawn with
    its layer hidden until something else is selected
  - Done: as above. `mapFocusStore.test.ts` covers both arrows, the route
    with no points, forgetting the shown object, and a second request;
    `show-on-map.spec.ts` covers the three cases above. Routes draw on the
    canvas, so the hidden-layer case is checked through a waypoint's marker,
    which takes the same path. `npm run verify` passes (2,179 unit, 207
    end-to-end)
  - _Requirements: 26.1–26.4_

- [x] 30. A folder's photos under the Photos list
  - `features/photos/photoGrid.ts`: `layoutPhotoGrid`, `rowsInView`,
    `dayLabel`; `PhotoThumb` out of `TripPage`; `FolderPhotoGrid` under the
    Photos section's list; `goToPhoto` in `mapFocusStore` (design §5.19)
  - Unit tests: days in order with undated last, four to a row, offsets
    that add up; only the rows meeting the viewport are drawn, for 40,000
    photos as for 30
  - End-to-end: selecting the folder shows its 29 photos underneath; a
    located photo opens the preview and moves the map to it; one with no
    location says why
  - Done: as above. `photoGrid.test.ts` covers the days, the rows and
    offsets, and the window over 40,000 photos; `photos.spec.ts` selects the
    folder in the Photos section, opens a located photo and checks the map's
    centre and zoom, then scrolls to an unlocated one and checks its mark
    and message. `npm run verify` passes (2,179 unit, 207 end-to-end)
  - _Requirements: 27.1–27.4_

- [x] 31. Remove duplicates by content
  - `shared/library/duplicates.ts`: `groupDuplicates`, the keep rule and
    `DUPLICATE_UNDO_POINTS`; `contentKeys.ts`; `duplicateService.find`,
    `remove`, `removeDuplicateTrack` and `restoreDuplicateTrack` with the
    `track:removeDuplicate` and `track:restoreDuplicate` commands;
    `duplicates:find` and `duplicates:remove`; `RemoveDuplicatesDialog` and
    its menu items; ADR 0027 (design §5.20)
  - Unit tests: groups by key whatever the name; the keep rule; a copy a plan
    uses is never removed; across trips marked; through the database, exact
    content only, segment breaks count, archived trips hidden; removal is one
    step and undo puts each kind back, a track rebuilt from its twin with its
    original file; a changed twin refuses; redo; a changed pair is skipped
  - End-to-end: the same file imported twice leaves duplicate tracks, which
    the dialog finds and removes, and undo puts back; duplicate routes with
    different names; a waypoint copied to another trip starts unticked; none
    found says how many were compared
  - Done: as above. `duplicates.test.ts` in `shared/library` covers the
    grouping and keep rule; in `main/services` it covers exact content,
    elevation, time and segment breaks, archived trips, a planned waypoint
    never removed, undo of two tracks with both original files and redo, a
    changed or deleted twin refusing, routes and waypoints, and a changed
    pair skipped. `duplicates.spec.ts` covers the four cases above, and
    `app.spec.ts` lists the new `duplicates` bridge namespace. `npm run
    verify` passes (2,194 unit, 210 end-to-end)
  - _Requirements: 28.1–28.8_

- [x] 32. Show a trip and what is in it on the map from its page
  - `showTrack` and `showTrip` in `mapFocusStore`; the arrow on route, track
    and waypoint rows of the trip page's Plan and Objects tabs and its search
    in `LibraryList`; the trip's arrow beside its name in `TripHeader`;
    `MapView` draws a shown track with the Tracks layer hidden (design §5.21)
  - Unit tests: a track's arrow selects it and asks for its box, a track with
    no points says so; a trip's arrow selects the trip and asks for its
    geometry's box, a trip with nothing says so, and it leaves `shown` alone
  - End-to-end: on a trip page, the trip's arrow fits the map to the trip; a
    route's, track's and waypoint's arrow in the Objects tab selects it and
    moves the map to it
  - Done: as above. `mapFocusStore.test.ts` covers a track's arrow, a track
    with no points, a trip's arrow, a trip with nothing in it, a trip's arrow
    leaving hidden layers hidden, and reading the asked-for trip's geometry;
    `show-on-map.spec.ts` imports the Buxton loop into a trip, then checks
    the trip's, the track's and the route's arrows each select and fit after
    the waypoint's has zoomed in. Tracks draw on the canvas, so the track
    drawn with its layer hidden takes the path task 29 checked through a
    waypoint's marker. `npm run verify` passes (2,200 unit, 213 end-to-end)
  - _Requirements: 29.1–29.4_

- [ ] 33. The day and what is in it
  - `DayView` with `HourScale`, day switching and stay dragging; `StopCard`,
    `DriveCard`, `TrackCard`, `PhotoMoment`; photos here, nearby and along
    the way
  - Unit tests: the selected item is highlighted on the scale; a track
    without times says so
  - _Requirements: 4.3–4.7, 4.9, 10.4_

- [ ] 34. The left panel as drawn
  - Line icons for every row; day cards; the Trips header as in view 1
    (design §4.6)
  - Unit tests: every row kind has an icon; no emoji in any root
  - _Requirements: 10.1–10.3_

- [ ] 35. The Photos section
  - Virtualised grid by trip with Trip and Year filters; all-trips mode;
    `PhotoMoment` with Open the trip at that day; photos outside a trip
  - Unit tests: the grid draws only visible rows; filters narrow the groups
  - _Requirements: 7.1–7.3, 9.2_

- [ ] 36. End-to-end and verification pass
  - `library.spec.ts`; every spec on the new panels; the old tree's
    behaviours checked off or recorded as removed (Requirement 8.3)
  - Phase 1, 2, 10 and 11 specs amended as listed in the requirements; then
    Phase 11 tasks 12 and 13 resume
  - _Requirements: 8.2, 8.3_
