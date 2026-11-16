import { describe, expect, it } from 'vitest';
import { filterDestinations, isPickerKey, moveHighlight, type Destination } from './tripPicker';

// More trips than the old menu's cap of eight or nine, which is the point.
const TRIPS: Destination[] = [
  { id: 'loose', name: 'Not in a trip' },
  ...Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, name: `Trip ${String(i + 1).padStart(2, '0')}` })),
  { id: 'peak', name: 'Peak District Weekend' },
  { id: 'wales', name: 'North Wales' },
];

const names = (filter: string): string[] => {
  const result = filterDestinations(TRIPS, filter);
  if (!result.ok) throw new Error(result.message);
  return result.items.map((d) => d.name);
};

describe('filterDestinations', () => {
  it('keeps every trip, in order, with no filter', () => {
    expect(names('')).toHaveLength(TRIPS.length);
    expect(names('   ')[0]).toBe('Not in a trip');
    expect(names('').at(-1)).toBe('North Wales');
  });

  it('narrows by plain text, ignoring case', () => {
    expect(names('wales')).toEqual(['North Wales']);
    expect(names('PEAK')).toEqual(['Peak District Weekend']);
  });

  it('narrows by the search patterns', () => {
    expect(names('^trip 3[5-9]$')).toEqual(['Trip 35', 'Trip 36', 'Trip 37', 'Trip 38', 'Trip 39']);
    expect(names('wales|peak')).toEqual(['Peak District Weekend', 'North Wales']);
    expect(names('^not in')).toEqual(['Not in a trip']);
  });

  it('reaches a trip far beyond the old cap', () => {
    expect(names('trip 40')).toEqual(['Trip 40']);
  });

  it('explains a bad pattern rather than emptying the list silently', () => {
    const result = filterDestinations(TRIPS, 'trip (');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Unterminated group/);
  });

  it('can match nothing, which is not an error', () => {
    expect(filterDestinations(TRIPS, 'alps')).toEqual({ ok: true, items: [] });
  });
});

describe('moveHighlight', () => {
  it('moves one at a time and stops at the ends', () => {
    expect(moveHighlight(0, 'ArrowDown', 3)).toBe(1);
    expect(moveHighlight(2, 'ArrowDown', 3)).toBe(2);
    expect(moveHighlight(1, 'ArrowUp', 3)).toBe(0);
    expect(moveHighlight(0, 'ArrowUp', 3)).toBe(0);
  });

  it('starts from the top when nothing is highlighted', () => {
    expect(moveHighlight(-1, 'ArrowDown', 3)).toBe(0);
    expect(moveHighlight(-1, 'ArrowUp', 3)).toBe(0);
  });

  it('jumps to the ends and by a page', () => {
    expect(moveHighlight(5, 'Home', 43)).toBe(0);
    expect(moveHighlight(5, 'End', 43)).toBe(42);
    expect(moveHighlight(5, 'PageDown', 43)).toBe(15);
    expect(moveHighlight(40, 'PageDown', 43)).toBe(42);
    expect(moveHighlight(5, 'PageUp', 43)).toBe(0);
  });

  it('keeps a highlight left over from a longer list inside a shorter one', () => {
    expect(moveHighlight(30, 'ArrowDown', 3)).toBe(2);
  });

  it('highlights nothing in an empty list', () => {
    expect(moveHighlight(0, 'ArrowDown', 0)).toBe(-1);
    expect(moveHighlight(0, 'End', 0)).toBe(-1);
  });

  it('knows its keys', () => {
    expect(isPickerKey('ArrowDown')).toBe(true);
    expect(isPickerKey('Enter')).toBe(false);
  });
});
