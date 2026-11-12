import { quickLookThumbnail } from './quickLook';
import { ThumbnailCache } from './thumbnails';

/**
 * The app's one thumbnail cache, keyed by its directory because tests and the
 * packaged app use different user-data roots.
 */
let current: { root: string; cache: ThumbnailCache } | null = null;

export function thumbnailCache(root: string): ThumbnailCache {
  if (current === null || current.root !== root) {
    current = { root, cache: new ThumbnailCache({ root, make: quickLookThumbnail }) };
  }
  return current.cache;
}
