import { describe, expect, it } from 'vitest';
import { consequenceText, dayLimitText, stayConsequence } from './consequence';
import { weekend } from './testViews';

/** Phase 14 task 9: what a change to a stay would move, before it is made. */

describe('what a longer stay moves', () => {
  it('pushes the next arrival back, and a night’s stay on the same date takes it up', () => {
    const c = stayConsequence(weekend, 'a', { minutes: 60 });
    expect(c?.nextName).toBe('Leek');
    expect(c?.laterDays).toBe('same');
    expect(c?.day).toBe('2026-10-23');
    const [bh, bm] = (c?.before ?? '').split(':').map(Number);
    const [ah, am] = (c?.after ?? '').split(':').map(Number);
    expect((ah ?? 0) * 60 + (am ?? 0) - ((bh ?? 0) * 60 + (bm ?? 0))).toBe(60);
    expect(consequenceText(c!)).toMatch(/^Leek would arrive at \d\d:\d\d instead of \d\d:\d\d\. Nothing after Fri 23 Oct changes\.$/);
  });

  it('says later days move when the arrival crosses midnight', () => {
    expect(stayConsequence(weekend, 'a', { minutes: 10 * 60 })?.laterDays).toBe('change');
  });

  it('moves everything after a night’s stay that gains a day', () => {
    const c = stayConsequence(weekend, 'b', { days: 3 });
    expect(c?.nextName).toBe('Ashbourne');
    expect(c?.laterDays).toBe('change');
    expect(c?.before).toBe(c?.after);
  });

  it('has nothing to move at the last stop, and nothing for no change', () => {
    expect(consequenceText(stayConsequence(weekend, 'c', { minutes: 30 })!)).toBe('Nothing comes after this stop, so nothing else moves.');
    expect(stayConsequence(weekend, 'a', { minutes: 0 })).toBeNull();
  });
});

describe('the daily driving limit line', () => {
  it('claims nothing without a limit, and names the days over one', () => {
    expect(dayLimitText(weekend)).toBeNull();
    const capped = { ...weekend, itinerary: { ...weekend.itinerary, maxDriveMinutes: 120 } };
    expect(dayLimitText(capped)).toEqual({ ok: true, text: 'Every day is within your 2 h limit' });
    const over = {
      ...capped,
      timeline: { ...capped.timeline, days: capped.timeline.days.map((d, i) => (i === 0 ? { ...d, overDailyCap: true } : d)) },
    };
    expect(dayLimitText(over)).toEqual({ ok: false, text: 'Over your 2 h limit: Fri 23 Oct' });
  });
});
