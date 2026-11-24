import { describe, expect, it } from 'vitest';
import { dayLabel, layoutPhotoGrid, photosByDay, rowsInView, type GridPhoto } from './photoGrid';

/** Phase 14 Requirement 27: a folder's photos as a grid under the Photos list. */

const photo = (id: string, takenLocal: string | null): GridPhoto => ({ id, takenLocal });
const OPTIONS = { columns: 4, rowHeight: 80, headingHeight: 24 };

describe('photosByDay', () => {
  it('keeps the days in the order given, with undated photos last', () => {
    const days = photosByDay([
      photo('a', '2026-05-16T09:00:00'),
      photo('n1', null),
      photo('b', '2026-05-16T10:00:00'),
      photo('c', '2026-05-17T08:00:00'),
      photo('n2', null),
    ]);
    expect(days.map((d) => [d.label, d.photos.map((p) => p.id)])).toEqual([
      ['Sat 16 May 2026', ['a', 'b']],
      ['Sun 17 May 2026', ['c']],
      ['No date', ['n1', 'n2']],
    ]);
  });

  it('names a day with its weekday', () => {
    expect(dayLabel('2024-02-29')).toBe('Thu 29 Feb 2024');
  });
});

describe('layoutPhotoGrid', () => {
  it('puts a heading over each day and four photos to a row, with offsets that add up', () => {
    const photos = [
      ...Array.from({ length: 6 }, (_, i) => photo(`may-${i}`, '2026-05-16T09:00:00')),
      photo('later', '2026-05-18T09:00:00'),
    ];
    const { rows, height } = layoutPhotoGrid(photos, OPTIONS);
    expect(rows.map((r) => (r.kind === 'day' ? `${r.label} (${r.count})` : r.photos.map((p) => p.id).join(',')))).toEqual([
      'Sat 16 May 2026 (6)',
      'may-0,may-1,may-2,may-3',
      'may-4,may-5',
      'Mon 18 May 2026 (1)',
      'later',
    ]);
    expect(rows.map((r) => r.top)).toEqual([0, 24, 104, 184, 208]);
    expect(height).toBe(288);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('is empty for an empty folder', () => {
    expect(layoutPhotoGrid([], OPTIONS)).toEqual({ rows: [], height: 0 });
  });
});

describe('rowsInView', () => {
  it('draws only the rows that meet the viewport', () => {
    const photos = Array.from({ length: 40 }, (_, i) => photo(`p${i}`, '2026-05-16T09:00:00'));
    const { rows } = layoutPhotoGrid(photos, OPTIONS);
    // Heading 0–24, then rows of 80: 24–104, 104–184, 184–264, …
    const seen = rowsInView(rows, 110, 100);
    expect(seen.map((r) => r.top)).toEqual([104, 184]);
    expect(rowsInView(rows, 0, 30).map((r) => r.kind)).toEqual(['day', 'cells']);
    expect(rowsInView(rows, 0, 30, 80).map((r) => r.top)).toEqual([0, 24, 104]);
  });

  it('draws a dozen rows of a 40,000-photo folder, as of a small one', () => {
    const days = 400;
    const photos = Array.from({ length: 40_000 }, (_, i) => {
      const day = Math.floor(i / (40_000 / days));
      const date = new Date(Date.UTC(2010, 0, 1 + day)).toISOString().slice(0, 10);
      return photo(`p${i}`, `${date}T12:00:00`);
    });
    const { rows, height } = layoutPhotoGrid(photos, OPTIONS);
    expect(rows.reduce((n, r) => n + (r.kind === 'cells' ? r.photos.length : 0), 0)).toBe(40_000);
    const middle = rowsInView(rows, height / 2, 600, 160);
    expect(middle.length).toBeGreaterThan(5);
    expect(middle.length).toBeLessThan(20);
    expect(rowsInView(rows, height - 300, 600).at(-1)).toBe(rows.at(-1));
  });
});
