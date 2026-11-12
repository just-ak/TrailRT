import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import { CONTAINER_REASON } from '@shared/photos/containers';
import { exifReader } from '@shared/photos/exifReader';
import { REASON } from '@shared/photos/exifValues';
import type { PhotoFormat, PhotoReadResult } from '@shared/photos/PhotoMetadataReader';
import { FILE_REASON, readPhotoFile } from './fileReader';

/**
 * The reader against every photo fixture from task 2, through the real file
 * system. The fixtures are generated (`npm run fixtures`), not committed.
 */
const ROOT = join(process.cwd(), 'test-data', 'generated', 'photos');
const describePhotos = existsSync(join(ROOT, 'buxton.heic')) ? describe : describe.skip;

const formatOf = (name: string): PhotoFormat => (name.endsWith('.heic') ? 'heic' : 'jpeg');
const read = async (name: string): Promise<PhotoReadResult> => (await readPhotoFile(join(ROOT, name), formatOf(name), exifReader)).result;

async function readOk(name: string) {
  const result = await read(name);
  if (!result.ok) throw new Error(`${name}: ${result.reason}`);
  return result;
}

async function locatedAt(name: string) {
  const result = await readOk(name);
  if (result.location === null) throw new Error(`${name} is not located: ${result.locationRejected ?? 'no geotag'}`);
  return result.location;
}

/** This process's open file descriptors, which macOS lists in `/dev/fd`. */
function openDescriptors(): number {
  return readdirSync('/dev/fd').length;
}

describePhotos('readPhotoFile with the JPEG and HEIC fixtures', () => {
  it.each(['buxton.jpg', 'buxton.heic'])('reads everything from %s', async (name) => {
    const result = await readOk(name);
    expect(result.location?.lat).toBeCloseTo(BUXTON.lat, 9);
    expect(result.location?.lon).toBeCloseTo(BUXTON.lon, 9);
    expect(result.location?.altitudeM).toBe(300.5);
    expect(result.location?.accuracyM).toBe(8);
    expect(result.location?.direction).toEqual({ degrees: 271.25, ref: 'T' });
    expect(result.taken).toEqual({ local: '2026-06-14T10:32:05', offsetMinutes: 60 });
    expect(result.orientation).toBe(1);
    expect(result.locationRejected).toBeNull();
  });

  it.each(['leek-o6.jpg', 'leek-o6.heic'])('reads %s: orientation 6, camera time, no altitude', async (name) => {
    const result = await readOk(name);
    expect(result.orientation).toBe(6);
    expect(result.taken).toEqual({ local: '2026-06-14T12:01:00', offsetMinutes: null });
    expect(result.location?.lat).toBeCloseTo(LEEK.lat, 9);
    expect(result.location?.lon).toBeCloseTo(LEEK.lon, 9);
    expect(result.location?.altitudeM).toBeNull();
    expect(result.location?.accuracyM).toBeNull();
  });

  it('gives the same answer for a JPEG and the HEIC sips made from it', async () => {
    expect(await read('buxton.heic')).toEqual(await read('buxton.jpg'));
    expect(await read('leek-o6.heic')).toEqual(await read('leek-o6.jpg'));
  });

  it('reads altitude below sea level and a magnetic bearing', async () => {
    const location = await locatedAt('ashbourne-below-sea.jpg');
    expect(location.lat).toBeCloseTo(ASHBOURNE.lat, 9);
    expect(location.altitudeM).toBe(-12.25);
    expect(location.direction).toEqual({ degrees: 45.5, ref: 'M' });
  });

  it('reads a big-endian block in a JPEG, with a negative half-hour offset', async () => {
    const result = await readOk('macclesfield-be.jpg');
    expect(result.location?.lon).toBeCloseTo(MACCLESFIELD.lon, 9);
    expect(result.taken?.offsetMinutes).toBe(-330);
  });

  it('reads a photo with no geotag as unlocated with nothing rejected', async () => {
    const result = await readOk('no-gps.jpg');
    expect(result.location).toBeNull();
    expect(result.locationRejected).toBeNull();
    expect(result.taken?.local).toBe('2026-06-14T15:00:00');
  });

  it.each([
    ['zero-zero.jpg', REASON.zeroZero],
    ['no-ref.jpg', REASON.noReference],
    ['zero-denominator.jpg', REASON.zeroDenominator],
  ])('rejects the geotag of %s with its reason', async (name, reason) => {
    const result = await readOk(name);
    expect(result.location).toBeNull();
    expect(result.locationRejected).toBe(reason);
  });

  it('rejects out-of-range.jpg', async () => {
    const result = await readOk('out-of-range.jpg');
    expect(result.location).toBeNull();
    expect(result.locationRejected?.startsWith(REASON.outOfRange)).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('reads orientation-%i.jpg', async (orientation) => {
    expect((await readOk(`orientation-${orientation}.jpg`)).orientation).toBe(orientation);
  });

  it('places the whole burst at one spot, a second apart', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => readOk(`burst/${i}.jpg`)));
    expect(new Set(results.map((r) => `${r.location?.lat},${r.location?.lon}`)).size).toBe(1);
    expect(results.map((r) => r.taken?.local)).toEqual([1, 2, 3, 4, 5].map((i) => `2026-06-14T11:00:0${i}`));
  });

  it('reads a nested photo', async () => {
    expect((await locatedAt('nested/deeper/ashbourne.jpg')).lat).toBeCloseTo(ASHBOURNE.lat, 9);
  });

  it.each([
    ['truncated.jpg', CONTAINER_REASON.truncated],
    ['truncated.heic', CONTAINER_REASON.truncated],
    ['not-an-image.jpg', CONTAINER_REASON.notJpeg],
    ['not-an-image.heic', CONTAINER_REASON.notHeic],
  ])('lists %s as unreadable with a reason, without throwing', async (name, reason) => {
    expect(await read(name)).toEqual({ ok: false, reason });
  });

  it('closes every file it opens, including when reading it fails', async () => {
    // Node does not list open FileHandles in getActiveResourcesInfo(), so the
    // descriptors are counted directly. First prove the count sees a handle.
    const before = openDescriptors();
    const probe = await open(join(ROOT, 'buxton.jpg'));
    expect(openDescriptors()).toBe(before + 1);
    await probe.close();

    await Promise.all(['buxton.jpg', 'buxton.heic', 'truncated.heic', 'not-an-image.jpg', 'missing.jpg', 'burst'].map(read));
    expect(openDescriptors()).toBe(before);
  });

  it('leaves every fixture byte-identical, with its modified time', async () => {
    const names = ['buxton.jpg', 'buxton.heic', 'leek-o6.heic', 'truncated.heic', 'not-an-image.jpg'];
    const before = names.map((n) => [createHash('sha256').update(readFileSync(join(ROOT, n))).digest('hex'), statSync(join(ROOT, n)).mtimeMs]);
    await Promise.all(names.map(read));
    const after = names.map((n) => [createHash('sha256').update(readFileSync(join(ROOT, n))).digest('hex'), statSync(join(ROOT, n)).mtimeMs]);
    expect(after).toEqual(before);
  });
});

describePhotos('readPhotoFile refusals', () => {
  const temp = mkdtempSync(join(tmpdir(), 'trailrt-file-reader-'));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));

  it('does not follow a symbolic link, even to a good photo', async () => {
    const link = join(temp, 'link.jpg');
    symlinkSync(join(ROOT, 'buxton.jpg'), link);
    expect((await readPhotoFile(link, 'jpeg', exifReader)).result).toEqual({ ok: false, reason: FILE_REASON.symlink });
  });

  it('says a missing file is gone', async () => {
    expect((await readPhotoFile(join(temp, 'nope.jpg'), 'jpeg', exifReader)).result).toEqual({ ok: false, reason: FILE_REASON.gone });
  });

  it('says a folder is not a photo', async () => {
    expect((await readPhotoFile(join(ROOT, 'burst'), 'jpeg', exifReader)).result).toEqual({ ok: false, reason: FILE_REASON.directory });
  });

  it('fingerprints the size and the first 64 KB, and nothing for a file it could not open', async () => {
    const bytes = readFileSync(join(ROOT, 'buxton.heic'));
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(bytes.length));
    const expected = createHash('sha256').update(size).update(bytes.subarray(0, 64 * 1024)).digest('hex');
    expect((await readPhotoFile(join(ROOT, 'buxton.heic'), 'heic', exifReader)).fingerprint).toBe(expected);
    expect((await readPhotoFile(join(temp, 'nope.jpg'), 'jpeg', exifReader)).fingerprint).toBeNull();
  });

  it('gives a JPEG and its burst neighbour different fingerprints', async () => {
    const a = await readPhotoFile(join(ROOT, 'burst/1.jpg'), 'jpeg', exifReader);
    const b = await readPhotoFile(join(ROOT, 'burst/2.jpg'), 'jpeg', exifReader);
    expect(a.fingerprint).not.toBeNull();
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});
