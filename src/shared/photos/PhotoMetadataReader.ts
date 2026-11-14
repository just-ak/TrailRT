import type { PhotoFormat, RangeReader } from './containers';
import type { Geotag, Orientation, TakenTime } from './exifValues';

/**
 * What the scanner needs from a photo. Phase 11, design §3.5.
 *
 * The scanner is handed an implementation, so a reader for another format
 * (raw files, later) does not touch the scanner, the services or trip
 * management. `exifReader.ts` is the JPEG and HEIC implementation.
 */
export interface PhotoMetadataReader {
  read(file: RangeReader, format: PhotoFormat): Promise<PhotoReadResult>;
}

export type PhotoReadResult =
  | {
      ok: true;
      /** `null` when the photo records no location, or one that was rejected. */
      location: Geotag | null;
      /** Why a recorded location was rejected; `null` when there was none to reject. */
      locationRejected: string | null;
      taken: TakenTime | null;
      orientation: Orientation | null;
    }
  /** The file could not be read as the image it claims to be (Requirement 2.8). */
  | { ok: false; reason: string };

export type { Geotag, Orientation, TakenTime } from './exifValues';
export type { PhotoFormat, RangeReader } from './containers';
