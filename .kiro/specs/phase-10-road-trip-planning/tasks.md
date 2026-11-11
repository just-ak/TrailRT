# Phase 10: Road Trip Planning — Tasks

Execute in order. Pure modules come first, each proven offline, then storage
and the main process, then the UI, then the end-to-end and verification pass.

Update `docs/progress-mindmap.svg` as each task changes status.

- [x] 1. Spec, ADR 0019 and the out-of-order build
  - `design.md`, `tasks.md`, ADR 0019; README row and decision index; the
    note that this phase is built ahead of Phases 8 and 9 at the owner's
    request
  - Requirements 3.2 and 3.7 amended per design §14
  - Mindmap: the phase's leaves become these tasks
  - _Requirements: 12.2_

- [x] 2. Zoned time and offline time-zone lookup
  - `shared/time/zoned.ts`: `zoneOffsetMs`, `wallClockToUtc`,
    `utcToWallClock`, `addDays`, `isValidDate`, `isValidTime`
  - `shared/time/timeZones.ts`: `TimeZoneResolver`, polygon table with
    `UK_BOUNDARY` → `Europe/London`
  - Unit tests: 01:30 on 29 Mar 2026 moves forward; 01:30 on 25 Oct 2026 takes
    the earlier instant; 09:00 the day after BST ends is 09:00 GMT; `addDays`
    across 28/29 Feb and 31 Dec; Buxton → London; Dublin and Douglas → null
  - _Requirements: 3.8, 3.9, 13.1_

- [x] 3. Itinerary types and the timeline
  - `shared/domain/itinerary.ts`: stored and view types
  - `shared/itinerary/timeline.ts`: `computeTimeline`, days, flags, end date
  - Unit tests: hours stop; 2-day stay across the clock change leaves 09:00
    GMT; arrive-by missed; depart-at waits when early and flags when late;
    an unplanned leg makes every later time null; deleted location; daily cap
    flagged and nothing moved; a walking leg uses the planning speed and a
    driving leg does not; the night is spent at the right stop
  - _Requirements: 1.3, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 13.1_

- [x] 4. Corridor geometry and the range check
  - `shared/geo/corridor.ts`: line index, `project`, `corridorBox`, sections
  - `shared/itinerary/rangeCheck.ts`
  - Unit tests on `A515_TRACE`: along and off distances; points beyond the
    width rejected; a point near both ends of a loop projects to the nearer
    segment; section by distance and by "near a point"; ordering; empty.
    Range: a gap flagged; a station clears it; unset range runs no check; the
    reserve shrinks the usable range; an uncovered stretch is "not checked"
  - _Requirements: 6.2, 6.3, 6.4, 6.7, 9.1, 9.2, 9.3, 9.4, 9.5, 13.2, 13.3_

- [x] 5. POI categories, attributes and opening hours
  - `shared/poi/categories.ts` (the tag table, reasons, symbols, osmium filter
    expressions), `shared/poi/attributes.ts`, `shared/poi/openingHours.ts`,
    `shared/poi/PoiProvider.ts`
  - Unit tests: every category maps to a real symbol id; private unnamed
    parking excluded; attributes keep only the Requirement 7.1 fields;
    `24/7`; `Mo-Fr 08:00-18:00; Sa 09:00-12:00`; past midnight; later rule
    overrides; `off`; an unparsed expression stays unparsed; a missing value
    is absent, not open
  - _Requirements: 5.7, 6.1, 7.1, 7.3, 7.4_

- [x] 6. Postcodes, OSGB and search text
  - `shared/search/postcode.ts`, `shared/search/text.ts`,
    `shared/search/rank.ts`, `shared/search/PlaceSearchProvider.ts`,
    `shared/geo/osgb.ts`
  - Unit tests: `de451aa`, `DE45 1AA`, `de45  1aa` equal; full, sector,
    outcode; `BT1 1AA`, `IM1 1AA`, `JE2 3AB`, `GY1 1AA` uncovered; malformed
    falls through; abbreviations both ways; prefix tokens; ranking order;
    duplicate names get their county; OS worked example; SK17 centres within
    10 m
  - _Requirements: 11.4, 11.5, 11.6, 11.7, 11.8, 11.13, 11.14, 11.17, 13.9, 13.10_

- [x] 7. iCalendar writer
  - `main/io/ics/write.ts`: events, VTIMEZONE from real transitions, escaping,
    folding, CRLF
  - Unit tests: structure; a trip across 25 Oct 2026 has both offsets; a
    75-octet fold never splits a UTF-8 sequence; `;` `,` `\` and newlines
    escaped; unknown-time stops left out and reported; unknown zone written
    as UTC
  - _Requirements: 10.1, 13.7_

- [x] 8. Itinerary storage
  - Migration `0004_itinerary.sql`, `schema.ts`, `db/repositories/itineraries.ts`
  - Unit tests: migration applies on a Phase 7 database; deleting a trip
    cascades; deleting a waypoint leaves the stop; `seq` ordering
  - _Requirements: 1.1, 1.5, 2.1, 2.2_

- [x] 9. Itinerary service and commands
  - `main/services/itineraryService.ts`; commands registered with labels
  - Unit tests: every operation's undo and redo; remove-then-undo restores
    every stop; a deleted waypoint shows `location-deleted` and heals on
    undo; foreign waypoint or route refused; 100-stop bound; archived trip
    keeps its itinerary
  - _Requirements: 1.2, 1.5, 2.1, 2.2, 2.6, 2.7, 3.5_

- [x] 10. Itinerary IPC, preload and tree detail
  - Channels, schemas, handlers, preload methods; `libraryService` date range
  - Unit tests: schemas reject `25:00`, `2026-02-30`, 101 stops; tree detail
    for a scheduled trip; **no detail and an identical node for a trip with no
    itinerary**
  - _Requirements: 1.1, 1.4, 12.5_

- [x] 11. Place data: extract and ingest
  - `main/places/extract.ts`, `main/places/ingest.ts`, `main/places/store.ts`
    (`placesState`); `BuildSteps.places` wired into `downloadAndBuild` and
    `.osm.pbf` import; "Reading places" progress
  - Fixtures: `test-data/places-excerpt/` from the real extract, with ODbL
    attribution
  - Unit tests: Palace Hotel kept once, as an area, at its centroid; streets
    collapse per settlement; addresses; county from region rings; failed
    build keeps the previous snapshot; osmium integration test (skipped when
    the tool is absent)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 11.10, 13.4, 13.5_

- [x] 12. Postcode data
  - `main/places/postcodes.ts`: listing, size, one-hop allowlisted download,
    MD5 check, jszip ingest, atomic replace
  - Fixtures: `test-data/codepoint/` real excerpt with licence and metadata
  - Unit tests: quality 90 stored without a location; any other redirect
    host refused; MD5 mismatch refused and the old data kept; release date
    from `metadata.txt`
  - _Requirements: 11.4, 11.9, 11.15, 13.11_

- [x] 13. Search service
  - `main/places/searchService.ts` implementing `PlaceSearchProvider`; IPC
    `search.query`, `search.status`, `postcodes.*`
  - Unit tests against the fixtures: postcode exact, sector, not found with
    date, uncovered message, no location; place prefix; street with house
    number to the building; house number falling back to its street; empty
    result names the loaded regions; latency measured on the full data in the
    live test
  - _Requirements: 11.1, 11.3, 11.5, 11.6, 11.7, 11.8, 11.11, 11.12, 11.13, 11.16, NFR 2_

- [x] 14. POI search and range service
  - `main/places/poiService.ts` implementing `PoiProvider`: corridor query
    for a route or an itinerary, sections, chunked and cancellable; detour by
    road; range check; IPC `places.*`
  - Unit tests against the fixture: ordered results; itinerary results carry
    day and time; cancel stops work; uncovered stretch reported; detour needs
    a provider
  - No online POI source is offered (design §6.4), which is how 5.5 is met
  - _Requirements: 5.5, 5.6, 6.1, 6.3, 6.4, 6.5, 6.8, 9.2, 9.5, 12.1_

- [x] 15. From POI to waypoint and stop; planning legs
  - `WaypointSource` gains `poi`; provenance in metadata; `addPoiWaypoint`,
    `addPoiStop`, `planLeg`, re-route through a stop, each a batch
  - Unit tests: the waypoint's symbol, plain-text description and provenance;
    one undo removes waypoint and stop; re-route creates two routes and
    leaves the old one unchanged and in the trip
  - Found while testing: undoing a waypoint deletion lost its `metadata`
    (also true of imported waypoints before this phase). Fixed: the inverse
    carries metadata and source, read before the row is deleted
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 16. Export
  - GPX order for a scheduled trip and the unmapped warning; `itinerary.exportIcs`
    with a save dialog
  - Unit tests: stop waypoints in order; no `<time>` on stops; a trip with no
    itinerary exports byte-identically to before
  - iCalendar import stays out (10.5): no reader is added
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 13.6_

- [x] 17. Itinerary editor
  - `features/itinerary/ItinerarySection.tsx` in trip properties; store
  - Unit tests for the view-model helpers (duration text, flag messages)
  - _Requirements: 1.2, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.6, 9.1, 9.3, 9.5_

- [x] 18. Calendar drawer
  - `features/itinerary/CalendarPanel.tsx`, day, week and month; pure layout
    helpers in `calendarLayout.ts`; drag to change duration; selection sync
  - Unit tests: block placement and overlaps; unknown times listed, not
    placed; drag snaps to 15 minutes or whole days
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 19. Along-the-route panel and POI layer
  - `features/poi/PoiPanel.tsx`, `features/map/usePoiLayer.ts`,
    `shared/geo/cluster.ts`, `layerVisibility.pois`
  - Unit tests: clustering per zoom; empty-state wording carries the date
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.5, 7.6, 7.7, 8.1, 9.2, 9.4_

- [x] 20. Map search box
  - `features/search/SearchBox.tsx`; result actions; approximate areas
  - Unit tests: stale responses are dropped; keyboard selection
  - _Requirements: 11.1, 11.2, 11.6, 11.15, 11.16_

- [x] 21. Settings, About and the register
  - Postcode section; places status and rebuild; About statements;
    third-party register "Data" section
  - _Requirements: 5.4, 11.9, 11.15, 12.2, 12.3_

- [x] 22. End-to-end tests and verification pass
  - `tests/e2e/roadtrip.spec.ts` with seeded `places.sqlite` and
    `postcodes.sqlite`, all network blocked: build an itinerary, calendar,
    fuel and a hotel along a route, hotel as a stop, postcode and place
    search, restart with everything intact
  - `npm run verify` green; README row marked complete
  - Found while testing: a library change (any edit, or an undo) reloaded the
    itinerary and briefly unmounted the "Plan by date" form, losing what was
    being typed. The form now stays mounted while the same trip reloads.
  - Found while reviewing screenshots: short calendar blocks overprinted
    each other, and the clock-change note was clipped. Blocks are now drawn
    at least 45 minutes tall and allocated lanes on that drawn length
  - Result: 1,533 unit tests and 138 end-to-end tests pass, 8 of them this
    phase's, with every network request refused
  - _Requirements: 13.8, 13.12, 12.4, NFR 1_

## Feedback after the first build (11 November 2026)

- [x] 23. Spec for the feedback
  - Requirements 14–17, design §15, ADR 0019 §8, these tasks, mindmap leaves
  - _Requirements: 14.5, 15.1, 16.1, 17.4_

- [x] 24. Leg modes in storage and the timeline
  - Migration `0005_leg_modes.sql`; `ItineraryStop` leg fields; service
    `setLegMode`; timeline `other` legs, `no-travel-time`, `otherSeconds`;
    range check and POI search skip `other` legs
  - Unit tests: migration marks linked legs `route`; a ferry with 2 h is timed
    2 h and not counted as driving; a ferry with no time makes the rest
    unknown; choosing a route switches the mode; undo of each
  - _Requirements: 15.1, 15.5, 15.6_

- [x] 25. Automatic planning
  - `autoPlanService.autoPlan`; `plannedBy` marker; replanning of stale
    planned routes only; one batch with the structural change; `planIssue`
  - Unit tests with a fake provider: adding a stop plans both legs; moving a
    stop replaces only planned routes and leaves a drawn route untouched; one
    undo removes stop and routes; no provider leaves the leg unplanned with a
    reason; an `other` leg is never planned
  - _Requirements: 15.2, 15.3, 15.4_

- [x] 26. Leg modes in the editor
  - Mode control per leg (by road, choose a route, other transport with kind,
    label and time); reason when a road leg could not be planned
  - Unit tests: a plan issue is given for a by-road leg with no route, and
    never for a chosen route or other transport
  - Built with task 29's icon buttons, which were done first so these
    controls never had text buttons; "Route through this stop" was removed,
    since inserting a stop now plans both sides itself
  - _Requirements: 15.1, 15.4, 15.5, 15.6_

- [x] 27. The trip in the library summarises it
  - `group` tree nodes; day groups, unknown times, not in the plan; trip
    detail with days and distance; days expanded by default
  - Unit tests: a dated trip's tree in plan order with times; a stop used
    twice gets two distinct rows; nothing in the trip is lost; an undated
    trip's node is unchanged
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 28. Resizable, hideable panels
  - `PanelLayout.drawerHeight` and `drawerVisible`; top-edge resize with a map
    minimum; panel toggles at the map's bottom-left
  - Unit tests: height clamping keeps the map minimum; old settings without
    the new keys load with defaults
  - _Requirements: 16.1, 16.2, 16.3, 16.4_

- [x] 29. Icon buttons with hints
  - `lucide-react` added and registered; `IconButton` with `hint` and a
    portal tooltip; the panels converted
  - Unit tests: tooltip placement stays inside the window
  - Registering it showed the About list's hand-kept set was already missing
    three runtime dependencies (`fast-xml-parser`, `fit-file-parser`,
    `jszip`); all four are now listed
  - _Requirements: 17.1, 17.2, 17.3, 17.4_

- [x] 30. End-to-end tests and verification
  - Road trip spec updated for automatic legs, the tree summary, panel
    toggles and icon buttons; `npm run verify` green
  - Without map regions the e2e app has no routing, so the automatic leg is
    proven by its stated reason, not by a route; the unit tests drive a fake
    provider
  - The full run caught what the panel conversion missed: the track and
    waypoint action rows were still text, and the trip's import icon shared
    the accessible name "Import files" with the library's. Both fixed; the
    trip's is now "Import GPX, KML or other files"
  - Screenshots caught two layout faults, fixed: a width class appended to
    `INPUT_CLASS` lost to its `w-full` (new `inputAt()` swaps it instead), and
    the calendar opened at midnight rather than at the first thing planned
  - _Requirements: 14.2, 15.2, 16.2, 17.2_
