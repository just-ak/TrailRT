# Phase 14: The library and the day companion — tasks

Built ahead of Phase 11's tasks 12 and 13 at the owner's request; those finish
after task 12 here, against the new panels.

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
    trip list the year shows even with an object still selected. Ten specs
    reach the editors through the pencil (`editSelection`) or the trip
    page's More menu. `npm run verify` passes (1,994 unit, 156 end-to-end).
    Recorded in design §4.3
  - _Requirements: 4.1, 4.2, 4.8, 5.1, 6.1, 6.2, 10.4_

- [ ] 7. Items outside a trip
  - The holder trip, its migration and guards; sections name "Not in a
    trip" and list those first; each section's add menu; Move to and drag in
    and out; import where the user is (design §5.4, ADR 0022)
  - Unit tests: the holder is made once and never listed as a trip; guards
    refuse it; moving out and back is one undo step each; import from a
    section lands outside any trip
  - _Requirements: 9.1–9.7_

- [ ] 8. The day and what is in it
  - `DayView` with `HourScale`, day switching and stay dragging; `StopCard`,
    `DriveCard`, `TrackCard`, `PhotoMoment`; photos here, nearby and along
    the way
  - Unit tests: the selected item is highlighted on the scale; a track
    without times says so
  - _Requirements: 4.3–4.7, 4.9, 10.4_

- [ ] 9. The stop editor
  - One form for the stop and its place; the consequence preview from
    `computeTimeline`; Done as one undo step (design §5.3)
  - Unit tests: the preview matches the timeline after saving; cancel changes
    nothing
  - _Requirements: 5.2, 5.3_

- [ ] 10. The left panel as drawn
  - Line icons for every row; day cards; the Trips header as in view 1
    (design §4.6)
  - Unit tests: every row kind has an icon; no emoji in any root
  - _Requirements: 10.1–10.3_

- [ ] 11. The Photos section
  - Virtualised grid by trip with Trip and Year filters; all-trips mode;
    `PhotoMoment` with Open the trip at that day; photos outside a trip
  - Unit tests: the grid draws only visible rows; filters narrow the groups
  - _Requirements: 7.1–7.3, 9.2_

- [ ] 12. End-to-end and verification pass
  - `library.spec.ts`; every spec on the new panels; the old tree's
    behaviours checked off or recorded as removed (Requirement 8.3)
  - Phase 1, 2, 10 and 11 specs amended as listed in the requirements; then
    Phase 11 tasks 12 and 13 resume
  - _Requirements: 8.2, 8.3_
