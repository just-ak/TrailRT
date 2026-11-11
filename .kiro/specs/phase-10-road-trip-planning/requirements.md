# Phase 10: Road Trip Planning — Requirements

Status: first build complete (10–11 November 2026), built ahead of Phases 8
and 9 at the owner's request; see ADR 0019 §1. Feedback Requirements 14–17
built and verified (11 November 2026).

Depends on Phase 4 (routing engine, leg travel-time estimates) and Phase 7
(UK county regions), both shipped. It does **not** depend on Phase 8 or
Phase 9, so it can be moved ahead of either without rework. Its position after
them is a default, not a dependency.

## Introduction

A trip today is a container: a name, a description, notes, a status, and an
unordered set of routes, tracks and waypoints. It has no dates, no order, and
no idea how long anything takes. This phase adds three things the owner asked
for:

1. **A calendar-based way to plan a trip.** The trip gets a start date and an
   ordered itinerary of stops. Each stop has a duration in hours or days. The
   app works out arrival and departure times from the driving time between
   stops, and shows the result as a calendar as well as on the map.
2. **Finding points of interest along a route.** Hotels, petrol, food,
   attractions and the like, found within a chosen distance of the route,
   listed in the order you reach them, and addable to the trip as stops.
3. **Postcode and place search, offline.** Type a postcode, a town or a
   street and go there, then drop a waypoint or start a route from it. The
   owner asked for it to stay offline (10 November 2026), so no online
   geocoder is offered at all. See Requirement 11.

### What the codebase already establishes

These findings come from the code as it stands after Phase 7. They constrain
the design and are recorded here so the design does not have to rediscover
them.

- **`Trip` has no temporal fields** (`src/shared/domain/types.ts`). Routes in
  a trip carry no sort order (`routes` in `src/main/db/schema.ts` is indexed
  by `trip_id` only). An itinerary therefore needs new storage. It cannot be
  inferred from what exists.
- **The region pipeline throws its map data away.** `regionCatalogue.ts`
  downloads Geofabrik `.osm.pbf` extracts, merges them with `osmium`, builds
  the routing graph, then deletes every extract. The graph keeps roads, not
  hotels or fuel stations. Offline POI search therefore has to capture POIs
  while the extract still exists. `osmium` is already bundled for the merge
  step, so filtering by tag at build time adds no new tool.
- **`connect-src 'self'` blocks every outbound request** except those the
  routing provider declares. Nothing in the app can query an online POI
  service today, and that is the correct default.
- **The waypoint symbol set already has `lodging`, `fuel`, `food`, `parking`,
  `viewpoint` and `campground`**, each paired with a Garmin `<sym>` name
  (`src/shared/domain/symbols.ts`). POI categories should map onto this set
  rather than invent a parallel one.
- **Valhalla can resolve time zones** when `timezones.sqlite` sits beside the
  tiles (`embedded.ts`). Today it is optional and usually absent.
- **`planningSpeedKmh` defaults to 4.5 km/h**, which is walking pace. A road
  trip timeline built on it would be absurd. Phase 8 already raises this as an
  unresolved question. This phase forces an answer. Since this was written,
  Phase 7 Requirement 6.2 added per-mode averages for the properties panel's
  estimate (`src/shared/routing/travelTime.ts`), with walking still at the
  planning speed. The timeline should reuse that module, not add a second set
  of speeds.
- **There is no geocoder anywhere.** Phase 6 left place search out of scope
  because a geocoder would be a network dependency for a core feature, which
  ADR 0007 rules out "without an offline source". Requirement 11 is that
  offline source. The same region build that has to capture POIs
  (Requirement 5.1) can capture place and street names in the same pass.

### Three distinctions this phase must keep

1. **A plan is not a record.** Arrival and departure times are planned values
   derived from estimates. They are never presented as measurements, the same
   rule ADR 0011 §8 applies to route duration.
2. **No result is not proof of absence.** OpenStreetMap coverage of hotels and
   fuel stations is good in the UK but not complete. "No fuel found in the
   next 60 km" means none is *mapped*. The UI must say so.
3. **Durations in days are calendar days, not multiples of 24 hours.** "Stay
   two days" means leave on the morning two dates later, not 48 hours after
   arriving at 17:40. See Terms.

## Terms

| Term | Meaning |
| --- | --- |
| **Itinerary** | The ordered list of stops for a trip, with a start date and time. Optional. A trip without one behaves exactly as it does today. |
| **Stop** | A place in the itinerary: start, end, or somewhere in between. It references a location and has a duration. |
| **Duration** | How long is spent at a stop. Given in **hours** (e.g. 1.5 h for lunch) or **days** (e.g. 2 days at a hotel). |
| **Day-stay** | A stop whose duration is in days. You leave on the date N days after arriving, at the stop's departure time. |
| **Leg** | The driving between two consecutive stops. It has a distance and an estimated driving time. |
| **Timeline** | The derived arrival and departure time of every stop. A cache, always recomputable from the itinerary and the legs. |
| **Corridor** | The area within a chosen distance of a route, used to find POIs along it. |
| **POI** | A point of interest from OpenStreetMap, such as a hotel, fuel station or café. It is not part of the library until the user adds it. |
| **POI snapshot** | The set of POIs captured from a region's extract, with the date of that extract. |
| **Gazetteer** | The local, searchable index of postcodes, place names and street names that Requirement 11 searches. Built on this machine; never queried remotely. |
| **Postcode centre** | The single point a postcode dataset gives for a postcode. It stands for the postcode's area, which may cover several streets, and is not an address. |

## User stories

1. As someone planning a five-day road trip, I want to set a start date and
   see each day laid out on a calendar, so I can check the plan fits the
   week I have off.
2. As the same traveller, I want to say "two nights in Buxton" or "an hour at
   the Cat and Fiddle" and have every later time move when I change it, so I
   am not doing the arithmetic by hand.
3. As a rider on a motorcycle with a 200 km range, I want to see where the
   fuel stations are along tomorrow's route, and be warned about any stretch
   with none mapped, so I do not run dry on a moor.
4. As a traveller looking for somewhere to stay, I want to see the hotels near
   where a day's driving ends, and add one as the night's stop.
5. As someone who has to be somewhere at a given time, I want to see when I
   will arrive at each stop, and be told when a day's driving runs long.
6. As a privacy-conscious user, I want POI search to work from data already on
   my machine, and to be asked before my route is sent anywhere.
7. As a user who shares plans, I want to export the itinerary to my calendar
   app, and the route and stops to my GPS.
8. As an existing user who never plans by date, I want trips to work exactly
   as they do now.
9. As someone planning from a hotel confirmation, I want to type its postcode
   and go there on the map, without the search leaving my machine.

## Requirements

### Requirement 1: Trip schedule

#### Acceptance criteria

1. A trip SHALL optionally carry an itinerary with a start date and start
   time. A trip without one SHALL behave exactly as it does today: same tree,
   same properties panel, same export. This is a regression requirement and
   SHALL be covered by tests that would fail if it broke.
2. THE user SHALL be able to add an itinerary to an existing trip, and remove
   one, without changing the trip's routes, tracks or waypoints. Removing an
   itinerary SHALL be undoable.
3. THE trip's end date SHALL be derived from the timeline, not entered
   separately, so the two cannot disagree.
4. THE library tree SHALL show a scheduled trip's date range as secondary
   text, using the existing `TreeNode.detail` field.
5. Archiving a scheduled trip SHALL keep its itinerary intact.

### Requirement 2: Stops and durations

#### Acceptance criteria

1. An itinerary SHALL be an ordered list of stops, with a start stop and an end
   stop. The start and end MAY be the same place, so a round trip is a loop.
2. A stop SHALL reference a location in the trip, either an existing waypoint
   or a new one created for it. The itinerary SHALL NOT keep a second copy of
   the coordinates.
3. Each intermediate stop SHALL have a duration in **hours** (with minute
   precision) or in **days** (a whole number of days).
4. A day-stay SHALL also have a departure time of day, defaulting to a
   user-set setting (e.g. 09:00). The user SHALL be able to change it per
   stop.
5. A stop SHALL accept an optional fixed time, such as "arrive by 15:00" or
   "depart at 10:30". WHERE a fixed time conflicts with the timeline THE system
   SHALL show the conflict and SHALL NOT silently move the fixed time.
6. THE user SHALL be able to add, remove and reorder stops. Each change SHALL be
   undoable, using the existing command and batch-undo machinery (ADR 0014).
7. Stop notes SHALL be plain text, like every other notes field.

### Requirement 3: Legs and the timeline

#### Acceptance criteria

1. Each leg SHALL be linked to a route in the trip. A leg with no route SHALL
   show as unplanned. Its driving time SHALL be unknown, not zero, and every
   later time SHALL show as unknown too.
2. Leg driving time SHALL come from the routing engine's estimate for that
   route when one exists. Otherwise it SHALL come from distance and a planning
   speed. Either way it SHALL be labelled an estimate, per ADR 0011 §8.
   *Amended at design:* no saved route stores an engine estimate (ADR 0011
   §8), so every leg is timed from distance and the per-mode average in
   `shared/routing/travelTime.ts`, and the UI names the speed used.
3. THE planning speed used for road trips SHALL suit the travel mode. The
   current 4.5 km/h default SHALL NOT be used to time a driving leg.
4. Arrival at a stop SHALL be the previous departure plus the leg's driving
   time. Departure SHALL be arrival plus the duration, for an hours stop, or
   the departure time on the date N days later, for a day-stay.
5. THE timeline SHALL be derived, SHALL be recomputed whenever a stop, a
   duration or a linked route's geometry changes, and SHALL NOT be the only
   copy of anything, per the derived-values rule in
   `.kiro/steering/architecture.md`.
6. THE user SHALL be able to set a maximum driving time per day. Days over it
   SHALL be flagged, and the system SHALL NOT re-plan the trip to fix them.
7. WHERE a day-stay's departure would come before its arrival (e.g. arriving
   at 11:00 on the last day, with a 09:00 departure time) THE system SHALL flag
   it rather than wrap to the next day.
   *Amended at design:* a day-stay is a whole number of days, at least one,
   counted from the arrival date, so it always leaves on a later date than it
   arrives and cannot depart first. The case a user can hit is a fixed
   departure on an hours stop that is earlier than the arrival. That is
   flagged, and the time is not wrapped. See design §14.
8. Times SHALL be shown in the local time of the stop they belong to. WHERE a
   leg crosses a time-zone boundary, or a stay spans a daylight-saving change,
   THE timeline SHALL stay correct and SHALL show the change. Hours durations
   SHALL be elapsed time; day-stays SHALL be wall-clock dates.
9. Time-zone lookup SHALL work offline.

### Requirement 4: Calendar view

#### Acceptance criteria

1. A scheduled trip SHALL be viewable as a calendar with at least **day**,
   **week** and **month** views.
2. THE calendar SHALL show driving legs and stops as distinct blocks, with
   driving time, stop name and duration on each.
3. Each day SHALL show a summary: driving distance, driving time, and where
   the night is spent.
4. Selecting a block in the calendar SHALL select the matching route or
   waypoint on the map and in the properties panel, using the existing
   selection store. Selecting a stop on the map SHALL show it in the calendar.
5. THE user SHALL be able to change a stop's duration from the calendar, for
   example by dragging the end of a block. It SHALL go through the same
   undoable command as editing it in the properties panel.
6. Times that depend on an unknown leg SHALL be shown as unknown in the
   calendar, not placed at a guessed position.
7. THE calendar SHALL be built in-house or from a dependency that passes the
   licence check in `.kiro/steering/licensing.md`. It SHALL be usable at both
   desktop and narrow window widths.
8. THE calendar SHALL honour the app's light and dark themes and the user's
   unit setting.

### Requirement 5: POI data source

#### Acceptance criteria

1. **Offline first.** WHEN a region is downloaded or imported THE system SHALL
   extract POIs in the supported categories from the same `.osm.pbf` before it
   is deleted, and SHALL store them locally as a POI snapshot. The design SHALL
   measure the snapshot size for the three-county Buxton set and SHALL state
   it.
2. POIs mapped as areas (many hotels, fuel stations and supermarkets are
   building outlines, not points) SHALL be included as a representative
   point. They SHALL NOT be dropped because they are not nodes.
3. THE snapshot SHALL record the date of the extract it came from, and the UI
   SHALL show that date wherever POIs are listed.
4. Rebuilding or replacing the routing regions SHALL rebuild the snapshot in
   the same pass. Regions loaded before this phase SHALL be flagged as having
   no POI data, with a one-press rebuild. They SHALL NOT be shown as having no
   POIs.
5. **Online search is optional and off by default.** IF an online source is
   offered (e.g. an Overpass API instance) THEN it SHALL need explicit opt-in.
   The opt-in SHALL name the service and say what is sent: the route corridor,
   which reveals where the user plans to go. It SHALL respect that service's
   usage policy and rate limits, and SHALL be added to the CSP deliberately,
   not by widening `connect-src`.
6. POI search SHALL work fully with no network connection, using the
   snapshot.
7. THE mapping from OSM tags to POI categories SHALL be defined in one place
   in `src/shared/`, with the reasoning for each tag.

### Requirement 6: Finding POIs along a route

#### Acceptance criteria

1. THE user SHALL be able to search for POIs along a route, or along the whole
   itinerary, by category. At minimum: **accommodation** (hotel, motel, guest
   house, hostel, campsite), **fuel**, **EV charging**, **food and drink**,
   **attractions and viewpoints**, **parking**, **toilets**, **supermarkets**,
   and **vehicle services**.
2. THE corridor width SHALL be user-selectable, with at least 0.5, 1, 2, 5 and
   10 km options.
3. Results SHALL be listed in the order they are reached along the route. Each
   SHALL show its distance from the start and its straight-line distance off
   the route. For a scheduled trip it SHALL also show the day and the
   estimated time it is reached.
4. THE user SHALL be able to limit a search to a section of the route: between
   two distances, within one itinerary day, or near a chosen point (for
   example "hotels within 10 km of where day 2 ends").
5. WHERE the user asks for it THE system SHALL compute the real road detour to
   a POI with the routing engine, and SHALL label it an estimate. Straight-line
   off-route distance SHALL NOT be presented as a detour.
6. Results SHALL be shown on the map as a separate layer, with a category
   symbol, clustered at low zoom, and toggled like the existing layers.
7. Corridor geometry SHALL be computed by pure functions in `src/shared/geo/`,
   unit-testable without Electron.
8. Search over a 500 km route SHALL NOT block the UI, and SHALL be
   cancellable.

### Requirement 7: POI details and honesty

#### Acceptance criteria

1. A POI SHALL show its name, category and any of these OSM attributes that are
   present: address, phone, website, opening hours, brand, star rating, and
   fuel types or charging connectors.
2. Every attribute SHALL be treated as untrusted plain text. A website SHALL
   open only through `shell.openExternal` after the existing scheme and host
   validation.
3. WHERE opening hours can be parsed THE system SHALL say whether the POI is
   expected to be open at the planned arrival time. Opening hours that cannot
   be parsed SHALL be shown as raw text and SHALL NOT be guessed at.
4. A missing attribute SHALL be shown as absent, not defaulted. A fuel station
   with no opening hours is not "open 24 hours".
5. An empty result SHALL say "no <category> mapped in OpenStreetMap within
   <distance>", along with the snapshot date. It SHALL NOT say there are none.
6. THE system SHALL NOT show prices, room availability, ratings from other
   sites or booking links. See Out of scope.
7. OpenStreetMap attribution SHALL be shown wherever POI data is displayed.

### Requirement 8: Adding a POI to the trip

#### Acceptance criteria

1. THE user SHALL be able to add a POI to the trip as a waypoint, or as an
   itinerary stop (which creates the waypoint as well).
2. THE waypoint SHALL take the POI's name and coordinates, a symbol mapped from
   its category through `src/shared/domain/symbols.ts`, and a plain-text
   description built from its attributes.
3. THE waypoint SHALL record where it came from (the OSM element type and id,
   and the snapshot date) so it can be traced, and so a later version can
   offer to refresh it. Its `source` SHALL be distinct from a hand-placed
   waypoint.
4. Adding a POI as a stop between two others SHALL offer to re-route the
   affected leg through it, using the existing snapping and shaping-point model
   (Phase 6). It SHALL NOT edit the route silently.
5. Adding, and re-routing through, a POI SHALL each be undoable.

### Requirement 9: Fuel range check

#### Acceptance criteria

1. THE user SHALL be able to set a vehicle range in the trip or in settings,
   and SHALL be able to leave it unset. Unset means no check runs. It does not
   mean unlimited range.
2. WITH a range set THE system SHALL flag every stretch of the itinerary longer
   than that range with no mapped fuel station within the corridor. The
   corridor width SHALL be shown alongside the warning.
3. THE check SHALL allow for a user-set reserve (default e.g. 20%).
4. THE warning SHALL carry the honesty caveat from Requirement 7.5. It SHALL
   NOT claim the stretch has no fuel.
5. THE check SHALL handle EV charging the same way, using the charging category,
   when the trip's vehicle is set to electric.

### Requirement 10: Export

#### Acceptance criteria

1. A scheduled trip SHALL export to **iCalendar** (`.ics`, RFC 5545): one
   event per stop and, optionally, per driving leg, with correct time zones.
   Times derived from unknown legs SHALL be left out, and the export SHALL say
   so.
2. THE GPX export of a scheduled trip SHALL write stops as waypoints in
   itinerary order, and the routes in leg order, through the existing GPX
   writer with no new extensions.
3. Planned times SHALL NOT be written as GPX `<time>` elements. In GPX those
   mean recorded time, and a device or app would read a plan as a recording.
4. Itinerary fields GPX cannot carry (duration, fixed times, day-stays) SHALL
   be reported as unmapped on export, following the Phase 3 precedent.
5. Importing iCalendar is out of scope.

### Requirement 11: Postcode and place search (offline)

The owner asked for address and postcode lookup, and for it to stay offline.
Every search is answered from data on this machine. There is no online
fallback, so the CSP does not change for search.

#### Acceptance criteria

1. THE map SHALL have a search box that accepts a UK postcode, a place name
   (city, town, village, hamlet or named locality), a street name with or
   without a town, or the name of a POI in the snapshot. Results SHALL appear
   as the user types.
2. Choosing a result SHALL centre the map on it and mark it. It SHALL then
   offer: add as a waypoint, start a New Route here, and, for a scheduled
   trip, add as a stop. None of these SHALL happen without that choice.
3. **Offline only.** No search text and no result SHALL leave the machine.
   THE system SHALL NOT offer an online geocoder, and SHALL NOT widen
   `connect-src` for search. Search SHALL work with no network connection.
4. **Postcodes** SHALL come from Ordnance Survey **Code-Point Open**, under
   the Open Government Licence v3.0. Entry SHALL ignore case and spacing:
   `de451aa`, `DE45 1AA` and `de45  1aa` are the same postcode.
5. A full postcode SHALL resolve to its postcode centre. The result SHALL be
   labelled as the postcode's centre, not as an address, because one postcode
   can cover several streets.
6. A partial postcode (an outcode such as `DE45`, or a sector such as
   `DE45 1`) SHALL resolve to the area it covers, labelled approximate. It
   SHALL NOT be shown as a single address.
7. A postcode that is well formed but not in the data SHALL say "not found in
   the postcode data dated <date>". It SHALL NOT be replaced with a nearby
   postcode. A malformed entry SHALL be treated as a place-name search, not
   rejected.
8. **Coverage SHALL be stated.** Code-Point Open covers Great Britain only. A
   Northern Ireland (`BT`), Isle of Man (`IM`), Jersey (`JE`) or Guernsey
   (`GY`) postcode SHALL produce a message saying that area's postcodes are
   not included. It SHALL NOT say "not found".
9. THE postcode data SHALL be obtained with one press from Settings, with its
   size shown before it is fetched, the same pattern as map regions. It SHALL
   then be stored locally, with its release date shown in Settings and in
   search results. Re-fetching a newer release SHALL replace it in one step.
   Fetching it is the only network action in this requirement, and it is
   taken by the user.
10. **Places and streets** SHALL be captured from the OpenStreetMap extract
    during the region build, in the same pass as the POI snapshot
    (Requirement 5.1), before the extract is deleted. That covers `place=*`
    features, named roads, and `addr:*` tags where they are present. A road
    mapped as many ways SHALL appear once per street per settlement, not once
    per way.
11. Place and street search SHALL cover the loaded map regions only. WHEN it
    finds nothing THE system SHALL name the loaded regions, so "no match"
    reads as "not in your regions" and not as "does not exist". Postcode
    search covers all of Great Britain regardless of the loaded regions.
12. **House numbers.** WHERE OpenStreetMap has a building with that
    `addr:housenumber` and `addr:street`, a full address SHALL resolve to that
    building. Otherwise it SHALL fall back to the street, and the result SHALL
    say that only the street was matched. THE system SHALL NOT interpolate a
    house number along a street, because a position invented between two
    numbers looks exact and is not.
13. Results SHALL be ranked with an exact postcode first, then places by kind
    (city, town, village, hamlet) and distance from the map centre. Names that
    occur more than once (there are many places called Newtown) SHALL show
    their county, so the user can tell them apart.
14. Matching SHALL ignore case and punctuation, SHALL match from the start of
    a word as the user types, and SHALL treat common abbreviations as their
    full form (`St` / `Street`, `Rd` / `Road`).
15. Data from Ordnance Survey SHALL carry the attribution its licence
    requires, including the Royal Mail and National Statistics statements
    that Code-Point Open specifies. OpenStreetMap-derived names SHALL carry
    OpenStreetMap attribution. Both SHALL appear in the About window and
    beside search results, and both datasets SHALL be added to the
    third-party register.
16. Names and addresses SHALL be rendered as plain text.
17. Postcode parsing and normalisation SHALL be pure functions in
    `src/shared/`. Search SHALL sit behind an interface in `src/shared/`, like
    `MapProvider` and `RoutingProvider`, with the index in `src/main/`. Trip
    management SHALL NOT reference a concrete search source.

### Requirement 12: Security, privacy and licensing

#### Acceptance criteria

1. No route, corridor or location data SHALL leave the machine unless the user
   has opted in to an online POI source, per Requirement 5.5.
2. POI data derived from OpenStreetMap SHALL meet ODbL attribution
   requirements. The design SHALL state whether the local snapshot or exported
   waypoints form a derivative database, and what follows from that.
3. Any new dependency (calendar, iCalendar writer, opening-hours parser, POI
   icons) SHALL pass the licence check and be added to the third-party register
   in the same change.
4. Imported POI text SHALL be rendered as text, never as HTML.
5. THE application SHALL remain fully functional for all existing features with
   no network connection.

### Requirement 13: Testing

#### Acceptance criteria

1. Unit tests SHALL cover timeline arithmetic: hours stops, day-stays, fixed
   times and their conflicts, unknown legs propagating forward, the daily
   driving cap, and a stay across the UK clock change (BST ends 25 October
   2026).
2. Unit tests SHALL cover corridor search: distance along route, off-route
   distance, section limits, ordering, and an empty result.
3. Unit tests SHALL cover the fuel range check: a stretch flagged, a stretch
   cleared by a station, unset range running no check, and the reserve.
4. Tests SHALL cover POI extraction from an extract, including a POI mapped as
   an area.
5. Geography-dependent fixtures SHALL use the Buxton square from
   `@fixtures/places`. POI fixtures SHALL be resolved against OpenStreetMap,
   not invented, per the "do not guess a coordinate" rule.
6. Tests SHALL assert that a trip with no itinerary is unchanged in the tree,
   the properties panel, and GPX export.
7. iCalendar output SHALL be checked against RFC 5545 structure, including
   time-zone components.
8. End-to-end tests SHALL cover building an itinerary, viewing it as a
   calendar, finding fuel and a hotel along a route, adding the hotel as a stop,
   and restarting the app with everything intact.
9. Unit tests SHALL cover postcode normalisation and classification: spacing
   and case, full postcodes, outcodes and sectors, malformed entries falling
   through to place search, and the `BT`, `IM`, `JE` and `GY` coverage
   messages.
10. Unit tests SHALL cover place search: prefix matching, abbreviations,
    ranking, a name that occurs in two counties, a house number that resolves
    to a building, and one that falls back to its street.
11. Gazetteer fixtures SHALL use the Buxton square. Postcode fixtures SHALL be
    a small excerpt of the real Code-Point Open release, committed with its
    attribution, and SHALL NOT be invented. Place and street fixtures SHALL be
    resolved against OpenStreetMap.
12. An end-to-end test SHALL search for a postcode and for a place with all
    network access blocked, centre the map on each, and add one as a
    waypoint.

## Feedback after the first build (11 November 2026)

The owner used the built phase and asked for four changes. They are added as
Requirements 14–17 rather than folded into the earlier ones, so the record
shows what was built first and what changed after.

### Requirement 14: The trip in the library summarises it

The library tree is where a trip is found and recognised. For a dated trip it
should say what the plan is, not only list what the trip contains.

#### Acceptance criteria

1. A scheduled trip's row SHALL show its dates, its number of days and its
   total planned distance, e.g. "23–25 Oct 2026 · 3 days · 98 km". A distance
   that is partly unknown SHALL be marked as such, not shown as a total.
2. A scheduled trip's children SHALL follow the plan: one group per day, each
   holding that day's stops and drives in the order they happen, with their
   local times. Selecting a stop SHALL select its waypoint; selecting a drive
   SHALL select its route.
3. Routes, tracks and waypoints of a scheduled trip that are not in the plan
   SHALL still be listed, after the days, under a group that says they are not
   in the plan. Nothing in the trip SHALL disappear from the tree.
4. A stop or drive whose time is unknown SHALL be listed under an "Unknown
   times" group in plan order, not placed on a guessed day.
5. A trip with no itinerary SHALL be shown exactly as before
   (Requirement 1.1).

### Requirement 15: Stops are joined by road automatically

#### Acceptance criteria

1. Each leg SHALL have a mode: **by road** (the default), **a chosen route**,
   or **other transport** ("don't link").
2. WHEN stops are added, removed or reordered, or a stop's place moves, THE
   system SHALL plan every by-road leg that has no route, or whose route no
   longer joins its two stops, with the routing provider, save the route and
   link it. The structural change and the planning SHALL be one undoable step.
3. A route the system planned this way SHALL be recorded as planned for the
   itinerary. WHEN it no longer joins its stops THE system SHALL replace it,
   and the replacement SHALL be undoable. A route the user drew, imported or
   chose SHALL never be modified or deleted by this.
4. WHERE no routing provider is available THE system SHALL leave the leg
   unplanned and SHALL say why (for example, "No map regions cover this
   drive"), rather than drawing a straight line that looks planned.
5. An **other transport** leg SHALL take a kind (ferry, train, flight, or
   other, with a free-text label) and an optional travel time. With a time it
   SHALL be timed by that; without one its arrival and every later time SHALL
   be unknown. It SHALL NOT be searched for POIs or counted as driving, and the
   range check SHALL treat it as a stretch it cannot check.
6. Choosing a route by hand SHALL switch that leg to **a chosen route**;
   choosing **by road** again SHALL return it to automatic planning.

### Requirement 16: Panels resize and hide

#### Acceptance criteria

1. The panel below the map (profile, calendar, places along the route) SHALL
   be resizable in height by dragging its top edge, and SHALL remember its
   height between sessions.
2. The library (left), properties (right) and the panel below the map
   (bottom) SHALL each have a visible control to hide and show it, and their
   state SHALL persist.
3. Hiding a panel SHALL give its space to the map. Resizing SHALL keep a
   minimum size for the map, so it can never be squeezed to nothing.
4. The controls SHALL be usable from the keyboard and named for screen
   readers.

### Requirement 17: Icon buttons with hints

#### Acceptance criteria

1. Action buttons in the trip, route, itinerary, calendar, along-the-route
   and search panels SHALL be compact icon buttons.
2. Each SHALL show a hint naming its action when hovered or focused, and
   SHALL carry that name as its accessible label. An icon with no name is not
   acceptable.
3. A one-off call to action whose meaning an icon cannot carry ("Plan by
   date", "Download") MAY stay as text.
4. Icons SHALL come from an open-source set whose licence passes the check in
   `.kiro/steering/licensing.md`, recorded in the register.

## Non-functional requirements

1. **No regression.** Every existing test still passes, and `npm run verify`
   stays green.
2. **Search is instant.** Results for each typed character SHALL appear
   within 100 ms on the three-county Buxton region set plus all of Great
   Britain's postcodes. The design SHALL measure this, and the size of the
   gazetteer, and state both.
3. **Module boundaries hold.** Timeline maths and corridor geometry are pure
   and live in `shared/`. POI extraction and storage live in `main/`. The
   renderer reaches them only through the preload bridge. Trip management does
   not reference a concrete POI source. A `PoiProvider` interface sits in
   `shared/`, like `MapProvider` and `RoutingProvider`.
4. **Errors cross IPC as results, never exceptions.**
5. **No new dependency without a licence check** recorded in the register.
6. **Missing stays missing.** Unknown driving times, absent attributes and
   unchecked fuel ranges are shown as unknown, never as zero, open, or fine.

## Out of scope

- **Hotel booking, prices and room availability.** Every source needs a
  commercial API with an account, an API key and terms that restrict use and
  redistribution. That breaks the no-account, no-cloud-dependency policy in
  ADR 0007. The app can show the hotel's own website from OSM, and nothing
  more.
- **Live fuel prices.** The UK has been moving towards a statutory open
  fuel-price data scheme. Whether a usable, licence-compatible feed exists
  that the app can read offline is a question for the design stage, not a
  requirement of this phase.
- **Traffic-aware timing.** Driving times are the engine's free-flow
  estimates.
- **Automatic itinerary generation**, such as "plan me five days around the
  Peak District". The user builds the plan; the app does the arithmetic and
  the searching.
- **Sharing or syncing an itinerary between people.** Export covers sharing.
- **Online geocoding.** The owner chose offline only. Nominatim, Photon and
  postcodes.io are all left out, including as an opt-in.
- **Complete house-number coverage.** The one complete UK address list, OS
  AddressBase, is paid and licensed per use, which ADR 0007 rules out. Search
  matches house numbers only where OpenStreetMap maps them (Requirement
  11.12).
- **Reverse lookup**: clicking the map to get an address. The gazetteer could
  support it later; nobody has asked for it yet.

## Unresolved questions for the design stage

1. **Legs and routes.** Is each leg its own route, or is the itinerary one
   multi-stop route whose stops are shaping points (ADR 0017)? One route per
   leg fits a per-day calendar and a per-leg re-route. One route fits how a
   device navigates a whole day. The answer decides the storage.
2. **Where do POI snapshots live?** In the main SQLite database, keyed to the
   loaded regions, or in a separate file beside the routing tiles that is
   replaced when they are? The second keeps the library database small, and
   ties POIs to the graph they were built with.
3. **Online POI source: include it at all?** Offline from the snapshot covers
   the UK regions. An Overpass option adds a network path, a consent flow and a
   usage-policy obligation for the cases a snapshot cannot cover, such as a
   route outside the loaded regions. It could be left out until it is asked
   for.
4. **Time-zone data.** Ship `timezones.sqlite` with the routing tiles, which
   Valhalla already supports, or bundle a small boundary dataset in `shared/`.
   For a UK-only region set, every stop is Europe/London, but the design
   should not hard-code that.
5. **Planning speed.** Replace the single `planningSpeedKmh` with per-mode
   defaults (shared with the Phase 8 question), or rely on the engine's leg
   times and use the planning speed only for legs without a route.
6. **Should the calendar be its own pane, or a mode of the map area?** This is
   a layout decision that touches `PanelLayout`.
7. **OS Open Names for places outside the loaded regions?** It is a free
   Ordnance Survey gazetteer of places, roads and postcodes for all of Great
   Britain, under the same licence as Code-Point Open. It would make place
   search work before any region is downloaded, at the cost of a second, much
   larger download. Requirement 11.11 currently limits place search to the
   loaded regions instead.
8. **Bundle the postcode data, or fetch it?** Requirement 11.9 fetches it on
   request. Bundling would make search work on first launch, but would put
   the dataset in every installer and need an app release for each refresh.
   The design should measure it before deciding.
9. **Northern Ireland postcodes.** Is there a source whose licence is
   compatible with GPL-3.0 redistribution? If not, Requirement 11.8 stands and
   `BT` postcodes stay unsupported, with that said in the UI.
