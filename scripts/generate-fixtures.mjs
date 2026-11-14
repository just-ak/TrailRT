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
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';
// TypeScript, imported directly: Node 26 strips types. Tests import the same
// module as `@fixtures/photos/exifWrite`.
import { withExif } from '../test-data/photos/exifWrite.ts';

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

const ALPS_ACTIVITY = [
  { lat: 46.5197, lon: 8.012, ele: 1850.5 },
  { lat: 46.5231, lon: 8.0168, ele: 1902.25 },
  { lat: 46.531, lon: 8.0255, ele: 2010 },
  { lat: 46.5402, lon: 8.031, ele: 2180 },
  { lat: 46.5602, lon: 8.0431, ele: 2431 },
];

function writeFit(
  path = join(outDir, 'activity.fit'),
  points = ALPS_ACTIVITY,
  start = Date.UTC(2026, 6, 14, 6, 30, 0),
) {
  const encoder = new FitEncoder();

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
  writeFileSync(path, bytes);
  return `${path.slice(outDir.length + 1)} (${bytes.length} bytes, ${points.length} records)`;
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

// ------------------------------------------------------------ photos

/**
 * The Phase 11 photo folder tree (design §13.1), in `generated/photos/`.
 *
 * Base images come from a BMP written here and converted by `sips`, Apple's
 * ImageIO, which also makes the HEIC files: the encoder the iPhone uses. The
 * EXIF blocks come from `test-data/photos/exifWrite.ts`, with every position
 * from the Buxton square in `places.json`. Nothing is recorded GPS data.
 *
 * macOS only, because of `sips`. The app is macOS only too.
 */

/** A 24-bit BMP: a gradient with a red block in the top-left corner, so a
 * rotated thumbnail shows which way it was turned. */
function bmp(width, height) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * height);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * height, 34);
  for (let y = 0; y < height; y += 1) {
    // BMP rows run bottom to top.
    const base = 54 + (height - 1 - y) * row;
    for (let x = 0; x < width; x += 1) {
      const marker = x < width / 5 && y < height / 5;
      out[base + x * 3] = marker ? 0 : Math.round((x / width) * 255); // blue
      out[base + x * 3 + 1] = marker ? 0 : 128; // green
      out[base + x * 3 + 2] = marker ? 255 : Math.round((y / height) * 255); // red
    }
  }
  return out;
}

const sips = (args) => execFileSync('/usr/bin/sips', args, { stdio: 'ignore' });

function writePhotoFixtures() {
  if (process.platform !== 'darwin') throw new Error('the photo fixtures need macOS (sips)');
  const { towns } = JSON.parse(readFileSync(join(dataDir, 'places.json'), 'utf8'));
  const photos = join(outDir, 'photos');
  const outside = join(outDir, 'photos-outside');
  rmSync(photos, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  mkdirSync(photos, { recursive: true });
  mkdirSync(outside, { recursive: true });

  const work = mkdtempSync(join(tmpdir(), 'trailrt-photo-fixtures-'));
  let count = 0;
  try {
    writeFileSync(join(work, 'base.bmp'), bmp(1200, 800));
    sips(['-s', 'format', 'jpeg', join(work, 'base.bmp'), '--out', join(work, 'base.jpg')]);
    const base = readFileSync(join(work, 'base.jpg'));
    const at = (town) => ({ lat: towns[town].lat, lon: towns[town].lon });

    const put = (dir, rel, spec) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), withExif(base, spec));
      count += 1;
    };
    const raw = (rel, bytes) => {
      mkdirSync(dirname(join(photos, rel)), { recursive: true });
      writeFileSync(join(photos, rel), bytes);
      count += 1;
    };

    // Located, with everything: altitude, accuracy, a true bearing, a zone.
    put(photos, 'buxton.jpg', {
      orientation: 1,
      taken: '2026:06:14 10:32:05',
      offset: '+01:00',
      gps: { ...at('buxton'), altitude: towns.buxton.eleM + 0.5, accuracy: 8, direction: 271.25, directionRef: 'T' },
    });
    // Orientation 6, no zone (camera time), no altitude.
    put(photos, 'leek-o6.jpg', { orientation: 6, taken: '2026:06:14 12:01:00', gps: at('leek') });
    // Below sea level: altitude reference 1.
    put(photos, 'ashbourne-below-sea.jpg', {
      orientation: 1,
      taken: '2026:06:14 13:00:00',
      gps: { ...at('ashbourne'), altitude: -12.25, direction: 45.5, directionRef: 'M' },
    });
    // Big-endian TIFF in a JPEG, as sips writes inside a HEIC.
    put(photos, 'macclesfield-be.jpg', {
      byteOrder: 'MM',
      orientation: 1,
      taken: '2026:06:15 09:15:00',
      offset: '-05:30',
      gps: { ...at('macclesfield'), altitude: towns.macclesfield.eleM },
    });
    // Unlocated, and rejected geotags.
    put(photos, 'no-gps.jpg', { orientation: 1, taken: '2026:06:14 15:00:00' });
    put(photos, 'zero-zero.jpg', { orientation: 1, taken: '2026:06:14 15:05:00', gps: { lat: 0, lon: 0 } });
    put(photos, 'out-of-range.jpg', { orientation: 1, taken: '2026:06:14 15:10:00', gps: { lat: 95, lon: towns.leek.lon } });
    put(photos, 'no-ref.jpg', { orientation: 1, taken: '2026:06:14 15:15:00', gps: { ...at('buxton'), latRef: null } });
    put(photos, 'zero-denominator.jpg', {
      orientation: 1,
      taken: '2026:06:14 15:20:00',
      gps: { latRaw: [[53, 1], [15, 1], [316_800, 0]], lon: towns.buxton.lon },
    });
    // Every orientation value.
    for (let o = 1; o <= 8; o += 1) {
      put(photos, `orientation-${o}.jpg`, { orientation: o, taken: `2026:06:16 10:0${o}:00`, gps: at('buxton') });
    }
    // A burst: five shots at one spot, a second apart.
    for (let i = 1; i <= 5; i += 1) {
      put(photos, `burst/${i}.jpg`, { orientation: 1, taken: `2026:06:14 11:00:0${i}`, offset: '+01:00', gps: at('leek') });
    }
    // Structure: nested, hidden, a symlink out, a Photos library.
    put(photos, 'nested/deeper/ashbourne.jpg', { orientation: 1, taken: '2026:06:15 16:00:00', gps: at('ashbourne') });
    put(photos, '.hidden/buxton.jpg', { orientation: 1, taken: '2026:06:15 17:00:00', gps: at('buxton') });
    put(outside, 'outside.jpg', { orientation: 1, taken: '2026:06:15 18:00:00', gps: at('macclesfield') });
    symlinkSync('../photos-outside', join(photos, 'link-out'));
    put(photos, 'Library.photoslibrary/originals/IMG_0001.jpg', { orientation: 1, gps: at('leek') });
    raw('Library.photoslibrary/database/Photos.sqlite', Buffer.alloc(0));

    // HEIC through ImageIO. It keeps the tags and rewrites the TIFF block
    // big-endian (design §0).
    for (const name of ['buxton', 'leek-o6']) {
      sips(['-s', 'format', 'heic', join(photos, `${name}.jpg`), '--out', join(photos, `${name}.heic`)]);
      count += 1;
    }

    // Unreadable: cut off inside the metadata, or not an image at all.
    raw('truncated.jpg', readFileSync(join(photos, 'buxton.jpg')).subarray(0, 120));
    raw('truncated.heic', readFileSync(join(photos, 'buxton.heic')).subarray(0, 1024));
    raw('not-an-image.jpg', Buffer.from('This is a text file with a .jpg name.\n'));
    raw('not-an-image.heic', Buffer.from('This is a text file with a .heic name.\n'));

    // A format that is counted, not read.
    writeFileSync(join(work, 'small.bmp'), bmp(64, 48));
    sips(['-s', 'format', 'png', join(work, 'small.bmp'), '--out', join(photos, 'notes.png')]);
    count += 1;

    // Files for later phases: indexed and never opened in Phase 11.
    mkdirSync(join(photos, 'tracks'), { recursive: true });
    raw('tracks/day-1.gpx', readFileSync(join(outDir, 'peak-district-loop.gpx')));
    writeFit(
      join(photos, 'tracks/day-2.fit'),
      ['buxton', 'macclesfield', 'leek', 'ashbourne'].map((t) => ({ lat: towns[t].lat, lon: towns[t].lon, ele: towns[t].eleM })),
      Date.UTC(2026, 5, 15, 8, 0, 0),
    );
    count += 1;
    // Not a playable video: a QuickTime `ftyp` box and nothing else. It only
    // has to be recognised by its extension.
    const mov = Buffer.alloc(20);
    mov.writeUInt32BE(20, 0);
    mov.write('ftypqt  ', 4, 'latin1');
    mov.write('qt  ', 16, 'latin1');
    raw('clip.mov', mov);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return `photos/ (${count} files, a symlink out to photos-outside/)`;
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
try {
  // After the Peak District GPX, which the photo tree copies in as a track.
  written.push(writePhotoFixtures());
} catch (cause) {
  console.error(
    `\nCould not generate the photo fixtures: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  console.error('Photo reader and scanner tests that need them will fail.\n');
}

console.log('Wrote to test-data/generated/:');
for (const line of written) console.log(`  ${line}`);
