/**
 * Mapping between point indices and distances along a profile.
 *
 * The point table selects points by index; the profile chart is drawn by
 * distance. They share one drawer so that selecting in one shows in the other,
 * and this is the arithmetic that joins them.
 *
 * Profile samples may be thinned for display (Requirement 5.7), so a point
 * index does not always have a sample of its own. Distances are interpolated
 * between the nearest samples on either side, which is exact when nothing was
 * thinned and close enough to draw otherwise. Every sample carries the index of
 * the source point it came from, and samples are in index order.
 *
 * Pure, so it is tested without a DOM.
 */

export interface IndexedSample {
  index: number;
  distanceM: number;
}

/** The distance along the profile of a source point index. */
export function distanceForIndex(
  samples: readonly IndexedSample[],
  index: number,
): number | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined) return null;
  if (index <= first.index) return first.distanceM;
  if (index >= last.index) return last.distanceM;

  // The last sample at or before `index`.
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const sample = samples[mid];
    if (sample !== undefined && sample.index <= index) low = mid;
    else high = mid - 1;
  }

  const before = samples[low];
  const after = samples[low + 1];
  if (before === undefined) return null;
  if (after === undefined || after.index === before.index) {
    return before.distanceM;
  }
  const t = (index - before.index) / (after.index - before.index);
  return before.distanceM + t * (after.distanceM - before.distanceM);
}

/** The source point index nearest a distance along the profile. */
export function indexForDistance(
  samples: readonly IndexedSample[],
  distanceM: number,
): number | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined) return null;
  if (distanceM <= first.distanceM) return first.index;
  if (distanceM >= last.distanceM) return last.index;

  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const sample = samples[mid];
    if (sample !== undefined && sample.distanceM <= distanceM) low = mid;
    else high = mid - 1;
  }

  const before = samples[low];
  const after = samples[low + 1];
  if (before === undefined) return null;
  if (after === undefined) return before.index;
  const span = after.distanceM - before.distanceM;
  if (span <= 0) return before.index;
  const t = (distanceM - before.distanceM) / span;
  return Math.round(before.index + t * (after.index - before.index));
}

/**
 * Selected indices as distance ranges, one per run of consecutive indices.
 *
 * Grouped into runs so a shift-selected block of a thousand points is one
 * shaded rectangle, not a thousand slivers.
 */
export function selectionRanges(
  samples: readonly IndexedSample[],
  indices: readonly number[],
): { startM: number; endM: number }[] {
  if (samples.length === 0 || indices.length === 0) return [];

  const sorted = [...new Set(indices)].toSorted((a, b) => a - b);
  const ranges: { startM: number; endM: number }[] = [];

  let runStart = sorted[0] as number;
  let runEnd = runStart;
  const flush = (): void => {
    const startM = distanceForIndex(samples, runStart);
    const endM = distanceForIndex(samples, runEnd);
    if (startM !== null && endM !== null) ranges.push({ startM, endM });
  };

  for (const index of sorted.slice(1)) {
    if (index === runEnd + 1) {
      runEnd = index;
      continue;
    }
    flush();
    runStart = index;
    runEnd = index;
  }
  flush();

  return ranges;
}
