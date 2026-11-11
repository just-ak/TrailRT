# Phase 7: UK regions, road-following by default, and a fuller profile — Tasks

Execute in order. Pure modules come first, each proven offline, then the main
process, then the UI, then the live and end-to-end passes.

Update `docs/progress-mindmap.svg` as each task changes status.

- [x] 1. Spec, ADR 0018 and renumbering
  - Requirements, design and tasks for this phase; ADR 0018
  - Windy roads moves to `phase-8-…` and Garmin to `phase-9-…`; live documents
    and links are updated; historical records are left as written
  - _Requirements: 4.5, 5.8_

- [x] 2. Twistiness scoring
  - `shared/geo/twistiness.ts`: resample, smooth, bends, score, windows, unknown
  - Unit tests: a straight line scores 0; a constant 100 m radius curve is
    counted and classed; a 15 m radius 180° turn is a hairpin; ±3 m zigzag
    jitter on a straight line scores Straight; the same road at 5 m and at 40 m
    source spacing scores the same within 0.3; a 2 km line of 4 points and a
    300 m line are unknown; windows cover the length
  - Found while testing: the measured radius has a floor of about 25–30 m at
    20 m resampling, so a true 12 m hairpin measures 32 m. Hairpin and tight
    thresholds moved to the measured scale (45 m, 60 m); design §4 corrected
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.7_

- [x] 3. UK boundary and default limits
  - `scripts/generate-uk-boundary.mjs`, `shared/geo/ukBoundary.ts` (`inUk`)
  - `shared/routing/ukSpeedLimits.ts` (`ukDefaultLimit`, cited)
  - `shared/geo/speedBands.ts`: assumed samples, per-band assumed share
  - Unit tests: inside/outside for Belfast, Shetland, Buxton, Dublin, Douglas,
    Jersey; the rule table row by row; a distribution with assumed distance
    sums to 100% with Unknown kept separate
  - The boundary is 150 points from Geofabrik's `united-kingdom` feature, so
    the generator is checked in and the output is reproducible
  - _Requirements: 5.1, 5.3, 5.4, 5.7_

- [x] 4. Road data carries one-way, and assumed limits reach the services
  - `valhalla.ts`: `edge.traversability` → `MatchedEdge.oneway`
  - `roadAttributeService.postedSpeedSamples` with `{ ukDefaults }`;
    `profileService` `assumedSpeedSpans`; setting `ukDefaultSpeedLimits`
    (default on) in types, defaults, schema and the IPC handlers
  - Unit tests: traversability parsing; an unposted UK tertiary edge is 60 mph
    assumed; the same edge outside the UK, or with the setting off, is Unknown;
    old payloads without `oneway` read as single carriageway
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

- [x] 5. Terrain: HGT sampling and the tile store
  - `shared/geo/hgt.ts`: names, covering tiles, size validation, bilinear
    sampling, voids, `gainLoss` with hysteresis
  - `main/terrain/terrainStore.ts`: gzipped cache, LRU, sea markers, validated
    atomic download
  - Unit tests: as design §7, plus the store against a synthetic gzipped tile
    and a fake fetch (403 is sea, a wrong size is rejected and not cached)
  - Tiles are resolved once per lookup rather than once per point, so a
    200,000-point recording does not cost 200,000 filesystem checks, and the
    memory cap still holds across many tiles
  - _Requirements: 3.1, 3.5, 3.6, 3.7_

- [x] 6. Profile: terrain elevation and twistiness
  - `profileService`: injected terrain source; recorded precedence;
    `elevationSource`, `terrainMissing`, `twistiness`,
    `twistinessUnknownBecause`
  - IPC `routing:downloadTerrain`; preload; api
  - Unit tests: a snapped route with tiles gets terrain heights and gain; with a
    tile missing it reports the count; a GPX route with recorded heights keeps
    them; twistiness present for road geometry and unknown for a hand-drawn
    route
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3_

- [x] 7. Region map data and multi-region build
  - `geofabrik.ukRegions`; `regionCatalogue.regionMap` and `regionSizes`;
    `downloadAndBuild(paths, regionIds)` with merge and terrain stages;
    `EmbeddedPaths.mergeTool`; `LoadedRegion.regionIds`
  - IPC `routing:regionMap`, `routing:regionSizes`; `downloadRegion` takes
    `regionIds`
  - `scripts/build-valhalla.sh` requires `osmium-tool`;
    `scripts/bundle-valhalla.sh` bundles `osmium` and its dylibs; re-bundled
  - Unit tests: `ukRegions` from a fixture; refusals (over 2 GB, several
    without a merge tool); merge invoked only for several; extracts removed on
    failure; old `region.json` still reads
  - Re-bundled: the relocated `osmium` loads and merges, and the bundle's own
    load check passes. The check failed at first only because this editor
    exports `ELECTRON_RUN_AS_NODE`; `bundle-valhalla.sh` now unsets it
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.12_

- [x] 8. Region picker: UK map and Elsewhere
  - `shared/geo/regionMap.ts` `projectRegions` (unit-tested)
  - `RegionMap.tsx`; `RegionPickerDialog` with United Kingdom and Elsewhere
    tabs, selection list, sizes, total, the replace and re-download notes;
    progress lines for every stage; Settings names loaded regions
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.10, 1.11_

- [x] 9. Following roads by default
  - `startDrawingRoute` chooses the road tool when available;
    `startStraightLineRoute`; `straightBecause` in the editor store
  - Remove the toolbar button, the hint toggle and `snapWhileDrawing`; hint bar
    with "Add map regions…"; "New Straight-Line Route" in the app menu and
    library context menu; "Snap to roads" only for routes not following roads
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 10. Profile and distribution display
  - Terrain-labelled elevation line and gain, and the download offer; twisty
    score line and twistiness band with key; hatched assumed speed spans with
    key; `SpeedDistributionBar` assumed hatch, column and note; Settings toggle
  - _Requirements: 3.2, 3.4, 4.1, 4.4, 5.2, 5.5_

- [x] 11. Attribution and licence register
  - About window data sources; register: osmium-tool and dependencies, terrain
    data; `npm run licences` still passes
  - Found while doing it: `npm run licences` rewrote the whole register, so the
    hand-maintained Valhalla section had been silently deleted by every
    regeneration. It now lives in `docs/licences/native-and-data.md`, which the
    generator appends, and the lost section is restored
  - _Requirements: 3.8, NFR 2_

- [x] 12. Live tests
  - `src/main/routing/regions.live.test.ts`, `npm run verify:regions`:
    three-county merge and build, the Buxton square routed, twistiness ranking
    of the six reference roads, terrain at Buxton and Ashbourne
  - Snake Pass and M6 endpoints resolved through Nominatim and added to
    `places.json` with corridor checks (passes the Snake Pass Inn; ≥ 80% of the
    M6 route is motorway), rather than coordinates from memory
  - Result: three counties downloaded, merged and built in 75 s (40 tiles,
    148 MB); the Buxton square routes, 98.8 km in four legs, nothing displaced;
    Cat and Fiddle 7.3 Twisty > Snake Pass 2.7 Winding > A515 1.6 Gentle >
    M6 0.9 Straight; terrain Buxton 299 m (known 300), Ashbourne 129 m
    (known 130)
  - Noted: the Macclesfield–Leek leg scored 5.3 with three "hairpins", because
    its fixture via points sit off the A523 and the route turns into villages
    and back. Real geometry, and the junction limitation in design §4 made
    visible
  - _Requirements: 1.6, 3.1, 4.6_

- [x] 13. End-to-end and verification pass
  - E2E as design §7; existing specs updated for the removed controls
  - `npm run verify`; `npm run package`; e2e against the packaged app; README;
    mindmap
  - Result: `npm run verify` green (lint, typecheck, 1,214 unit tests, build,
    122 end-to-end); packaged `TrailRT.app` carries `bin/osmium` and passes the
    same 122 end-to-end tests
  - Visual check in the running app, with the three-county graph: the picker
    map, the twisty band and score, hatched assumed limits, and terrain heights
    rising from Buxton to 517 m at the Cat and Fiddle (known: 515 m). The map's
    height was cut to fit the dialog after the first look
  - _Requirements: all_

- [x] 14. Fix: Enter and double-click did not finish a new route
  - Reported by the owner after task 13. Reproduced in the app with the
    Derbyshire graph: every way of starting New Route, finished with Enter,
    showed "That request was not valid" and saved nothing
  - Cause 1, from Phase 6 and exposed by Requirement 2.1: keeping route A in
    the alternatives stored the `Candidate` itself as the draft leg, and its
    `estimatedDurationS` failed the strict leg schema. Phase 6's end-to-end test
    only chose route B, whose leg is rebuilt. `asPreviewedLeg` in
    `shared/routing/results.ts` now projects every stored and sent leg
  - Cause 2: the first click of a double-click puts that point's handle under
    the pointer, so the `dblclick` landed on the handle and never reached the
    map. `useSnapRouting` now listens on the map container in the capture phase
  - Also: finishing waits up to 5 s for a leg still in flight rather than
    refusing, and straight-line drawing ignores the duplicate click of a
    double-click, which had left a zero-length last segment
  - Unit test against the real request schema (fails before the fix);
    `tests/e2e/finishing.spec.ts`: Enter keeping route A, Enter straight after
    a click, double-click on a handle, straight-line double-click → 2 points
  - `npm run verify` green: 1,215 unit, 126 end-to-end
  - _Requirements: 2.1, 2.4_

- [x] 15. Fix: the map went blank after switching base map while zoomed in
  - Reported by the owner with the profile open; the profile was not the
    cause. Reproduced: zoomed to 19 on OpenStreetMap, switching to OpenTopoMap
    (which serves to 17) left the map at 19 with a tile layer that drew nothing
    past its own `maxZoom` — no tiles at all, and zooming did not bring them
    back. The attribution read "© OpenStreetMap contributors, Map data ©
    OpenStreetMap contributors, SRTM · Rendering © OpenTopoMap", exactly as in
    the owner's screenshot
  - Cause 1: a provider's serving limit was used as the map's zoom limit. Now
    `MAP_MAX_ZOOM` (19) is the map's and every tile layer's `maxZoom`, and the
    provider's limit is `maxNativeZoom`, so past it Leaflet enlarges the deepest
    tiles rather than showing nothing
  - Cause 2: layer cleanup called `off()` before `remove()`, deleting Leaflet's
    one-off listener that takes the layer's attribution back off the map, so
    the old provider stayed credited for the rest of the session
  - `tests/e2e/basemap.spec.ts`: fails without the fix (no tiles), passes with
    it; checks the tiles requested are zoom 17 and the credit appears once
  - `npm run verify` green: 1,215 unit, 128 end-to-end
  - _Requirements: NFR 1_

- [x] 16. Owner feedback: a plainer route panel
  - Route panel (`features/properties/RouteProperties.tsx`) leads with
    distance, time, transport mode and the speed-limit summary. Everything
    technical is in a Details popup behind ⓘ. Duplicate and Delete removed;
    the track panel loses Delete too (both stay in the library menu)
  - Time follows the transport mode: `shared/routing/travelTime.ts`. Walking
    uses the Settings planning speed; the others use a stated average
  - `features/properties/roadData.tsx` replaces `RoadDataSection.tsx`:
    `RoadSummary` for the panel, `RoadDetails` for the popup, and
    `useRoadData`, which looks roads up on selection with the built-in engine
    only, once per selection, quietly, with an inline retry on failure
  - Points open inside the profile drawer. `ProfileSample.index` carries each
    sample's source point; `features/profile/profilePoints.ts` maps indices to
    distances and back, so the table's selection is shaded on the chart and a
    chart click selects the nearest row
  - Waze is an icon with a start / end menu (`wazeTargetsFor`); ADR 0005 amended
  - Unit tests: `travelTime.test.ts` (the 34-mile route is ~12 h walking, ~1 h
    driving), `profilePoints.test.ts` (exact, thinned, round trip, runs),
    `waze.test.ts` (start and end, empty geometry)
  - End-to-end: chart click selects and shades a point; Waze menu offers start
    and end only; with the built-in engine, speed limits appear without a
    button and the engine details are in the popup
  - Found by the first verify run: a road lookup dropped the route's snap
    provenance, so after an automatic lookup the map lost unmatched legs and
    dragging the line added no shaping point. `matchRoads` now keeps it
  - Follow-up reported by the owner: selecting another route left the drawer
    on the first. `features/profile/drawerTarget.ts` now makes it follow the
    selection: another route or track retargets it (the point list stays
    open), anything without a profile closes it. The drawer header names the
    geometry. Unit-tested, and an end-to-end test that fails without the fix
  - `npm run verify` green: 1,244 unit, 130 end-to-end
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
