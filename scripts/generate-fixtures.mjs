/**
 * Generates the binary and bulk test fixtures.
 *
 * These are produced rather than committed: a KMZ is a zip, a FIT file is
 * binary, and the large GPX is several megabytes. Committing them would bloat
 * the repository and make a diff meaningless.
 *
 *   npm run fixtures
 *
 * Everything generated here is synthetic, as Requirement 8.2 demands.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'test-data');
const outDir = join(dataDir, 'generated');
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- KMZ

async function writeKmz() {
  const kml = readFileSync(join(dataDir, 'places.kml'), 'utf8');
  const zip = new JSZip();
  // Google Earth's convention is doc.kml at the archive root.
  zip.file('doc.kml', kml);
  zip.file('README.txt', 'Synthetic TrailRT fixture.');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(join(outDir, 'places.kmz'), bytes);
  return `places.kmz (${bytes.length} bytes)`;
}

/** A KMZ with no .kml entry at all, which must be reported, not crash. */
async function writeKmzWithoutKml() {
  const zip = new JSZip();
  zip.file('notes.txt', 'There is no KML document in this archive.');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(join(outDir, 'no-document.kmz'), bytes);
  return `no-document.kmz (${bytes.length} bytes)`;
}

// ---------------------------------------------------------------- FIT

/**
 * Writes a minimal FIT activity.
 *
 * `FitEncoder` is a generic binary encoder: it takes FIT profile field numbers,
 * base types and *already-scaled* raw values, and applies no profile knowledge
 * of its own. So the profile details live here:
 *
 *   message 0  file_id   type(0) manufacturer(1) time_created(4)
 *   message 20 record    position_lat(0) position_long(1) altitude(2) timestamp(253)
 *
 * The scalings below are exactly what the reader has to undo, which is the
 * point of generating the fixture this way rather than committing an opaque
 * binary.
 */
// Degrees to semicircles: FIT's native angular unit.
const SEMICIRCLES_PER_DEGREE = 2 ** 31 / 180;
const toSemicircles = (deg) => Math.round(deg * SEMICIRCLES_PER_DEGREE);
// FIT altitude is uint16 with scale 5 and offset 500 metres.
const toFitAltitude = (metres) => Math.round((metres + 500) * 5);

function writeFit() {
  const encoder = new FitEncoder();

  const start = Date.UTC(2026, 6, 14, 6, 30, 0);
  const points = [
    { lat: 46.5197, lon: 8.012, ele: 1850.5 },
    { lat: 46.5231, lon: 8.0168, ele: 1902.25 },
    { lat: 46.531, lon: 8.0255, ele: 2010 },
    { lat: 46.5402, lon: 8.031, ele: 2180 },
    { lat: 46.5602, lon: 8.0431, ele: 2431 },
  ];

  // file_id: an activity file, so a reader knows what it is holding.
  encoder.writeMessage(
    0,
    [
      { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 }, // type = activity
      { number: 1, size: 2, baseType: FitBaseType.Uint16, value: 1 }, // manufacturer = garmin
      {
        number: 4,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: FitEncoder.toFitTimestamp(new Date(start)),
      },
    ],
    0,
  );

  for (const [index, point] of points.entries()) {
    encoder.writeMessage(
      20,
      [
        {
          number: 253,
          size: 4,
          baseType: FitBaseType.Uint32,
          value: FitEncoder.toFitTimestamp(
            new Date(start + index * 15 * 60 * 1000),
          ),
        },
        {
          number: 0,
          size: 4,
          baseType: FitBaseType.Sint32,
          value: toSemicircles(point.lat),
        },
        {
          number: 1,
          size: 4,
          baseType: FitBaseType.Sint32,
          value: toSemicircles(point.lon),
        },
        {
          number: 2,
          size: 2,
          baseType: FitBaseType.Uint16,
          value: toFitAltitude(point.ele),
        },
      ],
      1,
    );
  }

  const bytes = Buffer.from(encoder.close());
  writeFileSync(join(outDir, 'activity.fit'), bytes);
  return `activity.fit (${bytes.length} bytes, ${points.length} records)`;
}

// ------------------------------------------- the Peak District loop, as GPX

/**
 * The shared test geography as a GPX file.
 *
 * Generated from `test-data/places.json` rather than committed, so the one
 * definition of the Buxton square serves the unit tests, the end-to-end specs
 * and the import fixtures without three copies to keep in step.
 *
 * It carries all three object kinds — four waypoints, a four-point route, and
 * a four-segment track — and, unlike every other fixture here, **negative
 * longitudes**. That is the point of having it: a dropped minus sign in a
 * parser or writer is invisible when every test coordinate is east of
 * Greenwich, because a positive longitude round-trips through a sign bug
 * unchanged.
 */
const esc = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function writePeakDistrictGpx() {
  const places = JSON.parse(
    readFileSync(join(dataDir, 'places.json'), 'utf8'),
  );
  const towns = places.towns;
  const order = ['buxton', 'macclesfield', 'leek', 'ashbourne'];

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Synthetic. Generated by scripts/generate-fixtures.mjs from',
    '     test-data/places.json. Public place coordinates, not recorded GPS. -->',
    '<gpx version="1.1" creator="TrailRT fixture generator"',
    '     xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata><name>Peak District loop</name></metadata>',
  ];

  // Waypoints: the four corners.
  for (const id of order) {
    const town = towns[id];
    lines.push(
      `  <wpt lat="${town.lat}" lon="${town.lon}">`,
      `    <ele>${town.eleM}</ele>`,
      `    <name>${esc(town.name)}</name>`,
      `    <desc>${esc(town.county)}</desc>`,
      '    <sym>Flag, Blue</sym>',
      '  </wpt>',
    );
  }

  // Route: the corners, closed back to the start.
  lines.push('  <rte>', '    <name>Buxton square</name>');
  for (const id of [...order, order[0]]) {
    const town = towns[id];
    lines.push(
      `    <rtept lat="${town.lat}" lon="${town.lon}"><ele>${town.eleM}</ele>` +
        `<name>${esc(town.name)}</name></rtept>`,
    );
  }
  lines.push('  </rte>');

  // Track: one segment per leg, so the segment-preservation rules have a real
  // multi-segment recording to work on.
  lines.push('  <trk>', '    <name>Peak District ride</name>');
  let stamp = Date.UTC(2026, 4, 16, 9, 0, 0);
  for (const leg of places.legs) {
    lines.push('    <trkseg>');
    for (const point of [towns[leg.from], ...leg.via, towns[leg.to]]) {
      lines.push(
        `      <trkpt lat="${point.lat}" lon="${point.lon}">` +
          `<ele>${point.eleM}</ele>` +
          `<time>${new Date(stamp).toISOString()}</time></trkpt>`,
      );
      stamp += 10 * 60 * 1000;
    }
    lines.push('    </trkseg>');
    // An hour's gap between legs, so no reader can mistake the break for a
    // sampling interval.
    stamp += 60 * 60 * 1000;
  }
  lines.push('  </trk>', '</gpx>', '');

  const text = lines.join('\n');
  writeFileSync(join(outDir, 'peak-district-loop.gpx'), text);
  return `peak-district-loop.gpx (4 waypoints, 5-point route, ${places.legs.length} track segments)`;
}

// ------------------------------------------------------ large GPX track

function writeLargeGpx(pointCount = 200_000) {
  // Built as string chunks: a 200k-point document assembled by concatenation
  // one point at a time is itself slow enough to notice.
  const chunks = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<!-- Synthetic. Generated by scripts/generate-fixtures.mjs for the import ',
    'performance assertion. -->\n',
    '<gpx version="1.1" creator="TrailRT fixture generator" ',
    'xmlns="http://www.topografix.com/GPX/1/1">\n',
    `  <trk>\n    <name>Large Recorded Track</name>\n    <trkseg>\n`,
  ];

  const start = Date.UTC(2026, 7, 1, 4, 0, 0);
  for (let i = 0; i < pointCount; i += 1) {
    // Wandering the White Peak south of Buxton. Negative longitudes, so the
    // bulk-import path is exercised with the same sign the real fixtures use.
    const lat = 53.14 + Math.sin(i / 2000) * 0.1 + (i % 7) * 0.0000012;
    const lon = -1.9 + i * 0.0000045;
    const ele = 300 + Math.sin(i / 1500) * 180;
    const time = new Date(start + i * 1000).toISOString();
    chunks.push(
      `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">` +
        `<ele>${ele.toFixed(2)}</ele><time>${time}</time></trkpt>\n`,
    );
  }

  chunks.push('    </trkseg>\n  </trk>\n</gpx>\n');
  const text = chunks.join('');
  writeFileSync(join(outDir, 'large-track.gpx'), text);
  return `large-track.gpx (${pointCount} points, ${(text.length / 1e6).toFixed(1)} MB)`;
}

// ---------------------------------------------------------------- run

const written = [];
written.push(await writeKmz());
written.push(await writeKmzWithoutKml());
try {
  written.push(writeFit());
} catch (cause) {
  // The FIT encoder is a convenience, not a requirement. If its API differs,
  // say so plainly rather than failing the whole fixture build.
  console.error(
    `\nCould not generate the FIT fixture: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  console.error('FIT reader tests that need it will be skipped.\n');
}
written.push(writePeakDistrictGpx());
written.push(writeLargeGpx());

console.log('Wrote to test-data/generated/:');
for (const line of written) console.log(`  ${line}`);
