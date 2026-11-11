# Phase 10: Road Trip Planning — Design

Written against the code after Phase 7, with the uncommitted Phase 7 follow-up
work (`shared/routing/travelTime.ts`, the profile drawer target) in the tree.
ADR 0019 records the decisions that are more than implementation.

**Built out of order.** The owner asked for this phase to be built on
10 November 2026, ahead of Phases 8 and 9. It depends only on Phases 4 and 7,
which are complete, so nothing it builds on is unfinished. The README's rule
against designing ahead exists to stop guessing at unsettled interfaces; the
interfaces this phase uses are all shipped.

## 0. Measurements

Taken on 10 November 2026 against real data. They settle the storage questions
before any code is written.

**Region data.** Derbyshire, Cheshire and Staffordshire from Geofabrik (44, 39
and 31 MB), merged with the bundled `osmium` 1.19.1:

| Step | Time | Output |
| --- | --- | --- |
| `osmium merge` | 1.6 s | 113 MB `.osm.pbf` |
| `osmium tags-filter` (POI, place, highway, `addr:housenumber`) | 1.6 s | 47 MB |
| `osmium export -f geojsonseq` | 4.1 s | 1,219,532 features, 459 MB (streamed, never kept) |
| Ingest into SQLite (prototype) | 3.7 s | see below |

Kept after ingest: 35,567 POIs, 2,588 places, 64,428 street rows (39,303 street
names, one row per name per settlement), 574,150 addressed buildings. On disk:
POIs 10.0 MB, addresses 23.9 MB, streets 3.1 MB, search tokens and index
6.2 MB — **about 43 MB for the three counties**, against a 141 MB routing
graph for the same set. The design trims POI tags to the attributes in
Requirement 7.1, so production should come in below that.

**Measured again once built (task 11).** The production extract and ingest on
the same three counties: `osmium` filter and export 5.4 s, ingest 3.2 s, peak
memory about 300 MB, **37.9 MB** on disk. It keeps 26,388 POIs (private and
unnamed kerbside parking excluded), 2,587 places, 62,151 streets and 300,963
addressed buildings. The prototype's 574,150 addresses had counted every
building twice, once as a line and once as an area, which is the duplication
in fact 1 below. Addresses are written as they stream past rather than held,
so memory does not grow with them.

**Postcodes.** Code-Point Open, release 2026-11 (copyright date 19 October
2026): `codepo_gb.zip`, 14.5 MB, no API key, MD5 published in the OS downloads
listing. 120 CSV files, 1,749,385 postcodes. Ingest 1.9 s. Stored as
postcode → lat/lon: **32.6 MB**.

**Search latency.** Prefix lookups on an indexed token table (`tok >= ? AND
tok < ? || '\uffff'`) plus a postcode prefix query: 0.04–0.29 ms per keystroke
on the combined set. The 100 ms budget (non-functional requirement 2) is spent
on IPC and rendering, not the query.

**Measured again once built (task 13)**, with `npm run verify:search`: the
production ingest of all 1,749,385 postcodes takes 3.5 s and stores 51.2 MB.
Postcodes are kept in their spaced form, which costs more than the
prototype's compact keys and buys exact outcode prefixes. Across every
keystroke of seven typed phrases (postcodes, streets, house numbers and
places) against that plus the three-county place data, the **worst was
12.4 ms** in the search service.

**Two facts about the data** that the design has to handle:

1. `osmium export` emits every closed way **twice**: once as a LineString and
   once as a (Multi)Polygon. Buxton's Palace Hotel (`way/117882931`) appears in
   both forms. Ingest deduplicates by `type/id` and keeps the area.
2. 888 Code-Point postcodes have positional quality **90** and coordinates
   `0, 0`. They are real postcodes with no location. They are stored and
   reported as "has no location in the postcode data". Plotting them at 0, 0
   would put a Scottish postcode off the coast of Ghana.

## 1. Invariants this phase collides with, and how each is resolved

| Invariant | Collision | Resolution |
| --- | --- | --- |
| Derived values are caches (architecture.md) | A timeline looks like stored data | Only inputs are stored: start date/time, stops, durations, fixed times, leg links. The timeline is computed on every read by a pure function (§3) and never written |
| Missing stays missing | Unlinked legs, unknown zones, unparsed hours | `null` throughout. An unknown leg makes every later time `null`, a zone not in the table is reported as unknown, and unparsed opening hours are shown raw |
| Engine durations stay out of stored data (ADR 0011 §8) | Requirement 3.2 asks for the engine's leg time | No engine time is stored on a saved route, deliberately. Legs are timed by `travelTime.travelSpeedKmh` for the route's mode, the module Phase 7 added for exactly this. Requirement 3.2's fallback branch is therefore the only branch, and the UI says which speed was used |
| No cloud dependency for core functionality (ADR 0007) | POIs and search need data | Both are built on this machine from data the user fetches once: the region extract already being downloaded, and Code-Point Open. Nothing is queried remotely. No online POI source is offered (§6.4) |
| Imported data is untrusted | OSM tags become UI text | Rendered as text nodes only; `website` goes through the existing `openExternal` allowlist |
| No generic IPC passthrough | Many new calls | One namespace per area (`itinerary`, `places`, `search`), each method named, each with a zod schema |
| Every mutation is undoable or says why not | Itinerary edits, POI-to-stop, re-routing | Every itinerary command returns an inverse. Compound actions (add POI as stop, re-route through a stop) are `batch` commands, so one ⌘Z unwinds them (ADR 0014) |
| `connect-src 'self'` | Postcode download | The renderer never fetches. The main process downloads from `api.os.uk`, following exactly one named cross-origin redirect (§7.2). The CSP does not change |
| Module boundaries | Trip management must not know a concrete POI or search source | `PoiProvider` and `PlaceSearchProvider` interfaces in `shared/`; `itineraryService` imports neither concrete implementation |

## 2. The itinerary model

### 2.1 Legs are routes, one per leg

Unresolved question 1 is settled for **one route per leg**:

- The calendar is per day, and a day is one or more legs. A leg that is a
  section of a longer route would need a "from control point *i* to *j*"
  reference, and Phase 6 has shown that control-point indices move under
  shaping edits.
- Re-routing one leg through a new stop becomes "create two routes", never
  "edit a route" (§9.3). That satisfies Requirement 8.4's "SHALL NOT edit the
  route silently" by construction.
- A device that navigates a whole day still gets the day: GPX export writes
  the routes in leg order (§10.2).

### 2.2 Storage — migration `0004_itinerary.sql`

```sql
CREATE TABLE itineraries (
  trip_id            TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  start_date         TEXT NOT NULL,      -- 'YYYY-MM-DD', wall clock
  start_time         TEXT NOT NULL,      -- 'HH:mm', wall clock at the first stop
  default_depart     TEXT NOT NULL DEFAULT '09:00',
  max_drive_minutes  INTEGER,            -- null: no daily cap
  range_km           REAL,               -- null: no range check (Req 9.1)
  reserve_pct        INTEGER NOT NULL DEFAULT 20,
  energy             TEXT NOT NULL DEFAULT 'fuel',   -- 'fuel' | 'electric'
  created_at, updated_at
);

CREATE TABLE itinerary_stops (
  id                TEXT PRIMARY KEY,
  trip_id           TEXT NOT NULL REFERENCES itineraries(trip_id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  waypoint_id       TEXT NOT NULL,       -- no FK, see below
  leg_route_id      TEXT,                -- route of the leg ARRIVING here; no FK
  duration_kind     TEXT NOT NULL,       -- 'hours' | 'days'
  duration_minutes  INTEGER,             -- hours stops
  duration_days     INTEGER,             -- day-stays
  depart_time       TEXT,                -- day-stays: 'HH:mm'; null uses default
  arrive_by         TEXT,                -- 'HH:mm' check
  depart_at         TEXT,                -- 'HH:mm' fixed departure, hours stops
  notes             TEXT,
  created_at, updated_at
);
```

**Why the stop does not foreign-key its waypoint or route.** A cascade would
delete the stop when its waypoint is deleted, and undoing the waypoint
deletion (`waypoint:restore`, which reuses the id) would not bring the stop
back. A `SET NULL` would keep the stop but lose the link for good. With a
plain id, a deleted waypoint shows as "location deleted", and undo heals the
link automatically because the id comes back. The same applies to
`leg_route_id` and `route:restore`. This follows the "no orphan surprises"
reading of ADR 0001.

**The first stop** has no arriving leg and no duration that matters; its
`duration_kind` is stored as `hours` with `0` minutes. The last stop's
duration is ignored for the same reason. The start and end may be the same
waypoint, so a loop needs no special case.

**Removing an itinerary** (Requirement 1.2) deletes the `itineraries` row and
cascades the stops. Its inverse, `itinerary:restore`, carries the full
snapshot: one row and at most a few dozen stops. It is bounded (§2.4), so
removal is undoable. Waypoints and routes are untouched.

### 2.3 Fixed times

Both are wall-clock times on a specific date, so they cannot drift:

- **`arrive_by`** is a check. A conflict is raised when the computed arrival
  is later than `arrive_by` on the arrival date. Nothing moves.
- **`depart_at`**, on an hours stop, fixes departure to that time on the
  arrival date. You wait if early. A conflict is raised if arrival plus the
  stop's duration is later; the departure stays at `depart_at`, as
  Requirement 2.5 requires.
- A **day-stay** already has a departure time, so `depart_at` is not offered
  for one.

### 2.4 Bounds

At most **100 stops** per itinerary, enforced by the schema. That bounds the
restore payload and keeps the calendar readable. It is far beyond the length
of any road trip a person plans by hand.

## 3. Time

### 3.1 `shared/time/zoned.ts` (pure)

There is no date library in the project and none is needed. `Intl` with full
ICU is present in both Node 26 and Electron 45:

- `zoneOffsetMs(utcMs, zone)` from `Intl.DateTimeFormat(…).formatToParts`
- `wallClockToUtc({ date, time }, zone)` solves for the instant. In a
  **spring-forward gap**, a time that does not exist moves forward by the gap.
  In an **autumn overlap**, the earlier instant is chosen. Both are
  deterministic and tested.
- `utcToWallClock(utcMs, zone)` → `{ date, time, offsetMinutes }`
- `addDays(date, n)` on `YYYY-MM-DD` strings, with no time involved, so
  daylight saving cannot touch it

An hours duration is elapsed time: `departure = arrival + minutes`. A day-stay
is wall-clock: `departure = wallClockToUtc(addDays(arrivalLocalDate, n),
departTime)`. A stay across 25 October 2026, when BST ends, therefore leaves at
09:00 GMT on the right morning. A 48-hour block would leave at 08:00.

### 3.2 `shared/time/timeZones.ts` (pure) — offline zone lookup

`TimeZoneResolver = (point) => string | null`. The default resolver tests a
small table of polygons:

| Polygon | Zone | Source |
| --- | --- | --- |
| `UK_BOUNDARY` (existing, 150 points) | `Europe/London` | Geofabrik `united-kingdom`, already in `shared/geo/ukBoundary.ts` |

Every region the picker offers is in the UK, apart from "Ireland and Northern
Ireland", whose Northern Ireland part is inside `UK_BOUNDARY`. A point outside
every polygon resolves to **`null`**. The timeline then shows that stop's times
in the computer's own zone, labelled "time zone unknown here — shown in
<zone>". Times are not silently assumed to be London's (unresolved
question 4). Adding a country is a new row in the table, not a code change.
Valhalla's `timezones.sqlite` was rejected: building it downloads the
timezone-boundary-builder release (about 60 MB), which is a network
dependency for a 2-line answer in the UK.

The **calendar zone** is the first stop's zone (or the computer's, if
unknown). Days are laid out on that zone's dates. A stop in another zone shows
its own local time and offset beside it (Requirement 3.8).

### 3.3 `shared/itinerary/timeline.ts` (pure)

```ts
computeTimeline(input: TimelineInput, resolveZone: TimeZoneResolver): Timeline
```

`TimelineInput` holds the itinerary row, the stops in order, each with its
resolved waypoint position (or `null` if deleted) and its leg:
`{ routeId, distanceM, mode } | null`. The output gives each stop
`arrival`, `departure` (UTC ms or `null`), its zone, its local wall clock, and
a list of flags:

| Flag | When |
| --- | --- |
| `unplanned-leg` | no linked route, or the route has no distance |
| `unknown-time` | an earlier leg is unplanned |
| `location-deleted` | waypoint id does not resolve |
| `arrive-by-missed` | §2.3 |
| `depart-at-too-early` | §2.3 |
| `zone-unknown` | §3.2 |

Requirement 3.7's "departure before arrival" flag is covered by
`depart-at-too-early`; see §14 for why a day-stay cannot produce it.

Leg driving time is `distanceM / travelSpeedKmh(mode, planningSpeedKmh)`. The
mode is the route's recorded `transport_mode`, or the settings mode for a
hand-drawn route. Walking legs therefore still use the planning speed, and a
driving leg never does (Requirement 3.3).

**Days.** `days[]` groups everything by local date in the calendar zone. Each
day has its driving distance, driving time (a leg counts on its departure
date), the stop where the night is spent (the stop you are at at local
midnight), and `over-daily-cap` when driving time exceeds
`max_drive_minutes`. Nothing is re-planned (Requirement 3.6).

**The end date** of the trip is the last stop's arrival date. It is derived,
never stored (Requirement 1.3), and is `null` when the last arrival is
unknown.

## 4. Itinerary service, commands and IPC

`main/services/itineraryService.ts`, following `waypointService`:

| Operation | Inverse |
| --- | --- |
| `create(tripId, start)` | `itinerary:remove` |
| `remove(tripId)` | `itinerary:restore` (snapshot) |
| `update(tripId, patch)` (start, default depart, cap, range, reserve, energy) | `itinerary:update` (previous values) |
| `addStop(tripId, { waypointId, at? , duration… })` | `itinerary:removeStop` |
| `removeStop(stopId)` | `itinerary:restoreStop` (row + position) |
| `moveStop(stopId, toIndex)` | `itinerary:moveStop` (previous index) |
| `updateStop(stopId, patch)` | `itinerary:updateStop` (previous values) |
| `linkLeg(stopId, routeId \| null)` | `itinerary:linkLeg` (previous) |

All are registered in `commands.ts` with labels ("itinerary edit", "stop
move", …). `get(tripId)` returns `ItineraryView`: the stored rows, the
resolved waypoints and legs, and `computeTimeline`'s output. It is computed
in the main process, which has the routes' distances and modes, and is sent
whole.

`addStop` validates that the waypoint belongs to the trip. `linkLeg` validates
that the route does. Moving a waypoint or route to another trip does not
cascade; the stop then shows `location-deleted` or `unplanned-leg`, because
from this trip's point of view that is what happened.

IPC namespace `itinerary`: `get`, `create`, `remove`, `update`, `addStop`,
`removeStop`, `moveStop`, `updateStop`, `linkLeg`, `planLeg` (§9.2),
`addPoiStop` (§9.1), `exportIcs` (§10.1). Each has a zod schema in
`shared/ipc/schemas.ts`. `HH:mm` and `YYYY-MM-DD` are validated as real times
and dates, not only by pattern.

**Library tree.** `libraryService` gives a scheduled trip `detail` = its date
range ("12–16 May 2027"), or "from 12 May 2027" when the end is unknown. A
trip with no itinerary gets no `detail`, exactly as now. That is a regression
test (Requirement 1.1).

## 5. Places: one build, three uses

### 5.1 Pipeline

`main/places/` is new and owns everything about place data:

```
region extract(s) ──► [merge] ──► extract.osm.pbf ─┬─► valhalla_build_tiles  (as now)
                                                   └─► osmium tags-filter
                                                       ─► osmium export geojsonseq
                                                       ─► ingest ─► places.sqlite
```

- `extract.ts`: two child processes, the same pattern and kill-on-abort
  handling as `mergeExtracts.ts`. The filter expression is generated from the
  category table (§6.1), so the table stays the one place a tag is named.
- `ingest.ts`: streams the GeoJSON lines; never holds the file. Writes
  `places.sqlite.tmp`, then renames over `places.sqlite` only once the graph
  build also succeeded. A failed or cancelled build leaves the previous
  snapshot in place alongside the previous graph.
- `downloadAndBuild` and the `.osm.pbf` import both run it, between the merge
  and the deletion in the existing `finally`. A new `BuildSteps.places` step
  keeps the orchestration testable offline, as the other steps are.
- Progress stage "Reading places" goes through the existing region progress
  events.

### 5.2 `places.sqlite`

Beside the tiles in `userData/valhalla/`. It is replaced when they are, so the
POIs always describe the same data as the graph (unresolved question 2). It is
a cache of the extract: rebuildable, not backed up, and not the only copy of
anything (the extract on Geofabrik is).

| Table | Columns | Notes |
| --- | --- | --- |
| `meta` | `key`, `value` | `extract_date` (from the PBF header `osmosis_replication_timestamp`, else the file's download date, labelled so), `regions` (names), `coverage` (region rings as JSON), `schema` |
| `poi` | `id`, `osm` (`node/123`), `category`, `name`, `lat`, `lon`, `attrs` (JSON of the Requirement 7.1 fields only) | index on `(lat, lon)` |
| `place` | `id`, `kind`, `name`, `county`, `lat`, `lon` | `place=*` nodes |
| `street` | `id`, `name`, `settlement`, `county`, `lat`, `lon` | one row per name per settlement |
| `address` | `id`, `street_key`, `number`, `name`, `lat`, `lon` | `addr:housenumber` + `addr:street` |
| `token` | `token`, `kind`, `ref` | index on `token`; kind 1 place, 2 street, 3 POI |

**Area POIs** (Requirement 5.2) take the centroid of their outer ring. A
centroid can fall outside an L-shaped building, but for "where is this hotel"
on a map that is metres. It is better than the first vertex, which is a
corner.

**One street per settlement** (Requirement 11.10): each named way is assigned
to its nearest `city|town|village|hamlet|suburb` node by equirectangular
distance. Ways with the same name and settlement collapse to one row, with the
vertex nearest their combined centre as the point.

**County** (Requirement 11.13): the Geofabrik region whose polygon contains
the feature, from the regions recorded in `meta`. A user-imported `.osm.pbf`
has no regions, so its features have no county, and duplicates are told apart
by settlement instead.

### 5.3 Regions built before this phase

`placesState()` reports `missing` when the graph exists but `places.sqlite`
does not. The POI panel and the search box then say "Place data was not built
with your regions" and offer **Rebuild regions**. That reruns
`downloadAndBuild` with `region.json`'s recorded `regionIds`
(Requirement 5.4). It never shows "no POIs". An imported-file graph records no
region ids, so it offers re-import instead.

## 6. Points of interest

### 6.1 `shared/poi/categories.ts`

The single tag table (Requirement 5.7). Each row: category id, label, the OSM
tags that select it, the waypoint symbol from `symbols.ts`, and a one-line
reason.

| Category | OSM tags | Symbol |
| --- | --- | --- |
| `accommodation` | `tourism=hotel,motel,guest_house,hostel,camp_site,caravan_site,chalet,apartment` | `lodging` (`campground` for camp/caravan sites) |
| `fuel` | `amenity=fuel` | `fuel` |
| `charging` | `amenity=charging_station` | `fuel` (no charging symbol exists; adding one would need a Garmin name, which has none for it) |
| `food` | `amenity=restaurant,cafe,pub,fast_food,bar` | `food` |
| `attractions` | `tourism=attraction,museum,viewpoint,gallery,zoo,theme_park,picnic_site`, `historic=castle,ruins,monument` | `viewpoint` |
| `parking` | `amenity=parking,motorcycle_parking` | `parking` |
| `toilets` | `amenity=toilets` | `pin` |
| `supermarket` | `shop=supermarket,convenience` | `pin` |
| `vehicle` | `shop=car_repair,motorcycle,tyres` | `pin` |

`parking` excludes `access=private` and `parking=underground`-only rows with
no name, which are 15,653 of the 35,567 in the measurement and would bury
every other result. `attrs` keeps only `addr:*`, `phone`/`contact:phone`,
`website`/`contact:website`, `opening_hours`, `brand`, `stars`, `fuel:*=yes`
and `socket:*`.

### 6.2 `shared/poi/openingHours.ts`

An in-house parser for the common subset: `24/7`; rules of weekday ranges and
lists (`Mo-Fr`, `Sa,Su`, `PH` ignored with a note); time ranges, including
past midnight (`18:00-02:00`); `off`; rules separated by `;`, later rules
overriding earlier ones for the days they name. Anything else returns
`unparsed`, and the raw text is shown (Requirement 7.3). The full
`opening_hours` grammar has seasons, sunrise and holidays; the library that
implements it was not adopted, because an unparsed answer shown raw is
honest, and a 30 kB dependency for the long tail is not needed.
`openAt(parsed, wallClock)` → `open | closed | unknown`.

### 6.3 Corridor search — `shared/geo/corridor.ts` (pure)

- `buildLineIndex(points)`: cumulative distance per vertex, plus a grid of
  segments in ~1 km cells (equirectangular metres around the line's mean
  latitude).
- `project(index, point, maxM)` → `{ alongM, offM }` or `null`: the nearest
  segment within `maxM`, using only the cells around the point.
- `corridorBox(points, widthM)` → the bounding box to query candidates with.
- `filterSection(results, { fromM, toM } | { near: point, radiusM })`.

The main process queries `poi` by the corridor box, projects each candidate,
keeps those with `offM ≤ width`, and sorts by `alongM`. For an itinerary, the
leg lines are concatenated in order, and each result also gets its leg, day and
estimated pass time from the timeline (`departure + alongWithinLeg / speed`).
A 500 km route at ~20,000 vertices projects ~30,000 candidates in tens of
milliseconds. To keep the main process responsive regardless, the loop yields
every 2,000 candidates (`setImmediate`) and checks an `AbortSignal`
(Requirement 6.8). The renderer cancels by request id. No worker thread is
introduced: chunked yielding is enough at these sizes, and Phase 8 records
that a worker would be its own decision.

**Road detour** (Requirement 6.5), on request for one result: two `routeLeg`
calls through the existing provider (route point before → POI, POI → route
point after). The detour is their sum minus the route's distance between those
two points, labelled "estimated detour by road". It needs a provider; without
one, the button says why it is unavailable.

### 6.4 No online POI source

Unresolved question 3: **left out.** The owner chose offline only for search,
and the same reasoning applies here. Requirement 5.5 is conditional ("IF an
online source is offered"), so not offering one satisfies it. A route outside
the loaded regions gets "outside your map regions — POIs not checked there"
for that stretch (§6.5), not an online lookup.

### 6.5 Coverage

`meta.coverage` holds the loaded regions' rings. A stretch of route outside
them is reported as **not covered**. A POI search there never says "none
found", and the range check (§8) marks the stretch "not checked".

## 7. Search

### 7.1 `shared/search/` (pure)

- `postcode.ts`: `normalisePostcode` (case, all whitespace); `classify(text)`
  → `full` | `sector` | `outcode` | `uncovered` (`BT`, `IM`, `JE`, `GY`) |
  `none`. It follows the published UK postcode format (`A9 9AA`, `A99 9AA`,
  `A9A 9AA`, `AA9 9AA`, `AA99 9AA`, `AA9A 9AA`), plus `GIR 0AA`.
- `text.ts`: case and punctuation folding, diacritics stripped, tokens, and the
  abbreviation table (`st`↔`street`, `rd`↔`road`, `ave`↔`avenue`, `ln`↔`lane`,
  `dr`↔`drive`, `cl`↔`close`, `cres`↔`crescent`, `pl`↔`place`, `sq`↔`square`,
  `ter`↔`terrace`, `gdns`↔`gardens`, `pk`↔`park`). `St` before a name, as in
  `St Ann's Well`, matches both `saint` and `street`, and ranking sorts it out.
- `rank.ts`: exact postcode, then places by kind (city > town > village >
  hamlet > suburb > locality), then streets, then POIs, each by distance from
  the map centre. Duplicate display names get `, <county>` (or settlement).
- `PlaceSearchProvider` in `shared/search/PlaceSearchProvider.ts`;
  `PoiProvider` in `shared/poi/PoiProvider.ts`.

### 7.2 Postcode data — `main/places/postcodes.ts`

- **Listing**: `GET https://api.os.uk/downloads/v1/products/CodePointOpen`
  (version, e.g. `2026-11`) and `…/downloads` (size and MD5 of the GB CSV).
  Settings shows the size before anything is fetched (Requirement 11.9).
- **Download**: the `…downloads?area=GB&format=CSV&redirect` URL answers 307
  to `omseprd1stdstordownload.blob.core.windows.net`. The Geofabrik client
  refuses any cross-origin redirect. This client allows **exactly** that one
  origin pair, and verifies the MD5 from the listing before using the file.
  The policy stays narrow: one named host, one hop.
- **Ingest**: `jszip` (already a dependency for KMZ) reads the zip in memory
  (14.5 MB). Each `Data/CSV/*.csv` row → normalised postcode, OSGB36
  eastings/northings → WGS84 by `shared/geo/osgb.ts`, quality code. Quality 90
  is stored with null coordinates. `Doc/metadata.txt` gives the copyright
  date, which is shown as the release date. Written to
  `userData/gazetteer/postcodes.sqlite.tmp`, then renamed (Requirement 11.9,
  "replace it in one step").

### 7.3 `shared/geo/osgb.ts`

Inverse Transverse Mercator on the Airy 1830 ellipsoid (OS National Grid
parameters), then the OSGB36 → WGS84 Helmert transform (OS published
parameters, accuracy about 5 m). A postcode centre is already an approximation
of an area, so that is ample. OSTN15, the centimetre-grade transform, is a
15 MB grid and is not needed. Tested against the worked example in OS's *A
guide to coordinate systems in Great Britain* for the projection step, and
against Buxton-area postcode centres for the whole chain, within 10 m.

### 7.4 `main/places/searchService.ts`

Opens both databases read-only with `better-sqlite3`. A query:

1. If `classify` says `uncovered`, return the coverage message (Requirement
   11.8). If it says `full`, do an exact lookup: found, found with no location,
   or "not found in the postcode data dated …" (Requirement 11.7). For
   `sector`/`outcode`, return the mean of its postcodes' points plus their
   bounding box, labelled approximate (Requirement 11.6).
2. Otherwise tokenise. Look up the last token as a prefix and the others as
   whole or abbreviated tokens. Intersect by ref, rank, and take 20.
3. A house number followed by a street ("12 Spring Gardens") looks up
   `address`. Found → that building. Not found → the street, flagged "only the
   street was matched" (Requirement 11.12). Nothing is interpolated.
4. No result → "no match in <loaded region names>" (Requirement 11.11).

Answers carry the dataset dates for the attribution line beside results.

## 8. Range check — `shared/itinerary/rangeCheck.ts` (pure)

Input: the concatenated itinerary line's length, the `alongM` of every
fuel (or `charging`, when `energy = 'electric'`) POI within the corridor, the
uncovered stretches, `range_km` and `reserve_pct`. Usable range =
`range × (1 − reserve)`. It **assumes a full tank at the start**, and the
warning says so. Every gap between consecutive refuelling points (start, POIs,
end) that is longer than the usable range is a warning, with the corridor
width, and the caveat "no fuel station mapped in OpenStreetMap" (Requirement
9.4). A gap that touches an uncovered stretch is "not checked", not a warning
and not a pass. An unset range returns `{ checked: false }`, which the UI
shows as "no range set", not as "fine" (Requirement 9.1).

## 9. From POI to stop

### 9.1 Adding

`itinerary.addPoiStop` and `places.addPoiWaypoint` take a POI id. The main
process looks the POI up again, so the renderer never supplies coordinates
or tags it could have altered. A waypoint is created with:

- `name` = POI name (or the category label when unnamed)
- `symbol` from §6.1
- `description` = plain-text lines from `attrs` ("Address: …", "Phone: …")
- `source = 'poi'`, a new waypoint source distinct from `user` and `import`
  (Requirement 8.3). `GeometrySource` stays `user | import` for routes and
  tracks; waypoints get `WaypointSource = GeometrySource | 'poi'`. The
  waypoints table has no CHECK on `source`, so this needs no migration.
- `metadata.osm = { type, id, snapshotDate }`, using the existing metadata
  column.

Waypoints from postcode and place search are `source = 'user'`: the user
chose to put a point there, and the dataset only helped find it. They go
through the existing `waypoints.create` channel, which takes no metadata, so
no lookup provenance is recorded for them. That is a deliberate simplification
recorded here, not an omission.

**Found while building (task 15).** Undoing a waypoint deletion dropped the
waypoint's `metadata`, because the deletion's inverse never carried it. That
was already true for imported waypoints' preserved GPX extras. With POIs it
would also have turned `poi` back into `user` and lost the OSM provenance. The
inverse now carries both, and `waypoint:restore` writes them back.

`addPoiStop` is one `batch` command: create the waypoint, then add the stop at
the chosen position. One undo removes both.

### 9.2 Planning a leg

`itinerary.planLeg(stopId)`: `routeLeg` from the previous stop's waypoint to
this stop's, in the settings transport mode, then `createSnappedRoute` with
two via points and the previewed leg, named "<from> → <to>", then `linkLeg`.
One batch. It needs a routing provider, and the button says so when there is
none. Without one, the user can still link an existing route, or draw one by
hand and link it.

### 9.3 Re-routing through a new stop (Requirement 8.4)

When a stop is inserted between A and C and the leg into C had a route R, the
UI offers **Re-route through <stop>**. Accepting plans A→new and new→C (§9.2)
and links them. R is **not modified and not deleted**: it stays in the trip,
unlinked, and the confirmation says so. One batch; one undo.

## 10. Export

### 10.1 iCalendar — `main/io/ics/write.ts`

Hand-written RFC 5545, with no dependency:

- `VCALENDAR` with `PRODID:-//TrailRT//Road trip//EN`, `VERSION:2.0`,
  `CALSCALE:GREGORIAN`.
- One `VTIMEZONE` per zone used. Its `STANDARD`/`DAYLIGHT` sub-components are
  generated from the actual transitions in the trip's date span, found by
  scanning `zoneOffsetMs` day by day and bisecting to the minute, each with
  explicit `DTSTART`, `TZOFFSETFROM` and `TZOFFSETTO`. No RRULE is needed for
  a bounded span. Stops with an unknown zone are written in UTC (`…Z`).
- One `VEVENT` per stop (`DTSTART;TZID=` arrival, `DTEND` departure,
  `SUMMARY` stop name, `LOCATION`, `GEO:lat;lon`, `DESCRIPTION` duration and
  notes), and optionally one per leg ("Drive: A → B, 84 km, est. 1 h 32 min").
  `UID` = `<stop id>@trailrt`, `DTSTAMP` = export time.
- Text escaped (`\\`, `\;`, `\,`, `\n`), lines folded at 75 octets on UTF-8
  boundaries, CRLF line endings.
- Stops whose times are unknown are left out, and the export result lists them
  (Requirement 10.1).

### 10.2 GPX for a scheduled trip

`exportService.gather` for a single scheduled trip orders waypoints with stop
waypoints first, in itinerary order, then the rest by name. It orders routes
with linked leg routes first, in leg order, then the rest. **No `<time>` is
written for a plan** (Requirement 10.3). The writer only writes time for
track points and for waypoints with a recorded time, which stops do not have.
That is asserted in a test, so it stays true. The plan's warnings gain one
line: "Itinerary details (start, durations, fixed times) are not part of GPX
and are not written" (Requirement 10.4). A trip with no itinerary exports
byte-for-byte as before, which is a regression test.

## 11. Renderer

### 11.1 Itinerary in the trip properties

`features/itinerary/ItinerarySection.tsx` inside the trip's properties:
"Plan by date" creates an itinerary. It contains: start date and time; the
stop list (drag handle or ↑/↓ buttons; the drag is not the only way); per stop
a duration control (hours and minutes, or days), departure time for day-stays,
arrive-by and depart-at, notes; per leg the linked route (a select of the
trip's routes), "Plan this leg" and the leg's distance and estimated time;
then the trip-level settings (daily driving cap, range, reserve, fuel or
electric). Flags render as inline messages on the stop or leg they belong to.
"Add stop" offers the trip's waypoints. "Remove itinerary" asks first, then
reports "Itinerary removed — Undo".

### 11.2 Calendar drawer

`features/itinerary/CalendarPanel.tsx` opens in the drawer below the map, the
slot the profile uses (`uiStore.drawer`). That answers unresolved question 6
without touching `PanelLayout`. The map stays visible while the calendar is
open, which Requirement 4.4's "select in the calendar, see it on the map"
needs. In-house, with no calendar dependency:

- **Day**: an hour grid (00–24) for one date, blocks positioned by local time.
- **Week**: seven such columns.
- **Month**: a date grid with each day's summary (distance, driving time,
  overnight stop) and its blocks as chips.
- Leg blocks and stop blocks are visibly distinct (filled vs outlined) and
  labelled ("Drive · 1 h 32 min est.", "Buxton · 2 days").
- Selecting a block sets the selection store (route for a leg, waypoint for a
  stop). The map's existing selection highlighting does the rest. Selecting a
  waypoint that is a stop scrolls the calendar to it.
- **Dragging the bottom edge** of a stop block changes its duration in
  15-minute steps (hours stops) or whole days (day-stays), committed on release
  through `itinerary.updateStop`. The keyboard path is the duration field.
- A block whose times are unknown is not placed on the grid. It is listed in
  an "Unknown times" strip above the grid (Requirement 4.6).
- Colours come from the existing theme tokens, so light and dark work
  (Requirement 4.8). Below 640 px, week view becomes a stacked day list.

### 11.3 Along-the-route panel

`features/poi/PoiPanel.tsx`, opened from a route's or the itinerary's
properties ("Find along route"). It has: category checkboxes; a corridor width
select (0.5, 1, 2, 5, 10 km); a section select (whole route, a day, between
distances, near a stop with a radius); and a result list (name, category, km
from start, km off route, day and est. time when scheduled, opening status at
that time). Each row has **Show**, **Add as waypoint** and **Add as stop**, and
**Road detour** on request. The empty state reads "No fuel mapped in
OpenStreetMap within 2 km · data from 3 Nov 2026". Range warnings sit at the
top. OSM attribution sits at the bottom.

`features/map/usePoiLayer.ts`: results as category-symbol markers on a
dedicated pane, clustered by `shared/geo/cluster.ts` (pure grid clustering by
screen cell, recomputed on zoom). Toggled with the other layers via a new
`layerVisibility.pois` key, default on, so existing settings stay valid.

### 11.4 Search box

`features/search/SearchBox.tsx`, top-left of the map. Debounced at 60 ms and
keyed by request sequence, so a slow answer never replaces a newer one.
Keyboard navigable. Choosing a result centres the map, drops a temporary
marker, and shows the actions: Add as waypoint; Start New Route here; Add as
stop (scheduled trip only). Nothing happens until one is chosen
(Requirement 11.2). Approximate results draw their area's bounding box.
Attribution and dataset dates sit under the list.

### 11.5 Settings and About

Settings gains a **Postcodes** section: dataset status (none, or "Code-Point
Open, 19 Oct 2026, 1,749,385 postcodes"), download size, Download / Update
with progress, and the licence statements. The **Map regions** section gains
the places status and Rebuild. About gains Ordnance Survey and Royal Mail /
National Statistics statements, and OSM's ODbL statement for place data.

## 12. Licensing

- **Code-Point Open**: Open Government Licence v3.0. It allows copying,
  adaptation and commercial use, and requires the attribution statements. It
  is compatible with redistribution inside a GPL-3.0 application. Nothing is
  bundled: the user's machine fetches it, and fixtures carry a small excerpt
  with the statements.
- **OpenStreetMap data**: ODbL 1.0. `places.sqlite` is a Derivative Database.
  It is built and used on the user's own machine and is not publicly
  distributed, so ODbL's share-alike (§4.4) is not triggered. Attribution is
  shown wherever it is displayed (§4.3). A waypoint exported from a POI is an
  insubstantial extract and carries no share-alike obligation, but the
  description notes "© OpenStreetMap contributors". The committed fixture
  excerpt is a Derivative Database that *is* distributed, so it is published
  under ODbL with its source and date in `test-data/places-excerpt/README.md`.
- No new npm dependency is added. The register gains the two datasets, under a
  "Data" heading.

## 13. Testing

| Area | Where | Proves |
| --- | --- | --- |
| Zoned time | `shared/time/zoned.test.ts` | gap and overlap; BST end 25 Oct 2026 and start 29 Mar 2026; `addDays` across month and year ends |
| Timeline | `shared/itinerary/timeline.test.ts` | Requirement 13.1 in full |
| Corridor | `shared/geo/corridor.test.ts` | Requirement 13.2, on `A515_TRACE` |
| Range | `shared/itinerary/rangeCheck.test.ts` | Requirement 13.3, plus "not checked" |
| Opening hours | `shared/poi/openingHours.test.ts` | the subset, past midnight, override order, unparsed |
| Postcodes, text, rank | `shared/search/*.test.ts` | Requirements 13.9, 13.10 |
| OSGB | `shared/geo/osgb.test.ts` | the OS worked example; SK17 centres |
| Ingest | `main/places/ingest.test.ts` | the committed Buxton excerpt: Palace Hotel as an area; duplicate LineString/Polygon kept once; streets per settlement; addresses |
| osmium | `main/places/extract.test.ts` | runs the real tools on a tiny committed `.osm` XML when `resources/valhalla/bin/osmium` exists, skipped otherwise, like the live tests |
| Postcode ingest | `main/places/postcodes.test.ts` | the committed Code-Point excerpt: quality 90 → no location; redirect allowlist refuses any other host; MD5 mismatch refused |
| Itinerary service | `main/services/itinerary.test.ts` | undo of every command; trip without itinerary unchanged; archive keeps; deleted waypoint heals on undo |
| iCalendar | `main/io/ics/write.test.ts` | Requirement 13.7: structure, VTIMEZONE, folding, escaping, unknown stops left out |
| GPX | `main/io/exportService` tests | order; no `<time>`; unscheduled trip byte-identical |
| E2E | `tests/e2e/roadtrip.spec.ts` | Requirements 13.8, 13.12 with seeded `places.sqlite` and `postcodes.sqlite` built from the fixtures, all network blocked |

**Fixtures** (Requirements 13.5, 13.11):

- `test-data/places-excerpt/buxton.geojsonseq`: real OSM features from a
  box around Buxton town centre, trimmed to a few hundred, from the
  `osmium export` of the 2026-11-10 Derbyshire extract. ODbL, attributed.
- `test-data/places-excerpt/tiny.osm`: a handful of those features as OSM XML,
  for the osmium integration test.
- `test-data/codepoint/sk.csv`: the real `SK17 6` rows from the 2026-11
  release, plus `licence.txt` and `metadata.txt` copied verbatim, and two
  quality-90 rows from the same release.

## 14. Requirement amendments

Two places where the requirements assumed something the code does not have:

- **3.2**: "the routing engine's estimate for that route when one exists". No
  saved route has one, by ADR 0011 §8, so every leg is timed by the per-mode
  average. The requirement is amended to say so.
- **3.7**: a day-stay must be at least one day (validated), so "departure
  before arrival" can only happen when arrival on the arrival day is later
  than the departure time, and N = 1 still leaves the next morning. The flag
  is kept for the case the user can actually hit: **`depart-at` on an hours
  stop earlier than arrival**, which is `depart-at-too-early`. The
  requirement's example ("arriving at 11:00 on the last day") cannot occur
  with whole-day stays measured from the arrival date, and the design records
  that rather than building a flag nothing can raise.

## 15. Feedback after the first build (Requirements 14–17)

### 15.1 Leg modes — migration `0005_leg_modes.sql`

`itinerary_stops` gains three columns, each describing the leg **arriving**
at the stop:

| Column | Values | Meaning |
| --- | --- | --- |
| `leg_mode` | `road` (default), `route`, `other` | planned automatically, chosen by hand, or not by road |
| `leg_transport` | `ferry`, `train`, `flight`, `other`, null | for `other` only |
| `leg_minutes` | integer, null | travel time for `other`; null means not known |

`leg_label` holds a free-text name for `other` ("Holyhead–Dublin ferry").
Existing rows migrate as `route` when they have a `leg_route_id` (the user
chose it) and `road` otherwise. Nothing is planned during the migration, so an
upgrade never makes routes on its own.

### 15.2 Automatic planning

`main/services/autoPlanService.ts`, `autoPlan(db, provider | null, mode,
tripId)`, async. For every `road` leg after the first stop:

1. If its route exists, is in the trip, and joins its two stops (design §4's
   1 km test), nothing happens.
2. If its route was **planned automatically** and no longer fits, that route
   is deleted (`route:restore` is its inverse).
3. A new leg is routed (`routeLeg`), saved with `createSnappedRoute` and
   linked. The route's metadata records `{ plannedBy: 'itinerary' }`, which is
   the only thing that lets step 2 delete it. A route without that marker is
   the user's, and is never touched (Requirement 15.3).

It returns one `batch` mutation. The IPC handlers for `addStop`,
`removeStop`, `moveStop`, `addPoiStop`, `setLegMode`, and `waypoints.move` /
`waypoints.update` (when the waypoint is a stop) apply their own change, run
`autoPlan`, and record **one** batch of both, so a single ⌘Z undoes the stop
and the drives planned for it. Undo order is the batch's reverse: the planned
routes go first, then the structural change restores its own links.

With no provider, or when the engine finds no road, the leg is left without a
route. `ItineraryView` gains `planIssue` per stop, from the provider status
("No map regions are loaded", "Outside your map regions") or the engine's own
answer, so the editor says why (Requirement 15.4).

### 15.3 Timeline

`TimelineLeg` gains `kind: 'road' | 'other'` and `minutes`. An `other` leg
with minutes takes exactly that long. Without minutes it is flagged
`no-travel-time`, and everything after it is unknown, as an unplanned road leg
is. Day totals count road legs as driving. Other transport is carried
separately as `otherSeconds`, so the daily driving cap is about driving.
Along-the-route search and the range check skip `other` legs. The range check
reports them as stretches it cannot check, never as covered.

### 15.4 The library tree for a dated trip

`libraryService` builds a scheduled trip's children from its `ItineraryView`.
A new `TreeNodeKind`, `group`, is a heading row: not selectable, no `ref`,
expandable. Days are expanded by default. Children:

```
Peak weekend                  23–25 Oct 2026 · 3 days · 98 km
├─ Fri 23 Oct                 1 h 32 min driving
│  ├─ Buxton                  leave 16:00            (waypoint)
│  ├─ Buxton → Leek           21 min                 (route)
│  └─ Leek                    17:21 – Sun 09:00      (waypoint)
├─ Sun 25 Oct                 …
├─ Unknown times              (only when some are)
└─ Not in the plan            (only when some are)
```

Node ids are positions (`trip:…/day:2026-10-23/stop:…`), so a waypoint that
is both start and end appears twice without a key clash. An undated trip's
node is built by the old code path, unchanged (Requirement 14.5). A total
distance with any road leg unknown is shown as "at least 98 km".

### 15.5 Panels

`PanelLayout` gains `drawerHeight` (default 300) and `drawerVisible`
(default true), both optional so settings saved before this load unchanged.
`SplitPane` gains a `top` side: the drawer sits in a container whose height is
dragged by its top edge and clamped so the map keeps at least 160 px. Three
toggles (library, properties, bottom panel) sit in a small group at the map's
bottom-left. They are keyboard-reachable and named, and they mirror the
existing View menu items. Opening a drawer (calendar, profile, places) makes
the bottom panel visible again.

### 15.6 Icon buttons

`lucide-react` 1.72.0 (ISC, verified with `npm view` and a dry-run install;
added to the register). `IconButton` takes a required `hint`, which is both
its `aria-label` and a tooltip shown on hover after 300 ms and immediately on
keyboard focus. The tooltip is rendered in a portal, positioned from the
button's rectangle, so overflow containers never clip it. The trip, route,
itinerary, calendar, along-the-route and search panels use it for their
actions. "Plan by date" and "Download" stay as text (Requirement 17.3).
