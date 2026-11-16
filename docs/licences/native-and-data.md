## Native components: the embedded Valhalla routing engine

Maintained **by hand** in `docs/licences/native-and-data.md`, which
`npm run licences` appends to the generated register verbatim. These are not npm
dependencies, so the generator cannot see them — it reads the lockfile, and none
of this is in it. Edit that file, not the register; update it whenever
`VALHALLA_TAG` in `scripts/build-valhalla.sh` changes or the dependency set
moves.

Compiled into the shipped app, so all of it reaches users and must suit an MIT
app distributed through the Mac App Store: permissive, or MPL, and never GPL.
LGPL is reviewed case by case. See ADRs 0013 and 0024.

| Component | Version | Licence | Verdict |
| --- | --- | --- | --- |
| valhalla | 3.9.1 | MIT | Fine |
| boost | 1.92.0 | BSL-1.0 | Fine |
| protobuf (+ abseil) | 36.2 | BSD-3-Clause | Fine |
| sqlite | 3.53.4 | Public domain | Fine |
| libspatialite | 5.1.0 | MPL-1.1 / GPL-2.0+ / LGPL-2.1+ | **MPL-1.1 elected** (ADR 0024) |
| luajit | 2.1 | MIT | Fine |
| geos | 3.15.0 | LGPL-2.1-or-later | **Open question for the App Store build** — see below |
| lz4 | 1.11.0 | BSD-2-Clause (library) | Fine |
| libgeotiff | 1.7.4 | MIT-style | Fine |
| libtiff | 4.7.2 | libtiff (BSD-like) | Fine |
| openssl@3 | 3.6.3 | Apache-2.0 | Fine |
| expat | 2.10.0 | MIT | Fine |
| curl | 8.23.0 | curl (MIT-like) | Fine |
| proj | 9.9.0 | MIT | Fine |

### The licence elections that matter

**libspatialite** and **readosm** are tri-licensed MPL-1.1 / GPL-2.0-or-later /
LGPL-2.1-or-later. While TrailRT was GPL-3.0 we took them under LGPL, because
MPL-1.1 does not combine with GPL. TrailRT is now MIT (ADR 0024), so we take
them under **MPL-1.1**. That licence is file-level: it covers changes to their
own files only, imposes no relinking terms, and suits the App Store. We do not
modify them. The election is deliberate and must be restated if these are ever
upgraded.

**geos** is LGPL-2.1-or-later only. It is dynamically linked, which meets the
LGPL for the DMG, because a user can replace the dylib. Inside a signed App
Store bundle they cannot, and whether that meets LGPL §6 is contested. Phase 15
settles it before any store submission: either show that the shipped tools and
addon do not need geos and drop it from the closure, or get advice and record
it here.

### Bundled inside Valhalla's own source tree

Verified against each component's licence file at tag 3.9.1:

| Component | Licence |
| --- | --- |
| cpp-statsd-client, date, dirent, just_gtfs, rapidjson, unordered_dense, microtar, cxxopts, flatbush | MIT |
| libosmium | BSL-1.0 |
| protozero | BSD-2-Clause (notice file Apache-2.0) |
| vtzero | BSD-2-Clause |
| nanobind | BSD-3-Clause |
| tz | Public domain |
| googletest, fastcov | BSD-3-Clause / MIT — build and test only, not shipped |

### Bundled beside Valhalla: trailrt-osm (ADRs 0018, 0023)

`resources/valhalla/bin/trailrt-osm` merges several regions' extracts into one
before the tile build, because Valhalla aborts on overlapping extracts, and
pulls place data out of the extract for offline search. It is TrailRT's own
code (`native/trailrt-osm/`, MIT), built by
`scripts/build-osm-tool.sh` against the libraries below. A separate
executable, run as a child process. It replaced the osmium-tool executable,
which is no longer bundled or built.

| Component | Version | Licence | Verdict |
| --- | --- | --- | --- |
| libosmium (header-only, compiled in) | 2.23.1 | BSL-1.0 | Fine |
| protozero (header-only, compiled in) | 1.8.2 | BSD-2-Clause | Fine |
| expat, zlib | system | MIT / zlib | Fine — macOS system libraries, not shipped |

Nothing in these tables carries a field-of-use restriction, and nothing is
GPL. The one LGPL-only component, geos, is the open question above.

### Source availability

Valhalla is MIT, so its own terms require attribution only. The pinned tag in
`scripts/build-valhalla.sh` plus the public repository identifies exactly what
was built. TrailRT no longer owes corresponding source under GPL (ADR 0024),
but publishes it with every release anyway. While geos is bundled, its source
(version above, from <https://github.com/libgeos/geos>) is offered too, as the
LGPL requires.

## Data downloaded at runtime (ADRs 0018, 0019)

Not code, and not shipped in the app: fetched at the user's choice, cached in
their data directory, and attributed in the About window.

| Data | Source | Terms |
| --- | --- | --- |
| Road graph extracts | Geofabrik (`download.geofabrik.de`) | © OpenStreetMap contributors, ODbL 1.0 |
| UK boundary (`src/shared/geo/ukBoundary.ts`, 150 points, generated) | Geofabrik region index | © OpenStreetMap contributors, ODbL 1.0 |
| Terrain elevation tiles | Terrain Tiles, AWS Registry of Open Data (`elevation-tiles-prod.s3.amazonaws.com`) | Open data, derived from SRTM (NASA, public domain) and other sources listed at <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>. Attribution required; given in the About window |
| Place data: POIs, place and street names, addressed buildings (`places.sqlite`) | Built on the user's machine from the same Geofabrik extracts, during the region build | © OpenStreetMap contributors, ODbL 1.0. A Derivative Database used on the user's own machine and not publicly distributed, so share-alike is not triggered; attribution shown with every search result and POI list, and in the About window |
| Postcodes (`postcodes.sqlite`) | Ordnance Survey Code-Point Open (`api.os.uk`, one redirect to OS's Azure storage), fetched from Settings | Open Government Licence v3.0. Requires: "Contains OS data © Crown copyright and database right", "Contains Royal Mail data © Royal Mail copyright and database right", "Contains National Statistics data © Crown copyright and database right", with the release's year; shown beside postcode results and in the About window |

### Test fixtures with third-party data (Phase 10)

Committed to the repository, so distributed with the source.

| Fixture | Source | Terms |
| --- | --- | --- |
| `test-data/places-excerpt/` (`buxton.geojsonseq`, `tiny.osm`) | Geofabrik Derbyshire extract, data of 2026-11-08 | © OpenStreetMap contributors. Published under ODbL 1.0, as a distributed Derivative Database must be; see its README |
| `test-data/codepoint/` (279 postcodes, licence and metadata files) | Code-Point Open release 2026-11 | Open Government Licence v3.0, with the statements above; see its README |
