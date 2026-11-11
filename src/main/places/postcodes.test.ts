import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { haversineDistance } from '@shared/geo/distance';
import {
  closePostcodesDb,
  downloadRelease,
  fetchListing,
  ingestRelease,
  postcodesDb,
  readPostcodeMeta,
  releaseDate,
  updatePostcodes,
  type Fetcher,
  type PostcodeListing,
} from './postcodes';

/**
 * Postcode data against a real excerpt of Code-Point Open 2026-11
 * (`test-data/codepoint/`, OGL v3.0). The excerpt is zipped in the release's
 * own layout so the real ingest reads it. The network is a fake: nothing here
 * reaches Ordnance Survey.
 */

const EXCERPT = resolve('test-data/codepoint');
const API = 'https://api.os.uk/downloads/v1/products/CodePointOpen/downloads?area=GB&format=CSV&redirect';
const STORAGE = 'https://omseprd1stdstordownload.blob.core.windows.net/downloads/CodePointOpen/2026-11/allGB/CSV/codepo_gb.zip?sig=x';

let zipBytes: Buffer;
let md5: string;
let dir: string;

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)],
  );
}

async function zipOf(root: string, skip: (path: string) => boolean = () => false): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of files(root)) {
    const path = relative(root, file);
    if (path === 'README.md' || skip(path)) continue;
    zip.file(path, readFileSync(file));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

const listing = (overrides: Partial<PostcodeListing> = {}): PostcodeListing => ({
  release: '2026-11',
  url: API,
  sizeBytes: zipBytes.length,
  md5,
  ...overrides,
});

/** A fetcher that answers the OS API, then the storage host, as the real ones do. */
function osFetcher(options: { redirectTo?: string; body?: Buffer; listingUrl?: string } = {}): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  const answer = async (url: string): Promise<Response> => {
    urls.push(url);
    if (url.endsWith('/products/CodePointOpen')) {
      return Response.json({ id: 'CodePointOpen', version: '2026-11' });
    }
    if (url.endsWith('/products/CodePointOpen/downloads')) {
      return Response.json([
        { format: 'GeoPackage', area: 'GB', url: 'https://api.os.uk/x', size: 1, md5: 'x' },
        { format: 'CSV', area: 'GB', url: options.listingUrl ?? API, size: zipBytes.length, md5 },
      ]);
    }
    if (url === API) {
      return new Response(null, { status: 307, headers: { location: options.redirectTo ?? STORAGE } });
    }
    return new Response(options.body ?? zipBytes, { status: 200 });
  };
  return Object.assign(answer, { urls });
}

beforeAll(async () => {
  zipBytes = await zipOf(EXCERPT);
  md5 = createHash('md5').update(zipBytes).digest('hex');
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-postcodes-'));
});

afterEach(() => {
  closePostcodesDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('releaseDate', () => {
  it('reads the copyright date from the release metadata', () => {
    expect(releaseDate(readFileSync(join(EXCERPT, 'Doc/metadata.txt'), 'utf8'))).toBe('2026-10-19');
    expect(releaseDate('nothing here')).toBeNull();
  });
});

describe('ingestRelease', () => {
  it('stores every postcode, with quality-90 postcodes kept but without a location', async () => {
    const zip = join(dir, 'codepo.zip');
    writeFileSync(zip, zipBytes);
    const meta = await ingestRelease(zip, dir, '2026-11');
    expect(meta).toEqual({ release: '2026-11', date: '2026-10-19', count: 279, withoutLocation: 2 });

    const db = postcodesDb(dir);
    if (db === null) throw new Error('no database');
    expect(readPostcodeMeta(db)).toEqual(meta);
    const row = (pc: string) => db.prepare('SELECT lat, lon FROM postcode WHERE pc = ?').get(pc) as
      | { lat: number | null; lon: number | null }
      | undefined;

    // Checked against the WGS84 position postcodes.io publishes for SK17 6AA.
    const buxton = row('SK17 6AA');
    expect(haversineDistance({ lat: buxton?.lat ?? 0, lon: buxton?.lon ?? 0 }, { lat: 53.259555, lon: -1.908727 })).toBeLessThan(10);
    expect(row('AB43 1AJ')).toEqual({ lat: null, lon: null });
    expect(row('SK176AA')).toBeUndefined();
  });

  it('refuses a release with no date and leaves the old data in place', async () => {
    const good = join(dir, 'good.zip');
    writeFileSync(good, zipBytes);
    await ingestRelease(good, dir, '2026-11');

    const bad = join(dir, 'bad.zip');
    writeFileSync(bad, await zipOf(EXCERPT, (path) => path.endsWith('metadata.txt')));
    await expect(ingestRelease(bad, dir, '2026-12')).rejects.toThrow(/no release date/);
    expect(readPostcodeMeta(postcodesDb(dir)!)?.release).toBe('2026-11');
    expect(existsSync(join(dir, 'postcodes.sqlite.incoming'))).toBe(false);
  });
});

describe('fetchListing', () => {
  it('reads the release, size and checksum of the GB CSV', async () => {
    expect(await fetchListing(osFetcher())).toEqual(listing());
  });

  it('refuses a listing that points away from Ordnance Survey', async () => {
    await expect(fetchListing(osFetcher({ listingUrl: 'https://example.org/codepo.zip' }))).rejects.toThrow(
      /somewhere other than Ordnance Survey/,
    );
  });
});

describe('downloadRelease', () => {
  it('follows the one redirect to OS storage and checks the checksum', async () => {
    const fetcher = osFetcher();
    const out = join(dir, 'codepo.zip');
    await downloadRelease(listing(), out, { fetcher });
    expect(fetcher.urls).toEqual([API, STORAGE]);
    expect(readFileSync(out).equals(zipBytes)).toBe(true);
  });

  it('refuses a redirect to any other host', async () => {
    await expect(
      downloadRelease(listing(), join(dir, 'x.zip'), { fetcher: osFetcher({ redirectTo: 'https://evil.example/codepo.zip' }) }),
    ).rejects.toThrow(/does not recognise/);
  });

  it('refuses a plain-HTTP redirect to the right host', async () => {
    await expect(
      downloadRelease(listing(), join(dir, 'x.zip'), {
        fetcher: osFetcher({ redirectTo: STORAGE.replace('https:', 'http:') }),
      }),
    ).rejects.toThrow(/does not recognise/);
  });

  it('refuses a second redirect', async () => {
    const fetcher = (async (url: string) =>
      new Response(null, { status: 307, headers: { location: url === API ? STORAGE : `${STORAGE}&again` } })) as Fetcher;
    await expect(downloadRelease(listing(), join(dir, 'x.zip'), { fetcher })).rejects.toThrow(/more than once/);
  });

  it('refuses a file whose checksum does not match, and leaves nothing behind', async () => {
    const out = join(dir, 'x.zip');
    await expect(
      downloadRelease(listing(), out, { fetcher: osFetcher({ body: Buffer.from('not the release') }) }),
    ).rejects.toThrow(/did not match its published checksum/);
    expect(existsSync(out)).toBe(false);
  });
});

describe('updatePostcodes', () => {
  it('downloads and ingests in one step', async () => {
    const meta = await updatePostcodes(dir, { fetcher: osFetcher() });
    expect(meta.count).toBe(279);
    expect(readdirSync(dir).toSorted()).toEqual(['postcodes.sqlite']);
  });

  it('keeps the old data when an update fails', async () => {
    await updatePostcodes(dir, { fetcher: osFetcher() });
    await expect(updatePostcodes(dir, { fetcher: osFetcher({ body: Buffer.from('corrupt') }) })).rejects.toThrow();
    expect(readPostcodeMeta(postcodesDb(dir)!)?.count).toBe(279);
  });
});
