# Phase 7: UK regions, road-following by default, and a fuller profile — Requirements

Status: **complete.** All 15 tasks done and verified. Tasks 1–13 against the packaged app; tasks 14 and 15, fixes reported afterwards, against the development build.

Five changes the owner asked for after Phase 6 shipped:

1. Map regions for snap-to-road data are chosen from a **map of the UK with its
   counties**, and several can be selected at once.
2. Following roads becomes **the default way to make a route**, so the separate
   "snap to road" controls go.
3. The profile shows **altitude** for routes, which today have none.
4. Every profile gets a **twisty score**.
5. A UK road with **no posted limit** in the map data is counted at the **UK
   national speed limit** instead of as Unknown.

Inserted ahead of windy-roads routing, which moves to Phase 8, and Garmin
compatibility, which moves to Phase 9. See ADR 0018. The order suits the work:
the twisty score is the scoring function that windy-roads routing needs (its
Requirement 3), so that phase now starts with scoring already built and
calibrated.

## What the investigation found

The investigation was done against the code as it stands after Phase 6, and
against the real engine, with live measurements.

**The region picker offers one region at a time.** `RegionPickerDialog` ranks
Geofabrik extracts by the centre of the visible map, and
`regionCatalogue.downloadAndBuild` takes a single `regionId`. The graph is
replaced each time. The test loop round Buxton crosses three counties
(ADR 0015), so routing the whole loop has needed the 1.4 GB England extract.

**Valhalla cannot build from overlapping extracts.** `valhalla_build_tiles`
accepts several `.osm.pbf` files. Given Derbyshire, Cheshire and Staffordshire,
it warns ("Tile building using more than one osm.pbf extract is discouraged",
issue 3925), logs `Failed tile 2/824388/0: vector`, and aborts with an uncaught
exception (exit 134). Geofabrik's county polygons are buffered, so neighbouring
counties always overlap. Merged first with `osmium merge`, the same three
counties take 1.5 s to merge and 11 s to build: 40 tiles, 141 MB. The whole
Buxton square then routes: 98.8 km, four legs.

**The UK in Geofabrik's index.** `united-kingdom` has England, Scotland and Wales
as children. England has 47 county-level children. Northern Ireland is not
published on its own. The only extract containing it is
`ireland-and-northern-ireland`. The `united-kingdom` boundary polygon, at 150
points, correctly puts Belfast, Enniskillen and Shetland inside, and Dublin,
Dundalk, Letterkenny, the Isle of Man and Jersey outside.

**There are three snap controls.**

- A "Snap routing" button in the map toolbar starts the road-following tool.
- "New Route" starts straight-line drawing, with a "Straight lines — snap to
  roads" toggle in the hint bar.
- The properties panel has a "Snap to roads" button, which converts an
  existing route.

**Routes have no elevation.** Snapped geometry comes from the engine with
`ele = null`, so the profile says "No point in this geometry carries an
elevation". The engine supports elevation, but only from DEM tiles that are not
installed. The open Terrain Tiles dataset on AWS publishes 1-arc-second (about
30 m) HGT tiles; `N53W002.hgt.gz` is 7.2 MB. Sampled at the test towns, it gives
Buxton 297 m against a known 300 m, and Ashbourne 131 m against 130 m.

**Points per kilometre does not measure twistiness.** Routed on the
three-county graph:

| Road | Points/km | Heading change of counted bends |
| --- | --- | --- |
| A537 Cat and Fiddle | 45.7 | 201°/km |
| A57 Snake Pass | 28.1 | 79°/km |
| A523 Macclesfield–Leek | 24.9 | 70°/km |
| A515 Buxton–Ashbourne | 24.2 | 53°/km |
| A53 Leek–Buxton | 29.4 | 45°/km |
| M6 Stoke–Crewe | 16.9 | 31°/km |

By point density, Snake Pass and the A53 look about the same, and the A53 looks
twistier than the A523. A GPS recording logs at a fixed rate, so its point
density measures how slowly it was ridden. Phase 8 Requirement 3.5 already
records that point density follows mapping effort, not road shape.

**Speed limits.** `trace_attributes` returns `speed_limit` only where OSM has a
`maxspeed` tag. Along the Buxton loop, every unclassified, residential and
service road came back with none. The same call can also return
`edge.traversability` (one-way or both ways) and `edge.use`. With those and the
road class, the UK default limit can be derived.

ADR 0011 §2 currently forbids that ("never … filled from a country default").
The owner has now asked for it. ADR 0018 amends §2 so that a default may be
applied only when it is labelled as assumed.

## Terms

| Term | Meaning |
| --- | --- |
| **Region** | A downloadable Geofabrik extract. For the UK: an English county, Scotland, Wales, or Ireland and Northern Ireland. |
| **Loaded regions** | The regions the current routing graph was built from. |
| **Terrain elevation** | Height sampled from a digital elevation model at a point. A model value, not a measurement. |
| **Bend** | A run of same-direction turning that turns far enough, and tightly enough, to count. Defined exactly in the design. |
| **Twisty score** | 0–10, from degrees of bend per kilometre. |
| **Assumed limit** | A speed limit the system inferred from UK law because the map data has no posted one. Never presented as posted. |

## Requirements

### Requirement 1: Choosing regions on a UK county map

1. THE region picker SHALL open on a map of the United Kingdom showing every
   downloadable region for it: England's counties, Scotland, Wales, and Ireland
   and Northern Ireland.
2. Clicking a region SHALL toggle its selection, and any number SHALL be
   selectable. Hovering SHALL name the region. A list beside the map SHALL
   name the selected regions, and each SHALL be removable from there.
3. THE picker SHALL state that Northern Ireland is published only together with
   the Republic of Ireland, rather than leave the user to discover it.
4. Regions in the loaded graph SHALL be marked as loaded, and SHALL be selected
   when the picker opens. Adding a county is then one click and a rebuild.
5. THE total download size of the selection SHALL be shown before anything is
   downloaded. A selection above the build limit (2 GB) SHALL be refused before
   the download starts, with the reason.
6. Download and build SHALL produce **one** routing graph covering every
   selected region. Where more than one region is selected, the extracts SHALL
   be merged before building. Valhalla aborts on overlapping extracts, and
   neighbouring regions always overlap.
7. Progress SHALL name the stage: downloading (region *n* of *m*, with bytes),
   merging, building, and fetching terrain.
8. THE loaded-regions record SHALL list every region. Settings and the success
   message SHALL name them.
9. WHERE the bundled merge tool is missing THE picker SHALL still build a single
   region, and SHALL refuse more than one with that reason.
10. THE previous view-based list SHALL remain available as "Elsewhere", for
    places outside the UK.
11. THE picker SHALL say that a new selection replaces the loaded graph, and
    that every selected region is downloaded again, because extracts are not
    kept after a build.
12. Offline, or without the index, the existing fallback (import a `.osm.pbf`)
    SHALL remain.

### Requirement 2: Following roads is the default

1. "New Route", wherever it is offered (menu, library context menu, properties
   panel, keyboard), SHALL start the road-following route tool when the engine
   is available.
2. THE "Snap routing" map-toolbar button and the snap toggle in the drawing hint
   bar SHALL be removed.
3. WHERE routing is unavailable, "New Route" SHALL draw straight lines. The hint
   bar SHALL give the reason and offer to add map regions. A route SHALL NOT be
   silently straight.
4. A straight-line route SHALL remain possible on purpose, for paths the
   engine does not know: off-road, ferries, private land. It SHALL be offered as
   a menu command, "New Straight-Line Route", not as a toggle.
5. THE properties panel SHALL offer "Snap to roads" only for a route that does
   not already follow roads: an import, or one drawn straight. A road-routed
   route re-routes itself when edited (Phase 6) and needs no button.

### Requirement 3: Altitude in the profile

1. WHERE a geometry carries no recorded elevation, THE profile SHALL plot
   terrain elevation sampled from a digital elevation model, with its gain and
   loss.
2. Terrain elevation SHALL be labelled as such wherever it appears: on the chart,
   in the gain and loss figures, and in the chart's accessible name. Recorded
   and modelled heights SHALL never be presented as the same thing.
3. Recorded elevation SHALL take precedence. Terrain elevation SHALL NOT be
   written into route or track points, and SHALL NOT be exported. It is a
   derived value, computed when the profile is drawn.
4. Terrain tiles SHALL be downloaded with a region, covering the selected
   regions. WHERE a profile needs tiles that are missing, it SHALL offer to
   download them, stating how many and roughly how large. After download, terrain
   elevation SHALL work offline.
5. A void in the model, or a point with no tile (open sea), SHALL be a gap in
   the line, never 0.
6. Gain and loss from terrain SHALL suppress model noise with a stated
   threshold, documented with its reasoning.
7. A downloaded tile SHALL be validated before use. A file of the wrong size
   SHALL be rejected, not sampled.
8. THE data source SHALL be attributed in the About window and the licence
   register.

### Requirement 4: A twisty score on every profile

1. Every profile of a route or track SHALL show a twisty score from 0 to 10,
   with:
   - a label (Straight, Gentle, Winding, Twisty, Very twisty)
   - degrees of bend per kilometre
   - bends per kilometre
   - the number of tight bends and hairpins
2. THE score SHALL be computed from heading change along the line after
   resampling it at a fixed spacing, so that point density has no effect. Why
   points per kilometre was rejected SHALL be documented with the measured
   figures.
3. THE score SHALL be **unknown, with a reason**, where it cannot be measured:
   a line shorter than half a kilometre, or one too sparse to show a bend, such
   as straight lines between clicked points. Unknown SHALL never be shown as 0.
4. THE profile SHALL show twistiness along the route, kilometre by kilometre.
5. THE scoring function SHALL be pure and SHALL live in `src/shared/geo/`. It
   delivers Phase 8 Requirement 3's scoring, which that phase SHALL reuse
   rather than rebuild.
6. THE thresholds SHALL be documented with their reasoning, and calibrated
   against the real roads above. A live test SHALL show that the score ranks
   them: the Cat and Fiddle above Snake Pass, Snake Pass above the A53, and the
   M6 lowest.
7. THE stated limitations SHALL include that a turn at a junction counts as a
   bend.

### Requirement 5: UK default limits where none is posted

1. WHERE a road inside the UK has no posted limit in the map data, the speed
   distribution and the profile SHALL count it at the UK default for its kind:

   | Road | Assumed limit | Basis |
   | --- | --- | --- |
   | Motorway (including its slip roads) | 70 mph | Motorway limit |
   | One-way trunk or primary road (a dual carriageway) | 70 mph | National speed limit, dual carriageway |
   | Other trunk, primary, secondary, tertiary and unclassified roads | 60 mph | National speed limit, single carriageway |
   | Residential and service roads | 30 mph | Restricted road (street lighting) |

2. THE assumed share SHALL be distinguishable from the posted share wherever
   either is shown:
   - the distribution bar SHALL mark the assumed portion of each band
   - the table SHALL give each band's assumed distance
   - the profile band SHALL draw assumed spans differently, with a key.
3. THE rule SHALL apply only inside the UK boundary. The Republic of Ireland,
   the Isle of Man and the Channel Islands have their own limits, and SHALL
   stay Unknown.
4. A road with no road class, and distance not matched to any road, SHALL stay
   Unknown.
5. A setting SHALL turn assumed limits off, returning to posted limits only.
   The default SHALL be on.
6. Recorded speeds SHALL be unaffected. This is about posted limits only.
7. THE rules SHALL live in one module, with their legal basis cited, so that
   correcting one rule is a one-line change.
8. ADR 0018 SHALL amend ADR 0011 §2 to allow this, and SHALL record the
   conditions under which it is allowed.

## Non-functional requirements

1. **No regression.** `npm run verify` stays green; existing tests change only
   where the behaviour they assert was deliberately changed (the snap controls).
2. **Licences.** `osmium-tool` is GPL-3.0-or-later, which is compatible. It is
   bundled as a native tool and recorded in the register, with its
   dependencies. Terrain data is attributed. No new npm dependency.
3. **Module boundaries hold.** Scoring, HGT sampling, the UK boundary and the
   limit rules are pure modules in `shared/`. Downloading, the tile cache and
   the merge live in `main/`.
4. **Real geography in tests**, per ADR 0015: the Buxton square for the live
   multi-county build, and the test towns for terrain values.

## Out of scope

- Keeping downloaded extracts so a county can be added without re-downloading
  the others. Possible later. Disk cost versus download time is the trade-off.
- Region maps for other countries. "Elsewhere" keeps the view-based list.
- Ascent for routes in the properties panel. The profile shows terrain gain;
  route statistics stay computed from stored points.
- Telling junction turns from bends. That needs graph topology, and belongs to
  Phase 8.
