/**
 * Segment structure as a flat index plus a list of breaks.
 *
 * A recorded track is a list of segments, and the gap between two segments is
 * real information about the recording — a pause, a lost fix, two sessions
 * joined. Everything that edits track points therefore has to carry that
 * structure through the edit rather than flattening it and hoping.
 *
 * Two representations are used, and the conversion between them lives here so
 * the main process and the point table cannot disagree about it:
 *
 * - **Segments**: arrays of points, the storage and rendering shape.
 * - **Flat points plus breaks**: one array indexed 0..n-1, with `breaks`
 *   holding the index of the **last point of every segment except the last**.
 *
 * So lengths `[3, 2]` is `breaks: [2]` — meaning there is a gap between point
 * 2 and point 3. A single segment has no breaks at all, which is why an empty
 * array is the common case and not a missing value.
 *
 * Pure functions with no imports, per the architecture rules: the table, the
 * repository and the undo inverses all need them, and none of them should have
 * to reach into another process to find out where a segment ends.
 */

/** Break indices for a list of segment lengths. Empty for 0 or 1 segments. */
export function breaksFromLengths(lengths: readonly number[]): number[] {
  const breaks: number[] = [];
  let cumulative = 0;
  // The last segment contributes no break: there is nothing after it to be
  // separated from.
  for (const length of lengths.slice(0, -1)) {
    cumulative += length;
    if (length > 0) breaks.push(cumulative - 1);
  }
  return breaks;
}

/** Break indices for a list of segments. */
export function breaksFromSegments<T>(
  segments: readonly { points: readonly T[] }[],
): number[] {
  return breaksFromLengths(segments.map((segment) => segment.points.length));
}

/**
 * Splits a flat point array back into segments at the given breaks.
 *
 * Breaks outside the array are ignored rather than producing empty segments:
 * after a deletion the carried structure can describe more points than
 * survive, and an empty segment is not a thing the storage layer represents.
 */
export function splitAtBreaks<T>(
  points: readonly T[],
  breaks: readonly number[],
): T[][] {
  if (points.length === 0) return [];

  const cuts = [...new Set(breaks)]
    .filter((index) => index >= 0 && index < points.length - 1)
    .toSorted((a, b) => a - b);

  const segments: T[][] = [];
  let start = 0;
  for (const cut of cuts) {
    segments.push(points.slice(start, cut + 1));
    start = cut + 1;
  }
  segments.push(points.slice(start));
  return segments.filter((segment) => segment.length > 0);
}

/**
 * Removes points at the given flat indices, keeping segment structure.
 *
 * Filtering **per segment** is what preserves a break whose adjacent points
 * were both deleted: segments `[A,B]` and `[C,D]` with B and C removed give
 * `[A]` and `[D]`, still two segments. Flattening first and re-splitting by
 * the old break indices would not — the break would land in the wrong place
 * once the array had shrunk.
 *
 * A segment emptied entirely is dropped, which also drops its break. That is
 * correct rather than unfortunate: a gap needs points on both sides of it.
 */
export function removeAtIndices<T>(
  segments: readonly { points: readonly T[] }[],
  indices: Iterable<number>,
): T[][] {
  const drop = new Set(indices);
  const kept: T[][] = [];
  let flat = 0;

  for (const segment of segments) {
    const points: T[] = [];
    for (const point of segment.points) {
      if (!drop.has(flat)) points.push(point);
      flat += 1;
    }
    if (points.length > 0) kept.push(points);
  }

  return kept;
}

/**
 * Re-inserts points at the flat indices they came from.
 *
 * `entries` must be ascending by index, which is how the inverse is recorded.
 * Each index is the position the point occupied in the **original** array, so
 * inserting in ascending order places every one correctly without having to
 * adjust for the ones already put back.
 */
export function insertAtIndices<T>(
  points: readonly T[],
  entries: readonly { index: number; point: T }[],
): T[] {
  const restored: T[] = [];
  let next = 0;

  for (const entry of entries) {
    // Fill up to the hole from the surviving points, then drop the saved one
    // into it.
    while (restored.length < entry.index && next < points.length) {
      const point = points[next];
      if (point !== undefined) restored.push(point);
      next += 1;
    }
    restored.push(entry.point);
  }

  for (; next < points.length; next += 1) {
    const point = points[next];
    if (point !== undefined) restored.push(point);
  }

  return restored;
}

/** Which segment a flat index falls in. -1 when it is out of range. */
export function segmentOfIndex(
  lengths: readonly number[],
  index: number,
): number {
  let cumulative = 0;
  for (const [segmentIndex, length] of lengths.entries()) {
    cumulative += length;
    if (index < cumulative) return segmentIndex;
  }
  return -1;
}
