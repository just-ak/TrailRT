import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { gridToWgs84 } from '@shared/geo/osgb';
import { formatPostcode } from '@shared/search/postcode';
import { ServiceError } from '../services/errors';

/**
 * Code-Point Open: every postcode in Great Britain, fetched on request and
 * stored on this machine. Phase 10 Requirement 11.9, design §7.2, ADR 0019 §5.
 *
 * Fetching it is the only network action postcode search takes, and the user
 * takes it from Settings after seeing the size. Every search is then answered
 * locally.
 *
 * ## The one redirect
 *
 * The download URL answers 307 to Ordnance Survey's Azure storage. The
 * Geofabrik client refuses every cross-origin redirect, so a region index
 * cannot decide where the app downloads from. This client allows **exactly**
 * one hop, from `api.os.uk` to one named storage host, and checks the MD5 that
 * the OS listing publishes before using the file. Anything else is refused.
 */

const PRODUCT_URL = 'https://api.os.uk/downloads/v1/products/CodePointOpen';
const DOWNLOADS_URL = `${PRODUCT_URL}/downloads`;
const API_ORIGIN = 'https://api.os.uk';
const STORAGE_ORIGIN = 'https://omseprd1stdstordownload.blob.core.windows.net';
const USER_AGENT = 'TrailRT/0.1.0 (+https://github.com/trailrt/trailrt)';

/** The release is about 15 MB; anything far larger is not what was listed. */
const MAX_ZIP_BYTES = 100 * 1024 * 1024;

export const POSTCODES_SCHEMA = 1;

export interface PostcodeListing {
  /** OS's release name, e.g. `2026-11`. */
  release: string;
  url: string;
  sizeBytes: number;
  md5: string;
}

export interface PostcodeMeta {
  release: string;
  /** Copyright date of the release, `YYYY-MM-DD`. */
  date: string;
  count: number;
  /** Postcodes with positional quality 90: real, but with no location. */
  withoutLocation: number;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function postcodesFile(dir: string): string {
  return join(dir, 'postcodes.sqlite');
}

async function getJson(fetcher: Fetcher, url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    throw new ServiceError(
      'PROVIDER_UNAVAILABLE',
      'Ordnance Survey could not be reached. Check your connection and try again.',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  if (!response.ok) {
    throw new ServiceError('PROVIDER_UNAVAILABLE', `Ordnance Survey answered with HTTP ${response.status}.`);
  }
  return response.json();
}

/** The current release, its size and checksum, without downloading it. */
export async function fetchListing(fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<PostcodeListing> {
  const product = (await getJson(fetcher, PRODUCT_URL, signal)) as { version?: unknown };
  const downloads = (await getJson(fetcher, DOWNLOADS_URL, signal)) as unknown;
  const entry = Array.isArray(downloads)
    ? (downloads as Record<string, unknown>[]).find((d) => d.format === 'CSV' && d.area === 'GB')
    : undefined;
  if (
    typeof product.version !== 'string' ||
    entry === undefined ||
    typeof entry.url !== 'string' ||
    typeof entry.size !== 'number' ||
    typeof entry.md5 !== 'string'
  ) {
    throw new ServiceError('PROVIDER_ERROR', 'The Ordnance Survey download list was not in the expected form.');
  }
  if (new URL(entry.url).origin !== API_ORIGIN) {
    throw new ServiceError('PROVIDER_ERROR', 'The postcode download pointed somewhere other than Ordnance Survey.');
  }
  return { release: product.version, url: entry.url, sizeBytes: entry.size, md5: entry.md5.toLowerCase() };
}

/**
 * Downloads the release ZIP, following at most the one allowed redirect, and
 * checking size and MD5 as it streams.
 */
export async function downloadRelease(
  listing: PostcodeListing,
  destination: string,
  options: {
    fetcher?: Fetcher;
    signal?: AbortSignal;
    onProgress?: (receivedBytes: number, totalBytes: number) => void;
  } = {},
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const init: RequestInit = {
    headers: { 'User-Agent': USER_AGENT },
    credentials: 'omit',
    redirect: 'manual',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };

  let response = await fetcher(listing.url, init);
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    const next = location === null ? null : new URL(location, listing.url);
    if (next === null || next.origin !== STORAGE_ORIGIN || next.protocol !== 'https:') {
      throw new ServiceError(
        'PROVIDER_ERROR',
        'The postcode download was redirected to a server TrailRT does not recognise, so it was not followed.',
        next === null ? 'no Location header' : next.origin,
      );
    }
    response = await fetcher(next.toString(), init);
    if (response.status >= 300 && response.status < 400) {
      throw new ServiceError('PROVIDER_ERROR', 'The postcode download redirected more than once, which TrailRT will not follow.');
    }
  }
  if (!response.ok || response.body === null) {
    throw new ServiceError('PROVIDER_UNAVAILABLE', `The postcode download failed (HTTP ${response.status}).`);
  }

  const hash = createHash('md5');
  let received = 0;
  let lastReport = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      if (received > MAX_ZIP_BYTES) {
        callback(new ServiceError('PROVIDER_ERROR', 'The postcode download was far larger than listed, so it was stopped.'));
        return;
      }
      hash.update(chunk);
      const now = Date.now();
      if (now - lastReport > 250) {
        lastReport = now;
        options.onProgress?.(received, listing.sizeBytes);
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(destination),
    );
  } catch (error) {
    rmSync(destination, { force: true });
    if (options.signal?.aborted === true) throw new ServiceError('CANCELLED', 'The postcode download was cancelled.');
    throw error;
  }
  options.onProgress?.(received, listing.sizeBytes);

  const digest = hash.digest('hex');
  if (digest !== listing.md5) {
    rmSync(destination, { force: true });
    throw new ServiceError(
      'PROVIDER_ERROR',
      'The downloaded postcode file did not match its published checksum, so it was not used. Try again.',
      `md5 ${digest}, expected ${listing.md5}`,
    );
  }
}

/** `COPYRIGHT DATE: 20261019` in the release's metadata → `2026-10-19`. */
export function releaseDate(metadata: string): string | null {
  const match = /COPYRIGHT DATE:\s*(\d{4})(\d{2})(\d{2})/.exec(metadata);
  return match === null ? null : `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Reads the release ZIP into `postcodes.sqlite`, replacing the old file in one
 * step, and only once the new one is complete.
 */
export async function ingestRelease(zipPath: string, dir: string, release: string): Promise<PostcodeMeta> {
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const metadataFile = zip.file(/(^|\/)Doc\/metadata\.txt$/)[0];
  const date = metadataFile === undefined ? null : releaseDate(await metadataFile.async('string'));
  if (date === null) {
    throw new ServiceError('PROVIDER_ERROR', 'The postcode file had no release date, so it was not used.');
  }
  const csvs = zip.file(/(^|\/)Data\/CSV\/[a-z]+\.csv$/i);
  if (csvs.length === 0) {
    throw new ServiceError('PROVIDER_ERROR', 'The postcode file contained no postcode data.');
  }

  mkdirSync(dir, { recursive: true });
  const target = postcodesFile(dir);
  const staging = `${target}.incoming`;
  rmSync(staging, { force: true });

  const db = new Database(staging);
  let count = 0;
  let withoutLocation = 0;
  try {
    db.pragma('journal_mode = OFF');
    db.pragma('synchronous = OFF');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE postcode (pc TEXT PRIMARY KEY, lat REAL, lon REAL) WITHOUT ROWID;
    `);
    const insert = db.prepare('INSERT OR REPLACE INTO postcode (pc, lat, lon) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    for (const file of csvs) {
      // One area at a time on purpose: decompressing all 120 at once would
      // hold the whole 155 MB of CSV in memory.
      // oxlint-disable-next-line no-await-in-loop
      const text = await file.async('string');
      for (const line of text.split(/\r?\n/)) {
        if (line.length === 0) continue;
        // Code-Point rows hold no commas inside fields.
        const [rawPostcode = '', quality = '', easting = '', northing = ''] = line.split(',');
        const postcode = formatPostcode(rawPostcode.replaceAll('"', ''));
        if (postcode === null) continue;
        count += 1;
        // Quality 90: the postcode exists but has no location in this release.
        if (quality === '90' || (easting === '0' && northing === '0')) {
          withoutLocation += 1;
          insert.run(postcode, null, null);
          continue;
        }
        const point = gridToWgs84(Number(easting), Number(northing));
        insert.run(postcode, point.lat, point.lon);
      }
    }
    const meta: Record<string, string> = {
      schema: String(POSTCODES_SCHEMA),
      release,
      date,
      count: String(count),
      without_location: String(withoutLocation),
    };
    const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(meta)) insertMeta.run(key, value);
    db.exec('COMMIT');
    db.exec('VACUUM');
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
    rmSync(staging, { force: true });
    throw error;
  }
  db.close();

  closePostcodesDb();
  renameSync(staging, target);
  return { release, date, count, withoutLocation };
}

/** Listing, download and ingest, as Settings' one button. The old data stays until the new is ready. */
export async function updatePostcodes(
  dir: string,
  options: {
    fetcher?: Fetcher;
    signal?: AbortSignal;
    onProgress?: (receivedBytes: number, totalBytes: number) => void;
  } = {},
): Promise<PostcodeMeta> {
  const listing = await fetchListing(options.fetcher, options.signal);
  mkdirSync(dir, { recursive: true });
  const zipPath = join(dir, 'codepo_gb.zip.part');
  try {
    await downloadRelease(listing, zipPath, options);
    return await ingestRelease(zipPath, dir, listing.release);
  } finally {
    rmSync(zipPath, { force: true });
  }
}

// ------------------------------------------------------------- reading

let cached: { file: string; db: Database.Database } | null = null;

export function postcodesDb(dir: string): Database.Database | null {
  const file = postcodesFile(dir);
  if (cached !== null && cached.file === file) return cached.db;
  closePostcodesDb();
  if (!existsSync(file)) return null;
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    if (readPostcodeMeta(db)?.release === undefined) {
      db.close();
      return null;
    }
    cached = { file, db };
    return db;
  } catch {
    return null;
  }
}

export function closePostcodesDb(): void {
  if (cached === null) return;
  try {
    cached.db.close();
  } catch {
    /* already closed */
  }
  cached = null;
}

export function readPostcodeMeta(db: Database.Database): PostcodeMeta | null {
  try {
    const rows = db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
    const map = new Map(rows.map((row) => [row.key, row.value]));
    if (Number(map.get('schema')) !== POSTCODES_SCHEMA) return null;
    const release = map.get('release');
    const date = map.get('date');
    if (release === undefined || date === undefined) return null;
    return {
      release,
      date,
      count: Number(map.get('count') ?? 0),
      withoutLocation: Number(map.get('without_location') ?? 0),
    };
  } catch {
    return null;
  }
}

/** Bytes on disk, for Settings. */
export function postcodesBytes(dir: string): number | null {
  try {
    return statSync(postcodesFile(dir)).size;
  } catch {
    return null;
  }
}
