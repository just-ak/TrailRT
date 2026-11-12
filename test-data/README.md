# Test fixtures

**Every file here is synthetic.** No real user GPS data is used in automated
tests, as Requirement 8.2 and `.kiro/steering/architecture.md` both require.
The coordinates in `places.json` are published positions of public places;
everything else is invented or interpolated between them.

Generated binary and bulk fixtures are not committed. Run:

```sh
npm run fixtures
```

to produce `generated/` (KMZ, FIT, the Peak District loop as GPX, a large
GPX, and the Phase 11 photo folder tree). The generator is
`scripts/generate-fixtures.mjs`.

### Photos (Phase 11)

`generated/photos/` is a linked-folder tree of JPEG and HEIC photos, with a
symbolic link out to `generated/photos-outside/`. Its contents and what each
file proves are listed in the Phase 11 design, §13.1. Base images are made by
`sips` from a generated BMP. EXIF is written by `photos/exifWrite.ts`, which
tests also import as `@fixtures/photos/exifWrite`. Every position is a town in
`places.json`; none is recorded GPS data. The HEIC files come from `sips`, the
same ImageIO encoder an iPhone uses, so the photo fixtures need macOS.

## The test geography: the Buxton square

`places.ts` is the single source of truth for **where** the tests happen, and
`places.json` holds the data behind it. Anything where the geography is
load-bearing — snapping, map-region selection, road attributes, the end-to-end
fixtures — imports it as `@fixtures/places`.

Four real market towns at the corners of a rough quadrilateral:

```
  Macclesfield ────── A537 "Cat and Fiddle" ────── Buxton
       │                                              │
     A523                                           A515
       │                                              │
     Leek ───────── A523 / A52 ───────────────── Ashbourne
```

Buxton and Macclesfield sit within 0.002° of the same latitude, so the northern
edge reads as a straight line and the shape reads as a box. About 88 km of
straight lines between the corners and their via points; **100.8 km by road**,
measured against a live Valhalla instance.

Using a real circuit rather than invented coordinates buys three things no
amount of synthetic data can:

- **Snapping becomes judgeable.** A snapped route is supposed to stay near the
  control points it was given, and with real roads there is something to be
  near. This is not theoretical: three of the via points were out by up to
  3.4 km when first written, and the corridor assertion is what found them.
  They were then resolved against OpenStreetMap through Nominatim, and the
  worst offset is now 76 m.
- **Speed limits can be checked properly.** UK limits are posted in mph, OSM
  stores "30 mph", and Valhalla answers in km/h — so the live tests see 48, 64
  and 80 km/h, which are 30, 40 and 50 mph exactly. Any break in that
  conversion chain moves the values off whole mph, which is asserted directly.
- **The region picker's hard case is real.** Geofabrik publishes England by
  county, and the loop spans three: Derbyshire (Buxton, Ashbourne), Cheshire
  (Macclesfield) and Staffordshire (Leek). So no county extract covers the
  square, which is exactly the situation `rankRegions` was designed around.

### Which extract a local test needs

| Running                                             | Needs                           |
| --------------------------------------------------- | ------------------------------- |
| Unit tests                                          | nothing; the provider is a fake |
| `npm run verify:valhalla` and the embedded e2e spec | Geofabrik `derbyshire`, 44 MB   |
| `npm run verify:valhalla:remote`                    | network only                    |

The A515 between Buxton and Ashbourne is the one leg that stays inside a single
county, which is why `A515_TRACE` exists and why the local tests use it. The
A537 over the Cat and Fiddle is the better road and what the live tests use,
but it crosses into Cheshire.

The two traces are sampled from real snapped routes, so their points lie on the
carriageway. That matters more than it sounds: map matching needs a dense
trace, and Valhalla answers sparse waypoints with HTTP 400 error 444 rather
than doing its best.

## Hand-written fixtures

The format fixtures below are **still in the Alps**, and deliberately so. They
exist to exercise parsing and exact round-tripping, where the coordinates are
arbitrary by design — moving them would churn a hundred exact-value assertions
for no added coverage. The one real gap that positive-only longitudes left is
closed by `generated/peak-district-loop.gpx`, which is west of Greenwich: a
dropped minus sign round-trips invisibly through a fixture east of it.

| File                        | Covers                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `alps-full.gpx`             | GPX 1.1 with waypoints, a route and a multi-segment track, all with elevation and time                          |
| `legacy-1.0.gpx`            | GPX 1.0, where elevation and time are present but the namespace differs                                         |
| `no-elevation.gpx`          | Points with no `<ele>` at all — must import as `null`, never `0`                                                |
| `no-time.gpx`               | Track with no timestamps, so duration is unavailable rather than zero                                           |
| `multi-segment.gpx`         | A single track split across three `<trkseg>` elements                                                           |
| `with-extensions.gpx`       | Garmin and custom extension namespaces that have no column, so must be reported as unmapped rather than dropped |
| `unknown-symbol.gpx`        | A `<sym>` outside our vocabulary, which must survive verbatim for export                                        |
| `empty.gpx`                 | Valid GPX containing nothing — a successful import of zero objects, not an error                                |
| `malformed.gpx`             | Truncated XML, which must fail with a located message and import nothing                                        |
| `places.kml`                | KML `Placemark` Point and LineString, plus `ExtendedData`                                                       |
| `gx-track.kml`              | Google `gx:Track` with `when`/`gx:coord` pairs                                                                  |
| `activity.tcx`              | TCX activity with heart rate and cadence, which become unmapped metadata                                        |
| `waypoints.csv`             | CSV waypoints with quoted fields, an embedded comma, and a blank elevation                                      |
| `headers-odd.csv`           | Non-standard column names, to exercise header mapping                                                           |
| `places.json` / `places.ts` | The test geography: the Buxton square, its road corridors, two on-road traces and the map viewports             |

## Coordinate conventions, deliberately differing

A frequent source of silent bugs, so each is covered by its own test:

- **GPX** uses `lat` and `lon` attributes.
- **KML** uses `lon,lat,ele` in a single text node — the opposite order.
- **FIT** stores semicircles: `degrees = semicircles × (180 / 2^31)`.

The sign is a fourth. Britain is west of Greenwich, so every coordinate in
`places.json` has a negative longitude, and the generated GPX loop carries that
through the parser and the writer. A fixture in the Alps cannot catch a dropped
minus because a positive longitude survives one unchanged.

## FIT is inherently lossy, and tests must not pretend otherwise

The "preserve values exactly" rule applies to what a format can represent. FIT
cannot represent arbitrary doubles:

- Coordinates are 32-bit semicircles, so a degree value quantises to about
  2 × 10⁻⁸° — roughly 2 mm. Writing 46.5197 and reading 46.51969998 is correct
  behaviour, not a bug.
- Altitude is a uint16 with scale 5 and offset 500, giving 0.2 m resolution.
  1850.5 m round-trips as 1850.6 m.

FIT tests therefore assert closeness with an explicit tolerance and a comment
saying why. GPX, KML and CSV tests assert exact equality, because those formats
are text and genuinely can round-trip a double.

## Phase 7 fixtures (ADR 0018)

- **`places.json` → `referenceRoads`.** Snake Pass (Glossop to the Ladybower Inn)
  and the M6 (Keele to Sandbach services), used to calibrate and check the
  twistiness score. Endpoints were resolved through Nominatim, not estimated, and
  each carries a corridor check that the live test asserts.
- **`geofabrik-uk.json`.** The UK features of Geofabrik's region index, each
  ring thinned to at most 40 points, for the region picker's end-to-end test. Map
  data, not user GPS data: © OpenStreetMap contributors, ODbL. Every download URL
  points at a `.invalid` host, so no test can ever start a real download.
