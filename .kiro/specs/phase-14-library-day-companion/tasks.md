# Phase 14: The library and the day companion — tasks

Built ahead of Phase 11's tasks 12 and 13 at the owner's request; those finish
after task 23 here, against the new panels.

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

- [ ] 20. The day and what is in it
  - `DayView` with `HourScale`, day switching and stay dragging; `StopCard`,
    `DriveCard`, `TrackCard`, `PhotoMoment`; photos here, nearby and along
    the way
  - Unit tests: the selected item is highlighted on the scale; a track
    without times says so
  - _Requirements: 4.3–4.7, 4.9, 10.4_

- [ ] 21. The left panel as drawn
  - Line icons for every row; day cards; the Trips header as in view 1
    (design §4.6)
  - Unit tests: every row kind has an icon; no emoji in any root
  - _Requirements: 10.1–10.3_

- [ ] 22. The Photos section
  - Virtualised grid by trip with Trip and Year filters; all-trips mode;
    `PhotoMoment` with Open the trip at that day; photos outside a trip
  - Unit tests: the grid draws only visible rows; filters narrow the groups
  - _Requirements: 7.1–7.3, 9.2_

- [ ] 23. End-to-end and verification pass
  - `library.spec.ts`; every spec on the new panels; the old tree's
    behaviours checked off or recorded as removed (Requirement 8.3)
  - Phase 1, 2, 10 and 11 specs amended as listed in the requirements; then
    Phase 11 tasks 12 and 13 resume
  - _Requirements: 8.2, 8.3_
