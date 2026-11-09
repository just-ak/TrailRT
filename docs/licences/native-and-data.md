## Native components: the embedded Valhalla routing engine

Maintained **by hand** in `docs/licences/native-and-data.md`, which
`npm run licences` appends to the generated register verbatim. These are not npm
dependencies, so the generator cannot see them — it reads the lockfile, and none
of this is in it. Edit that file, not the register; update it whenever
`VALHALLA_TAG` in `scripts/build-valhalla.sh` changes or the dependency set
moves.

Compiled into the shipped app, so all of it forms part of the combined work and
must be compatible with GPL-3.0-or-later. See ADR 0013.

| Component | Version | Licence | Verdict |
| --- | --- | --- | --- |
| valhalla | 3.9.1 | MIT | Fine |
| boost | 1.92.0 | BSL-1.0 | Fine |
| protobuf (+ abseil) | 36.2 | BSD-3-Clause | Fine |
| sqlite | 3.53.4 | Public domain | Fine |
| libspatialite | 5.1.0 | MPL-1.1 / GPL-2.0+ / LGPL-2.1+ | **LGPL-2.1-or-later elected** |
| luajit | 2.1 | MIT | Fine |
| geos | 3.15.0 | LGPL-2.1-or-later | Fine |
| lz4 | 1.11.0 | BSD-2-Clause (library) | Fine |
| libgeotiff | 1.7.4 | MIT-style | Fine |
| libtiff | 4.7.2 | libtiff (BSD-like) | Fine |
| openssl@3 | 3.6.3 | Apache-2.0 | Fine |
| expat | 2.10.0 | MIT | Fine |
| curl | 8.23.0 | curl (MIT-like) | Fine |
| proj | 9.9.0 | MIT | Fine |

### The licence election that matters

**libspatialite** and **readosm** are tri-licensed MPL-1.1 / GPL-2.0-or-later /
LGPL-2.1-or-later. MPL-1.1 on its own is *not* GPL-compatible, so the default
reading would make them unusable here. The tri-licence lets us take them under
**LGPL-2.1-or-later**, which combines with GPL-3.0 because of the "or later".
That election is deliberate and must be restated if these are ever upgraded.

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

### Bundled beside Valhalla: osmium-tool (ADR 0018)

`resources/valhalla/bin/osmium` merges several regions' extracts into one before
the tile build, because Valhalla aborts on overlapping extracts. Copied from the
Homebrew bottle by `scripts/bundle-valhalla.sh` and made relocatable with the
rest. A separate executable, run as a child process.

| Component | Version | Licence | Verdict |
| --- | --- | --- | --- |
| osmium-tool | 1.19.1 | GPL-3.0-or-later | Fine — same licence family as the app |
| libosmium (header-only, compiled in) | 2.23.1 | BSL-1.0 | Fine |
| protozero (header-only, compiled in) | — | BSD-2-Clause | Fine |
| boost (program_options, container) | 1.92.0 | BSL-1.0 | Fine — already listed |
| lz4 | 1.11.0 | BSD-2-Clause | Fine — already listed |
| expat, zlib, bzip2 | system | MIT / zlib / bzip2 | Fine — macOS system libraries, not shipped |

GPL-3.0-or-later obliges us to offer osmium-tool's corresponding source with the
binary. The version above plus the public upstream repository
(<https://github.com/osmcode/osmium-tool>, tag `v1.19.1`) identifies it exactly,
and is published with each release alongside TrailRT's own source.

Nothing in these tables carries a field-of-use restriction, and nothing is
GPL-2.0-**only**, which is the combination the licensing rules reject.

### Source availability

Shipping a compiled Valhalla obliges us to publish the corresponding source for
the combined work. Valhalla is MIT, so its own terms add no requirement beyond
attribution, and the pinned tag in `scripts/build-valhalla.sh` plus the public
repository identifies exactly what was built. The GPL-3.0 obligation is met by
publishing TrailRT's source together with that pin.

## Data downloaded at runtime (ADR 0018)

Not code, and not shipped in the app: fetched at the user's choice, cached in
their data directory, and attributed in the About window.

| Data | Source | Terms |
| --- | --- | --- |
| Road graph extracts | Geofabrik (`download.geofabrik.de`) | © OpenStreetMap contributors, ODbL 1.0 |
| UK boundary (`src/shared/geo/ukBoundary.ts`, 150 points, generated) | Geofabrik region index | © OpenStreetMap contributors, ODbL 1.0 |
| Terrain elevation tiles | Terrain Tiles, AWS Registry of Open Data (`elevation-tiles-prod.s3.amazonaws.com`) | Open data, derived from SRTM (NASA, public domain) and other sources listed at <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>. Attribution required; given in the About window |
