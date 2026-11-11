# Place data excerpt: Buxton

`buxton.geojsonseq` is a small excerpt of real OpenStreetMap data round
Buxton, used by the place-data tests (Phase 10 Requirements 13.4, 13.5 and
13.11). The coordinates are OSM's own, not invented, as the test-geography
rule in `.kiro/steering/architecture.md` requires.

© OpenStreetMap contributors. This excerpt is made available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
It is a Derivative Database of OpenStreetMap, published here as ODbL §4.4
requires for a distributed one.

## Source

- Geofabrik `derbyshire-latest.osm.pbf`, data timestamp 2026-11-08T21:21:00Z,
  downloaded 10 November 2026
- Filtered with the same tag set the app uses (`shared/poi/categories.ts`,
  place nodes, named highways, `addr:housenumber`)

## How it was made

```sh
osmium tags-filter derbyshire.osm.pbf <the app's filter expressions> -o filtered.osm.pbf
osmium extract -b -1.97,53.22,-1.85,53.29 filtered.osm.pbf -o buxton.osm.pbf -s complete_ways
osmium export buxton.osm.pbf -f geojsonseq -a type,id -o buxton.geojsonseq
node scripts/trim-places-fixture.mjs buxton.geojsonseq > test-data/places-excerpt/buxton.geojsonseq
```

The trim keeps every settlement and point of interest in that box, and named
roads and addressed buildings only from a smaller box round the town centre.
It also drops tags no test reads. It does not change a coordinate.

## What the tests rely on

- **The Palace Hotel** (`way/117882931`) is mapped as a building outline.
  `osmium export` emits it twice, as a LineString and as a MultiPolygon, which
  is the duplication the ingest has to collapse (design §0).
- **Buxton Crescent Hotel and Spa** is a multipolygon relation
  (`relation/16879689`).
- **Eleven settlements**: Buxton (town), Burbage, Harpur Hill and Peak Dale
  (villages), Fairfield (suburb), four hamlets and two localities. Streets are
  assigned between them.
- **Three fuel stations**: Esso Buxton Express, Morrisons and Essar Rockbay
  Service Station.
