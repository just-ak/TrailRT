import { describe, expect, it } from 'vitest';
import { dateFromName } from './nameDate';

const date = (name: string): string | null => dateFromName(name)?.date ?? null;

describe('dateFromName', () => {
  it.each([
    ['Ride 16-05-25', '2025-05-16'],
    ['Ride 16-05-2025', '2025-05-16'],
    ['16/05/2025 Peak loop', '2025-05-16'],
    ['16.5.25', '2025-05-16'],
    ['loop_16_05_25', '2025-05-16'],
    ['Buxton 1-6-25', '2025-06-01'],
  ])('reads %j day first', (name, expected) => {
    expect(date(name)).toBe(expected);
  });

  it('never reads an ambiguous date month first', () => {
    // 3 April, as written in the UK, not 4 March.
    expect(date('Ride 03-04-25')).toBe('2025-04-03');
  });

  it('reads month first only when day first is not a date', () => {
    expect(date('Ride 05-16-25')).toBe('2025-05-16');
  });

  it.each([
    ['16-May-2025', '2025-05-16'],
    ['16 May 2025 Dovedale', '2025-05-16'],
    ['16th May 2025', '2025-05-16'],
    ['1st-Jun-25', '2025-06-01'],
    ['16May2025', '2025-05-16'],
    ['3 Sept 2024', '2024-09-03'],
    ['21 december 2023', '2023-12-21'],
    ['Peak loop 16 May, 2025', '2025-05-16'],
  ])('reads a named month %j', (name, expected) => {
    expect(date(name)).toBe(expected);
  });

  it.each([
    ['May 16, 2025', '2025-05-16'],
    ['June 1st 2025 ride', '2025-06-01'],
  ])('reads a month named first %j', (name, expected) => {
    expect(date(name)).toBe(expected);
  });

  it.each([
    ['2025-05-16 Dovedale', '2025-05-16'],
    ['2025/5/16', '2025-05-16'],
    ['20250516_093000', '2025-05-16'],
    ['Activity 20250516', '2025-05-16'],
  ])('reads year first %j', (name, expected) => {
    expect(date(name)).toBe(expected);
  });

  it('puts a two-digit year in the right century', () => {
    expect(date('Ride 16-05-99')).toBe('1999-05-16');
    expect(date('Ride 16-05-69')).toBe('2069-05-16');
  });

  it.each([
    'Peak loop',
    'A515 to Buxton',
    'Route 66',
    'NC500 day 3',
    '31-02-25',
    '32-01-2025',
    '16-13-25',
    'Track 123456',
    'Lap 12-14',
    'Mayfield loop',
    'Version 1.2.3',
  ])('finds no date in %j', (name) => {
    expect(dateFromName(name)).toBeNull();
  });

  it('accepts 29 February only in a leap year', () => {
    expect(date('29-02-24')).toBe('2024-02-29');
    expect(date('29-02-25')).toBeNull();
  });

  it('says which text it read', () => {
    expect(dateFromName('Peak loop 16 May 2025 (2)')).toEqual({ date: '2025-05-16', text: '16 May 2025' });
    expect(dateFromName('Ride 16-05-25')?.text).toBe('16-05-25');
  });
});
