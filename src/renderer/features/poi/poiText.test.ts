import { describe, expect, it } from 'vitest';
import { categoriesText, emptyText, openText, rangeGapText, safeWebsite } from './poiText';

describe('POI wording', () => {
  it('says nothing is mapped, with the corridor and the data date, never that nothing exists', () => {
    expect(emptyText(['fuel'], 2000, '2026-11-08', 'metric')).toBe(
      'No fuel stations mapped in OpenStreetMap within 2.00 km of the route · data from 8 Nov 2026. That does not mean there are none.',
    );
    expect(emptyText(['fuel', 'food'], 500, null, 'metric')).toContain('fuel stations or places to eat or drink');
    expect(emptyText(['fuel'], 500, null, 'metric')).toContain('date unknown');
  });

  it('names a gap in the range check without claiming there is no fuel', () => {
    const text = rangeGapText({ fromM: 10_000, toM: 190_000, lengthM: 180_000, status: 'warning' }, 2000, 'metric', false);
    expect(text).toContain('no fuel station mapped');
    expect(text).toContain('may be one that is not mapped');
    expect(rangeGapText({ fromM: 0, toM: 1, lengthM: 1, status: 'not-checked' }, 2000, 'metric', true)).toContain('could not be checked');
  });

  it('says open or closed only when it knows', () => {
    expect(openText('open')).toBe('Should be open then');
    expect(openText('unknown')).toBeNull();
  });

  it('lets only web addresses through to the browser', () => {
    expect(safeWebsite('https://example.org/x')).toBe('https://example.org/x');
    expect(safeWebsite('www.example.org')).toBe('https://www.example.org/');
    expect(safeWebsite('javascript:alert(1)')).toBeNull();
    expect(safeWebsite('file:///etc/passwd')).toBeNull();
    expect(safeWebsite(null)).toBeNull();
  });

  it('joins category names readably', () => {
    expect(categoriesText(['fuel', 'food', 'toilets'])).toBe('fuel stations, places to eat or drink or public toilets');
  });
});
