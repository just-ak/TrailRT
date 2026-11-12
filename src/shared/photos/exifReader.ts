import { findExif } from './containers';
import { readLocation, readOrientation, readTaken } from './exifValues';
import type { PhotoMetadataReader, PhotoReadResult } from './PhotoMetadataReader';
import { parseTiff } from './tiff';

/**
 * The JPEG and HEIC metadata reader. Phase 11, design §3 and ADR 0020 §2.
 *
 * A file that is not the image it claims, or is cut short, is a failure: the
 * photo is listed as unreadable with the reason. A sound image whose EXIF is
 * absent or damaged is not: it is a photo with no usable location, and the
 * reason says why.
 */
export const exifReader: PhotoMetadataReader = {
  async read(file, format): Promise<PhotoReadResult> {
    const container = await findExif(file, format);
    if (container.kind === 'failed') return { ok: false, reason: container.reason };
    if (container.kind === 'none') {
      return { ok: true, location: null, locationRejected: null, taken: null, orientation: null };
    }

    const tiff = parseTiff(container.tiff);
    if (!tiff.ok) {
      return { ok: true, location: null, locationRejected: tiff.reason, taken: null, orientation: null };
    }
    const location = readLocation(tiff.gps);
    return {
      ok: true,
      location: location.kind === 'located' ? location.geotag : null,
      locationRejected: location.kind === 'rejected' ? location.reason : null,
      taken: readTaken(tiff.exif),
      orientation: readOrientation(tiff.ifd0),
    };
  },
};
