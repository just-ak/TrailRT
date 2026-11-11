import { describe, expect, it } from 'vitest';
import { formatDate, formatDateRange, formatStopDuration } from './format';

describe('formatDateRange', () => {
  it('is as short as it can be and still unambiguous', () => {
    expect(formatDate('2027-05-12')).toBe('12 May 2027');
    expect(formatDateRange('2027-05-12', '2027-05-12')).toBe('12 May 2027');
    expect(formatDateRange('2027-05-12', '2027-05-16')).toBe('12–16 May 2027');
    expect(formatDateRange('2027-06-28', '2027-07-02')).toBe('28 Jun – 2 Jul 2027');
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 – 2 Jan 2027');
  });

  it('says "from" when the end is unknown', () => {
    expect(formatDateRange('2027-05-12', null)).toBe('from 12 May 2027');
  });
});

describe('formatStopDuration', () => {
  it('words hours and days', () => {
    expect(formatStopDuration({ durationKind: 'hours', durationMinutes: 90, durationDays: null })).toBe('1 h 30 min');
    expect(formatStopDuration({ durationKind: 'hours', durationMinutes: 45, durationDays: null })).toBe('45 min');
    expect(formatStopDuration({ durationKind: 'hours', durationMinutes: 120, durationDays: null })).toBe('2 h');
    expect(formatStopDuration({ durationKind: 'days', durationMinutes: null, durationDays: 1 })).toBe('1 day');
    expect(formatStopDuration({ durationKind: 'days', durationMinutes: null, durationDays: 3 })).toBe('3 days');
  });
});
