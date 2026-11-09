# Phase 7: UK regions, road-following by default, and a fuller profile — Design

Written against the code after Phase 6, and against the live engine. The figures
quoted here were measured on an Apple M4. The engine was the bundled Valhalla
3.9.1 addon, on a graph built from Derbyshire, Cheshire and Staffordshire.

## 1. Regions: a UK map, several at once, merged before building

### 1.1 Which regions the map shows

The region list is derived from the Geofabrik index the app already caches
(`regionCatalogue.loadCatalogue`), so nothing new is fetched to draw the map.

`ukRegions(regions)` in `main/routing/geofabrik.ts` is a pure function. It
returns:

- every region whose parent is `england` (47 counties)
- `scotland` and `wales`
- `ireland-and-northern-ireland`, carrying a note that Northern Ireland is
  published only with the Republic.

Rings are rounded to 4 decimal places (about 10 m) for transfer. They are used
only to draw the picker, never to decide coverage, so the rounding cannot reach
routing. About 16,000 points in total go over IPC once per open.

```ts
// shared/routing/results.ts
interface RegionMapEntry {
  id: string;
  name: string;
  /** Outer rings, [lon, lat], rounded for drawing only. */
  rings: [number, number][][];
  loaded: boolean;
  note: string | null;
}
```

### 1.2 IPC

| Channel | Request | Response |
| --- | --- | --- |
| `routing:regionMap` | none | `RegionMapEntry[]` |
| `routing:regionSizes` | `{ regionIds: string[] }` (1–64) | `{ id, sizeBytes \| null }[]` |
| `routing:downloadRegion` | `{ regionIds: string[] }` (1–64), **changed** from `{ regionId }` | `LoadedRegion` |

Sizes are fetched for the selection, not for all 50 regions when the map opens.
The cost is shown when the user has chosen something, and HEAD requests to
Geofabrik stay proportional to what is actually being considered. Sizes are
cached for the session in `regionCatalogue`.

### 1.3 Download, merge, build

`downloadAndBuild(paths, regionIds, options)` replaces the single-region
version:

1. Resolve every id in the index (`NOT_FOUND` names the missing one).
2. With more than one id and no merge tool, refuse with `INVALID_REQUEST`:
   "This build cannot combine regions. Choose one."
3. Fetch the sizes. If the known total exceeds `MAX_REGION_BYTES` (2 GB),
   refuse before downloading anything.
4. Download each extract to `downloads/<id>.osm.pbf`, reporting
   `{ phase: 'downloading', regionIndex, regionCount, regionName, receivedBytes, totalBytes }`.
5. With more than one extract, run `osmium merge … -o downloads/merged.osm.pbf
   --overwrite --no-progress`, reporting `{ phase: 'merging' }`.
6. `importRegion` builds from the single file (unchanged: staging directory,
   swap on success).
7. Fetch terrain tiles covering the regions' bounding boxes
   (`{ phase: 'terrain', tilesDone, tileCount }`). A terrain failure does **not**
   fail the build. The graph is the thing the user asked for. The outcome
   carries `terrainWarning`, and the profile can fetch tiles later
   (Requirement 3.4).
8. `finally`: delete every extract and the merged file.

`LoadedRegion` gains `regionIds: string[]`. `regionName` becomes the joined
display names ("Derbyshire, Cheshire and Staffordshire"; past three names,
"Derbyshire, Cheshire and 4 more"). `readLoadedRegion` accepts an old record
without `regionIds` and reports it as `[]`, so a graph built before this phase
shows nothing pre-selected rather than failing to load.

### 1.4 The merge tool

`osmium-tool` 1.19.1 (GPL-3.0-or-later), from Homebrew. It is bundled at
`resources/valhalla/bin/osmium` by `scripts/bundle-valhalla.sh`, beside the
Valhalla tools. That script already walks a binary's dylib closure and rewrites
it to `@loader_path`, so `osmium` picks up `boost_program_options`, `lz4` and
`expat` the same way. `scripts/build-valhalla.sh` adds `osmium-tool` to its
required Homebrew formulae.

`EmbeddedPaths` gains `mergeTool`. `mergeToolPresent(paths)` is a plain
`existsSync`, so a build without it degrades to single-region, which
Requirement 1.9 asks for.

Why not merge in TypeScript: deduplicating overlapping PBF extracts means
decoding and re-encoding every block with fresh string tables, which is a PBF
writer, written and maintained here. `osmium merge` is the standard tool and
takes 1.5 s on the three-county case. Rejected in ADR 0018.

### 1.5 The picker

`RegionPickerDialog` gets two tabs. **United Kingdom** is the default.
**Elsewhere** is the existing view-based list, which now calls
`downloadRegion({ regionIds: [id] })`.

The UK tab is an inline SVG drawn by `RegionMap.tsx`:

- **Projection.** Equirectangular, with longitude scaled by `cos(54.5°)`, the
  UK's mid-latitude. It is computed by the pure function
  `projectRegions(entries, width, height)` in `shared/geo/regionMap.ts`, which
  returns SVG path strings and a label point per region.
- **One `<path>` per region**, with `role="checkbox"`, `aria-checked`, an
  `aria-label` of the region's name, and Space and Enter to toggle. A
  map of fifty clickable shapes must still be usable from the keyboard.
- **Fill.** Unselected regions are neutral. Selected ones use the accent
  colour. Loaded ones get a heavier outline and are listed as "loaded".
- **Overlap.** Neighbouring polygons overlap slightly, because Geofabrik buffers
  them. The click goes to the topmost path, and the hover name says which
  region that is.
- **Beside the map,** a list of the selection with sizes, a total, and a
  remove (×) per row, plus the two statements Requirement 1.11 asks for.

## 2. Following roads is the default

`actions.startDrawingRoute()` becomes the single entry point for "New Route":

```
status = await routing.loadStatus()
status.available → startSnapRouting()            (road-following tool)
otherwise        → editor.startDrawRoute(tripId, { straightBecause: 'unavailable' })
```

`startStraightLineRoute()` is the deliberate path: `straightBecause: 'chosen'`.
It is reached from the application menu ("New Straight-Line Route", Route menu,
dispatch `route:newStraight`) and from the library context menu.

Removed:

- the toolbar "Snap routing" button
- the hint-bar toggle
- `editorStore.snapWhileDrawing` and `setSnapWhileDrawing`
- the `snap` parameter of `createRouteFromDrawnPoints`, which no longer snaps.

Draw mode in the hint bar:

| `straightBecause` | Hint |
| --- | --- |
| `unavailable`, no map data | "Straight lines — no map region loaded yet" plus an **Add map regions…** button |
| `unavailable`, other | "Straight lines — road routing unavailable" plus the engine's message |
| `chosen` | "Straight lines — this route will not follow roads" |

The **Add map regions…** button sits in a hint bar that is otherwise
`pointer-events: none`, so the button itself takes pointer events. It opens
the region picker, and drawing continues underneath.

`RoadDataSection` shows "Snap to roads" only when
`provenance.routingProvider === null`, meaning a route that does not already
follow roads.

## 3. Terrain elevation

### 3.1 Data

Terrain Tiles on the AWS Registry of Open Data, `skadi` layout:
`https://elevation-tiles-prod.s3.amazonaws.com/skadi/N53/N53W002.hgt.gz`. Each
tile is 1° × 1°. Big-endian `int16` metres, row-major from the north-west
corner. Either 3601 × 3601 (1″, about 30 m; what the UK gets) or
1201 × 1201 (3″). −32768 is a void.

### 3.2 `shared/geo/hgt.ts` (pure)

- `tileNameFor(lat, lon)` gives `N53W002`, from the floor of each coordinate.
  The south-west corner names the tile.
- `tilesCovering(box)` lists the names a bounding box touches.
- `hgtSize(byteLength)` returns 3601, 1201, or `null` (invalid; Requirement 3.7).
- `sampleHgt(view: DataView, size, tileLat, tileLon, lat, lon)` interpolates
  bilinearly. If any of the four corners is a void it returns `null`, not a
  blend with −32768.
- `gainLoss(values, thresholdM)` accumulates a climb only once it has gone
  `thresholdM` beyond the last turning point (hysteresis).
  `TERRAIN_GAIN_THRESHOLD_M = 3`. The reasoning: SRTM's vertical noise is a few
  metres. Sampled every 20–30 m along a road, cell-to-cell noise would
  otherwise be counted as climbing, inflating gain on flat ground. Recorded
  elevation keeps the existing, unthresholded `elevationProfile`, so no
  existing figure changes.

### 3.3 `main/terrain/terrainStore.ts`

- Tiles are kept gzipped under `userData/terrain/<name>.hgt.gz`, about 7 MB
  each against 26 MB unpacked. They are decompressed into memory on first use,
  with an LRU of 4 tiles. A tile that S3 answers 403 or 404 for is open sea, and
  is recorded as `<name>.none`, so it is not asked for again.
- `downloadTiles(names, { onProgress, signal })` downloads with
  `redirect: 'error'` and validates by `gunzipSync` plus `hgtSize`. The file is
  written to a temp name and renamed on success, so a partial download never
  sits in the cache.
- `elevations(points)` returns `{ values: (number | null)[], missingTiles: string[] }`.
- `TERRAIN_HOST` is declared in the module. It is main-process only, so the
  renderer CSP is unaffected.

### 3.4 Profile

`profileService.profileFor` gains an injected terrain source, so tests do not
touch disk. When no source point carries elevation:

- every tile present: the samples get terrain heights,
  `elevationSource = 'terrain'`, and the summary comes from
  `gainLoss(…, 3)`.
- tiles missing: elevation is absent with the reason "Terrain heights for this
  area are not downloaded yet.", plus `terrainMissing: { tileCount, approxBytes }`,
  where `approxBytes` is 7.5 MB per tile.

New IPC `routing:downloadTerrain { ownerType, ownerId }` downloads the tiles
covering that geometry's bounding box. The panel then reloads the profile.

The chart titles the line "Terrain elevation (model, about 30 m)". Gain and
loss read "Gain ≈ …".

## 4. Twisty score

`shared/geo/twistiness.ts`, already written and calibrated during the
investigation:

1. **Unknown** when the length is under 500 m, or the median source spacing is
   over 150 m. Hand-drawn lines have spacings in kilometres. Engine geometry
   and 1 Hz recordings are well under 50 m.
2. **Resample** every 20 m, which discards point density.
3. **Smooth** with a 3-point moving average, so alternating jitter cancels.
4. **Turning.** The signed heading change per step.
5. **Bends.** A same-sign run of steps with |turn| ≥ 2° (a radius under about
   570 m), tolerating one quiet step. The run counts if its total turn is at
   least 20° and its radius (arc ÷ angle) is at most 400 m. It is classed
   as hairpin (≥ 135° and ≤ 45 m), tight (≤ 60 m), bend (≤ 150 m) or
   sweeping. These radii are **measured** at 20 m resolution, which has a
   floor of roughly 25–30 m: a true 12 m hairpin measures 32 m, and a true
   25 m one measures 45 m.
6. **Score** = min(10, degrees per km ÷ 30). Levels: Straight below 1.5,
   Gentle below 2.5, Winding below 5, Twisty below 7.5, Very twisty above.
7. **Windows** of 1 km for the band along the profile. A tail under 500 m is
   folded into the last window.

Calibration, measured:

| Road | °/km | Score | Level |
| --- | --- | --- | --- |
| A537 Cat and Fiddle | 201 | 6.7 | Twisty |
| A57 Snake Pass | 79 | 2.6 | Winding |
| A523 | 70 | 2.3 | Gentle |
| A515 | 53 | 1.8 | Gentle |
| A53 | 45 | 1.5 | Gentle |
| M6 | 31 | 1.0 | Straight |

Snake Pass is mostly long sweeping curves (30 of its 39 counted bends), which
is why it lands below the Cat and Fiddle's tight sequence.

The live test re-measures with the fixture's via points and the Nominatim-resolved
endpoints (task 12): Cat and Fiddle 7.3, Snake Pass 2.7, A515 1.6, M6 0.9. The
Cat and Fiddle scores higher than in the table because its via points keep it
on the A537 through every bend.

**Known limitation.** A kilometre containing junction turns in a town scores
high, because a 90° turn at a T-junction is a bend by geometry. The overall
score is distance-weighted, so it is robust on a real ride. The kilometre band
will show a town centre as twisty, and the panel says so.

`Profile` gains `twistiness: Twistiness | null` and
`twistinessUnknownBecause: string | null`. It is computed on the **full**
source points, not the thinned samples. That is O(n), and the full points are
already in memory.

The chart adds a "Twistiness" band. Each window is coloured by level on a
sequential ramp, with a five-level key. The summary line reads: "Twisty score
6.7 / 10 · Twisty · 201°/km · 3.4 bends/km · 2 tight".

## 5. UK default limits

### 5.1 Data

`MatchedEdge` gains `oneway: boolean | null`, from `edge.traversability`
(`forward` or `backward` is one-way, `both` is not). `edge.traversability` is
added to `MATCH_ATTRIBUTES`. Cached payloads from before this phase have no
`oneway`. It reads as `null`, which the rule treats as single carriageway. A
"Look up road data" refresh brings it in.

### 5.2 `shared/geo/ukBoundary.ts`

`UK_BOUNDARY: Ring`, 150 points, generated by
`scripts/generate-uk-boundary.mjs` from the `united-kingdom` feature of
Geofabrik's index. The polygon is derived from OpenStreetMap: © OpenStreetMap
contributors, ODbL, and the header says so. `inUk(point)` uses a bounding-box
prefilter, then `pointInRing`.

### 5.3 `shared/routing/ukSpeedLimits.ts`

```ts
ukDefaultLimit(roadClass, oneway): { mps: number; basis: UkLimitBasis } | null
```

| Class | One-way | Limit | Basis |
| --- | --- | --- | --- |
| motorway | any | 70 mph | `motorway` |
| trunk, primary | true | 70 mph | `nsl-dual` |
| trunk, primary | false or null | 60 mph | `nsl-single` |
| secondary, tertiary, unclassified | any | 60 mph | `nsl-single` |
| residential, service_other | any | 30 mph | `restricted-road` |
| null | — | none | — |

Legal basis, cited in the module:

- the Motorways Traffic (Speed Limit) Regulations 1974 (motorways)
- the 70 mph, 60 mph and 50 mph (Temporary Speed Limit) (Continuation) Order
  1978 (national limits)
- the Road Traffic Regulation Act 1984, s.81–82 (restricted roads: 30 mph
  where street lighting is no more than 183 m apart).

**Two judgement calls**, stated here and in the UI:

1. Residential and service roads take 30 mph, not 60. The owner asked for the
   national speed limit, but in UK law a street-lit road is a restricted road
   at 30 mph, and counting a housing estate at 60 would be the larger error.
2. One-way trunk or primary is read as dual carriageway. A one-way street in a
   town on an A-road is the case this gets wrong. It is rare on trunk and
   primary roads, and the assumed label covers it.

### 5.4 Distribution and profile

- `SpeedSample` gains `assumed?: boolean`.
- `BandShare` gains `assumedDistanceM` and `assumedPercent`.
- `SpeedDistribution` gains `assumed: { distanceM, percent }`.
- `speedDistribution` adds an assumed sample to its band's distance and to the
  band's assumed distance. Unknown keeps only what no rule could place.

`roadAttributeService.postedSpeedSamples(shape, edges, options)` takes
`{ ukDefaults: boolean }`. For an edge with a null limit, it takes the midpoint
of the edge's own shape, and if that is `inUk` and the rule returns a limit,
emits an assumed sample. Otherwise the edge stays Unknown, as before.

`Profile` gains `assumedSpeedSpans: ProfileSpan<number>[] | null`.
`postedSpeedSpans` keeps its meaning (posted only), so nothing that reads it
changes. The band is drawn when either is non-empty.

The setting is `ukDefaultSpeedLimits: boolean`, default `true`, read by the IPC
handlers and passed in. The Settings dialog labels it: "Count UK roads with no
posted limit at the national default (shown as assumed)".

### 5.5 Display

- **`SpeedDistributionBar`.** Each band's segment draws its assumed part with a
  diagonal hatch over the band colour. The table adds an "of which assumed"
  column, shown only when anything is assumed. Under the bar: "Includes 41%
  assumed from UK default limits — no limit is posted in the map data for
  those roads."
- **Profile.** Assumed spans use the same colour at 45% opacity with the
  hatch, plus a key line: "Hatched: assumed UK default limit".

## 6. Attribution and licences

- **About window, data sources:** "Elevation: Terrain Tiles (Mapzen / AWS Open
  Data), derived from SRTM and other sources", and "UK boundary: ©
  OpenStreetMap contributors, ODbL".
- **Register, native tools:** osmium-tool 1.19.1 GPL-3.0-or-later, boost
  (program_options) BSL-1.0, lz4 BSD-2-Clause, expat MIT, bzip2 and zlib from
  the system. A new "Data" section covers the terrain tiles.

## 7. Testing

| Layer | What |
| --- | --- |
| Unit | Twistiness: straight is 0; a uniform 100 m radius scores; alternating jitter does not; hairpins are classed; sparse and short input is unknown; windows. |
| Unit | HGT: tile naming in all four hemispheres, covering tiles, size validation, bilinear values on a synthetic grid, voids are null, hysteresis gain. |
| Unit | UK rules table; `inUk` at Belfast, Shetland, Dublin, Douglas, Jersey; assumed share in the distribution; unknown stays unknown outside the UK and with no class; the setting off. |
| Unit | `ukRegions` from a fixture index; `projectRegions`; multi-region `downloadAndBuild` with fakes (refusals, merge invoked only for more than one, extracts deleted on failure); `readLoadedRegion` back-compat. |
| Unit | Profile service: terrain fallback, recorded precedence, missing tiles, twistiness, assumed spans. |
| Live (`npm run verify:regions`) | Download Derbyshire, Cheshire and Staffordshire, merge, build, and route the whole Buxton square; score the six reference roads and assert the ranking; terrain at Buxton and Ashbourne within 15 m of the known heights. |
| E2E | New Route with no region gives the straight-line hint and an Add regions button; no "Snap routing" toolbar button; the region picker map with a seeded index (select two counties, see the total); the profile shows the twisty score; the settings toggle exists. |

The region-picker end-to-end test seeds `geofabrik-index.json` from
`test-data/geofabrik-uk.json`. That is the UK features of the real index,
simplified to at most 40 points a ring: ODbL map data, not user GPS data.
Because `loadCatalogue` reads a fresh cached index before going to the network,
the test needs no network and no special hook.
