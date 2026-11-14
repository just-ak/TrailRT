import { nativeImage } from 'electron';
import type { MakeThumbnail } from './thumbnails';

/**
 * Thumbnails through Quick Look (design §0 and §6.1). It handles JPEG and
 * HEIC, applies the orientation tag, and keeps the aspect ratio, so there is
 * no image dependency. Measured at about 40 ms for a 12-megapixel photo.
 *
 * Only ever given a path that `resolveFilePath` returned and the cache has
 * checked is downloaded.
 */
export const quickLookThumbnail: MakeThumbnail = async (path, px) => {
  const image = await nativeImage.createThumbnailFromPath(path, { width: px, height: px });
  if (image.isEmpty()) return null;
  return new Uint8Array(image.toJPEG(80));
};
