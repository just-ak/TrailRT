#!/usr/bin/env node
/**
 * Trims a real `osmium export -f geojsonseq` of the Buxton area down to the
 * committed fixture in `test-data/places-excerpt/buxton.geojsonseq`.
 *
 * Usage:
 *   osmium extract -b -1.93,53.25,-1.89,53.265 derbyshire.osm.pbf -o buxton.osm.pbf -s complete_ways
 *   osmium export buxton.osm.pbf -f geojsonseq -a type,id -o buxton.geojsonseq
 *   node scripts/trim-places-fixture.mjs buxton.geojsonseq > test-data/places-excerpt/buxton.geojsonseq
 *
 * Keeps every feature whose representative point falls in a box round the
 * town centre, and drops tags no test reads, so the file stays small. The
 * coordinates are not altered. See test-data/places-excerpt/README.md.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const BOX = { minLon: -1.9185, maxLon: -1.9035, minLat: 53.2545, maxLat: 53.2625 };
const KEEP = /^(@type|@id|name|place|highway|tourism|amenity|shop|historic|access|parking|brand|operator|stars|opening_hours|phone|website|addr:.*|fuel:.*|socket:.*|building)$/;

function point(geometry) {
  if (geometry.type === 'Point') return geometry.coordinates;
  if (geometry.type === 'LineString') return geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  const sum = ring.reduce(([x, y], [a, b]) => [x + a, y + b], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}

const input = createInterface({ input: createReadStream(process.argv[2]) });
for await (const raw of input) {
  const line = raw.charCodeAt(0) === 0x1e ? raw.slice(1) : raw;
  if (line.trim() === '') continue;
  const feature = JSON.parse(line);
  const [lon, lat] = point(feature.geometry);
  const tags = feature.properties;
  // Settlements and points of interest are kept from the whole export, so
  // streets have several settlements to be assigned between and the POI tests
  // have fuel stations. Roads and addresses only from the box round the centre.
  const wide = tags.place !== undefined || ['tourism', 'amenity', 'shop', 'historic'].some((k) => tags[k] !== undefined && tags.highway === undefined && tags['addr:housenumber'] === undefined);
  const inBox = lon >= BOX.minLon && lon <= BOX.maxLon && lat >= BOX.minLat && lat <= BOX.maxLat;
  if (!wide && !inBox) continue;
  if (tags.highway !== undefined && tags.name === undefined) continue;
  const properties = Object.fromEntries(Object.entries(tags).filter(([key]) => KEEP.test(key)));
  // A building with no address, name or POI tag says nothing any test reads.
  if (Object.keys(properties).every((key) => key === '@type' || key === '@id' || key === 'building')) continue;
  process.stdout.write(`\u001e${JSON.stringify({ type: 'Feature', geometry: feature.geometry, properties })}\n`);
}
