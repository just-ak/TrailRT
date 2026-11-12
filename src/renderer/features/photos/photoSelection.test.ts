import { describe, expect, it } from 'vitest';
import { yearOptions } from './photoFilterOptions';
import { clickPhoto, NO_PHOTO_SELECTION, pruneSelection } from './photoSelection';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const plain = { metaKey: false, shiftKey: false };
const meta = { metaKey: true, shiftKey: false };
const shift = { metaKey: false, shiftKey: true };

describe('photo list selection', () => {
  it('a plain click selects one photo and makes it the anchor', () => {
    const s = clickPhoto(NO_PHOTO_SELECTION, 'c', plain, ORDER);
    expect([...s.ids]).toEqual(['c']);
    expect(s.anchor).toBe('c');
  });

  it('⌘ adds and removes, handing the anchor to the last one added', () => {
    let s = clickPhoto(NO_PHOTO_SELECTION, 'a', plain, ORDER);
    s = clickPhoto(s, 'c', meta, ORDER);
    expect([...s.ids]).toEqual(['a', 'c']);
    expect(s.anchor).toBe('c');
    s = clickPhoto(s, 'c', meta, ORDER);
    expect([...s.ids]).toEqual(['a']);
    expect(s.anchor).toBe('a');
  });

  it('Shift selects the range from the anchor, in list order, either way', () => {
    let s = clickPhoto(NO_PHOTO_SELECTION, 'b', plain, ORDER);
    s = clickPhoto(s, 'd', shift, ORDER);
    expect([...s.ids]).toEqual(['b', 'c', 'd']);
    s = clickPhoto(s, 'a', shift, ORDER);
    expect([...s.ids]).toEqual(['a', 'b']);
    expect(s.anchor).toBe('b');
  });

  it('Shift with no anchor is a plain click', () => {
    expect([...clickPhoto(NO_PHOTO_SELECTION, 'd', shift, ORDER).ids]).toEqual(['d']);
  });

  it('drops photos no longer listed after a rescan', () => {
    let s = clickPhoto(NO_PHOTO_SELECTION, 'b', plain, ORDER);
    s = clickPhoto(s, 'd', shift, ORDER);
    const pruned = pruneSelection(s, new Set(['a', 'c', 'd']));
    expect([...pruned.ids]).toEqual(['c', 'd']);
    expect(pruned.anchor).toBe('d');
    expect(pruneSelection(pruned, new Set(['c', 'd']))).toBe(pruned);
  });
});

describe('the Year filter', () => {
  it('lists the years newest first, with "No date" only when some photo has none', () => {
    expect(yearOptions({ years: [{ year: 2026, count: 1200 }, { year: 2019, count: 4 }], noDate: 3 })).toEqual([
      { value: '', label: 'All years' },
      { value: '2026', label: '2026 (1,200)' },
      { value: '2019', label: '2019 (4)' },
      { value: 'none', label: 'No date (3)' },
    ]);
    expect(yearOptions({ years: [{ year: 2026, count: 1 }], noDate: 0 }).map((o) => o.value)).toEqual(['', '2026']);
    expect(yearOptions(null)).toEqual([{ value: '', label: 'All years' }]);
  });
});
