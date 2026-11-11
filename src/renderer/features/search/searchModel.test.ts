import { describe, expect, it } from 'vitest';
import { createLatest, nextIndex } from './searchModel';

describe('createLatest', () => {
  it('drops an answer that arrives after a newer question', () => {
    const latest = createLatest();
    const bu = latest.take();
    const buxton = latest.take();
    expect(latest.isLatest(bu)).toBe(false);
    expect(latest.isLatest(buxton)).toBe(true);
  });
});

describe('nextIndex', () => {
  it('moves through the results and wraps', () => {
    expect(nextIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(nextIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(nextIndex(1, 'End', 3)).toBe(2);
    expect(nextIndex(1, 'a', 3)).toBe(1);
    expect(nextIndex(0, 'ArrowDown', 0)).toBe(-1);
  });
});
