# ADR 0023: libosmium replaces the bundled osmium-tool executable

Status: accepted
Date: 2026-11-16
Amends ADR 0018 §1 (how regions are merged) and ADR 0019 §4 (how place data
is pulled from the build).

## Context

Since Phase 7 the app has shipped the `osmium` executable from osmium-tool
1.19.1 (GPL-3.0-or-later) at `resources/valhalla/bin/osmium`, copied from the
Homebrew bottle. It did four jobs:

| Job | Command | Caller |
| --- | --- | --- |
| Merge overlapping county extracts before the tile build | `osmium merge` | `main/routing/mergeExtracts.ts` |
| Read an extract's data date | `osmium fileinfo -g header.option.osmosis_replication_timestamp` | `main/places/extract.ts` |
| Pull POIs, places, streets and addresses out of the extract | `osmium tags-filter`, then `osmium export -f geojsonseq` | `main/places/extract.ts` |
| Convert the package check's hand-written `.osm` to `.pbf` | `osmium cat` | `scripts/verify-package.mjs` |

The owner asked for the osmium-tool executable to be removed, for licensing
reasons, and for the app to use libosmium instead. The reason is the Mac App
Store: a GPL program cannot be offered there. The rest of that change is ADR
0024, which relicenses TrailRT itself as MIT. libosmium is the C++ library
osmium-tool is built on. It is BSL-1.0 and header-only, and Valhalla already
compiles a copy of it in.

## Decision

TrailRT carries its own small tool, **`trailrt-osm`**, in
`native/trailrt-osm/`: one C++ file of our own (MIT, like the rest of the app
since ADR 0024) built against libosmium 2.23.1 (BSL-1.0) and protozero 1.8.2
(BSD-2-Clause), both header-only, from Homebrew. It links zlib and expat from
the macOS SDK, so the bundle gains no dylibs. `scripts/build-osm-tool.sh`
builds it (and `build-valhalla.sh` runs that at the end), and
`bundle-valhalla.sh` puts it where `osmium` was, at
`resources/valhalla/bin/trailrt-osm`. osmium-tool is no longer a build
dependency, and `verify-package.mjs` fails if an `osmium` binary is bundled.

It stays a **separate executable run as a child process**, not an N-API addon.
The app's cancel and failure handling (`toolExit.ts`) is built around killable
one-shot processes, and a crash in OSM parsing must not take down the main
process.

| Subcommand | Replaces | Notes |
| --- | --- | --- |
| `merge OUTPUT INPUT...` | `osmium merge` and `osmium cat` | A k-way merge of sorted inputs. Keeps each object **once, at its newest version**. Refuses an unsorted input. |
| `data-date INPUT` | `osmium fileinfo -g …` | Prints the PBF header's replication timestamp, or an empty line. |
| `places INPUT OUTPUT EXPR...` | `osmium tags-filter` + `osmium export` | One process instead of two, with no intermediate file. Accepts only the expression forms the app generates (`nwr/key`, `nwr/key=a,b`) and refuses the rest. |

### What changed in behaviour, measured

All measurements are on the cached Derbyshire extract of 7 November 2026 and
Cheshire of 15 November 2026, on the same machine, against osmium-tool 1.19.1.

- **Merge.** Node and way counts are identical. The old merge wrote four
  relations twice (`r37676`, `r62149`, `r7884303`, `r14018636`), once from each
  county's snapshot, because osmium merge keeps every version. The new merge
  keeps only the newer version, and the output contains no object twice. In
  every other respect the files are identical: an OPL diff of the two contains
  only those four lines. Counties downloaded on different days are normal
  (each download is cached), so the old behaviour handed Valhalla duplicate
  ids. Time is about 1 s either way.
- **Places.** Every feature the filter selects is byte-identical to `osmium
  export`'s line for it (382,484 features). That includes the duplicated
  LineString and MultiPolygon for closed ways, which the ingest already
  handles. The old output also had 60,978 features the filter did not select.
  `tags-filter` passes on the tagged nodes and member ways it pulls in as
  references, such as crossings, and the ingest discarded them. The ingest
  builds the same rows from either file. Only the autoincrement ids differ,
  because relation areas arrive in a different order.
- **Cost.** `places` takes 1.9 s and peaks at 130 MB. Before, the two steps
  took 1.6 s together, and `tags-filter` alone peaked at **2.1 GB**. `places`
  keeps locations only for nodes it needs, in sorted vectors, rather than for
  every node in the extract.

### What was not chosen

- **Valhalla's vendored libosmium.** Valhalla 3.9.1 carries a copy of
  libosmium 2.19 in `third_party/`. Building against it would save one
  Homebrew formula, but the toolchain policy prefers the current stable
  release, and 2.23.1 is it.
- **An N-API addon.** Rejected for the crash-isolation and cancellation
  reasons above.
- **Merging and filtering in TypeScript.** ADR 0018 rejected this already.
  It would mean writing and maintaining a PBF decoder and encoder, which is
  exactly what libosmium is for.

## Consequences

- libosmium and protozero are compiled into a shipped binary, so they are
  listed in `docs/licences/native-and-data.md` (and thus the register). Both
  are permissive and need attribution only. osmium-tool and its own source
  offer are removed from the register.
- The About window credits libosmium (BSL-1.0) for combining regions,
  instead of osmium-tool.
- The tool accepts a subset of osmium-tool's tags-filter syntax. A new kind of
  expression in `shared/poi/categories.ts` has to be added to
  `native/trailrt-osm/` as well. The integration test fails if it is not,
  because the tool refuses an expression it does not understand rather than
  matching nothing.
- lz4-compressed PBF input is not supported, because zlib is the only PBF
  compression built in. Geofabrik writes zlib.
- The fixtures in `test-data/places-excerpt/` were produced with osmium-tool on
  a developer machine. That is how they were made, not something the app
  ships, and their provenance notes are left as they were.
