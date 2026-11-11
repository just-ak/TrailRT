import { describe, expect, it } from 'vitest';
import { clampDrawerHeight, DEFAULT_DRAWER, MIN_DRAWER, MIN_MAP } from './drawerHeight';

describe('clampDrawerHeight', () => {
  it('keeps a sensible height as it is', () => {
    expect(clampDrawerHeight(300, 900)).toBe(300);
  });

  it('never leaves the map less than its minimum', () => {
    expect(clampDrawerHeight(850, 900)).toBe(900 - MIN_MAP);
  });

  it('never shrinks the panel to nothing', () => {
    expect(clampDrawerHeight(10, 900)).toBe(MIN_DRAWER);
  });

  it('falls back to the default for a missing height', () => {
    expect(clampDrawerHeight(Number.NaN, 900)).toBe(DEFAULT_DRAWER);
  });
});
