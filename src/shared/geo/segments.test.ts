import { describe, expect, it } from 'vitest';
import {
  breaksFromLengths,
  breaksFromSegments,
  insertAtIndices,
  removeAtIndices,
  segmentOfIndex,
  splitAtBreaks,
} from './segments';

/** Letters stand in for points: the structure is what is under test. */
const seg = (...groups: string[]) =>
  groups.map((group) => ({ points: [...group] }));

describe('breaksFromLengths', () => {
  it('has no breaks for a single segment', () => {
    expect(breaksFromLengths([5])).toEqual([]);
  });

  it('is empty for no segments at all', () => {
    expect(breaksFromLengths([])).toEqual([]);
  });

  it('marks the last index of every segment but the last', () => {
    // Lengths 3, 2, 4 => indices 0..2, 3..4, 5..8.
    expect(breaksFromLengths([3, 2, 4])).toEqual([2, 4]);
  });

  it('skips a zero-length segment rather than emitting a duplicate index', () => {
    expect(breaksFromLengths([2, 0, 3])).toEqual([1]);
  });
});

describe('breaksFromSegments', () => {
  it('reads the structure off the segments', () => {
    expect(breaksFromSegments(seg('abc', 'de'))).toEqual([2]);
  });
});

describe('splitAtBreaks', () => {
  it('round-trips with breaksFromSegments', () => {
    const segments = seg('abc', 'de', 'fghi');
    const flat = segments.flatMap((s) => s.points);
    expect(splitAtBreaks(flat, breaksFromSegments(segments))).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
      ['f', 'g', 'h', 'i'],
    ]);
  });

  it('gives one segment when there are no breaks', () => {
    expect(splitAtBreaks([...'abc'], [])).toEqual([['a', 'b', 'c']]);
  });

  it('ignores a break past the end of the array', () => {
    // After a deletion the carried structure can describe more points than
    // survive. A trailing break must not produce an empty segment.
    expect(splitAtBreaks([...'ab'], [1, 7])).toEqual([['a', 'b']]);
  });

  it('is empty for no points', () => {
    expect(splitAtBreaks([], [2])).toEqual([]);
  });
});

describe('removeAtIndices', () => {
  it('removes non-contiguous indices', () => {
    expect(removeAtIndices(seg('abcdef'), [1, 3])).toEqual([
      ['a', 'c', 'e', 'f'],
    ]);
  });

  it('keeps a break when a deletion crosses it', () => {
    // Deleting c (end of segment 0) and d (start of segment 1) must leave two
    // segments, not merge them. This is Requirement 4.4.
    expect(removeAtIndices(seg('abc', 'def'), [2, 3])).toEqual([
      ['a', 'b'],
      ['e', 'f'],
    ]);
  });

  it('keeps the break when the points either side of it are both deleted', () => {
    expect(removeAtIndices(seg('ab', 'cd'), [1, 2])).toEqual([['a'], ['d']]);
  });

  it('drops a segment emptied entirely, and its break with it', () => {
    // A gap needs points on both sides. With segment 0 gone there is nothing
    // for the break to separate.
    expect(removeAtIndices(seg('a', 'bc'), [0])).toEqual([['b', 'c']]);
  });

  it('preserves all three segments when one point goes from each', () => {
    expect(removeAtIndices(seg('ab', 'cd', 'ef'), [0, 2, 5])).toEqual([
      ['b'],
      ['d'],
      ['e'],
    ]);
  });

  it('returns the points unchanged when nothing is dropped', () => {
    expect(removeAtIndices(seg('abc'), [])).toEqual([['a', 'b', 'c']]);
  });
});

describe('insertAtIndices', () => {
  it('inverts removeAtIndices exactly', () => {
    const segments = seg('abc', 'def');
    const flat = segments.flatMap((s) => s.points);
    const indices = [1, 4];
    const saved = indices.map((index) => ({
      index,
      point: flat[index] as string,
    }));

    const kept = removeAtIndices(segments, indices).flat();
    const restored = insertAtIndices(kept, saved);

    expect(restored).toEqual(flat);
    expect(splitAtBreaks(restored, breaksFromSegments(segments))).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('restores adjacent holes', () => {
    const restored = insertAtIndices([...'ad'], [
      { index: 1, point: 'b' },
      { index: 2, point: 'c' },
    ]);
    expect(restored).toEqual([...'abcd']);
  });

  it('restores a hole at the start', () => {
    expect(insertAtIndices([...'bc'], [{ index: 0, point: 'a' }])).toEqual([
      ...'abc',
    ]);
  });

  it('restores a hole at the end', () => {
    expect(insertAtIndices([...'ab'], [{ index: 2, point: 'c' }])).toEqual([
      ...'abc',
    ]);
  });

  it('returns the input when there is nothing to restore', () => {
    expect(insertAtIndices([...'abc'], [])).toEqual([...'abc']);
  });
});

describe('segmentOfIndex', () => {
  it('locates an index within its segment', () => {
    const lengths = [3, 2, 4];
    expect(segmentOfIndex(lengths, 0)).toBe(0);
    expect(segmentOfIndex(lengths, 2)).toBe(0);
    expect(segmentOfIndex(lengths, 3)).toBe(1);
    expect(segmentOfIndex(lengths, 4)).toBe(1);
    expect(segmentOfIndex(lengths, 8)).toBe(2);
  });

  it('reports -1 past the end rather than guessing the last segment', () => {
    expect(segmentOfIndex([3, 2], 5)).toBe(-1);
  });
});
