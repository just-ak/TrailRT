import { describe, expect, it } from 'vitest';
import { estimateWidth, hintPosition } from './hintPosition';

const viewport = { width: 1200, height: 800 };

describe('hintPosition', () => {
  it('sits above the button, centred on it', () => {
    expect(hintPosition({ left: 500, top: 400, width: 28, height: 28 }, 'Reverse', viewport)).toEqual({
      x: 514,
      y: 394,
      side: 'above',
    });
  });

  it('goes below a button at the top of the window', () => {
    const placed = hintPosition({ left: 500, top: 10, width: 28, height: 28 }, 'Close', viewport);
    expect(placed.side).toBe('below');
    expect(placed.y).toBe(44);
  });

  it('stays inside the window at either edge', () => {
    const text = 'Export the itinerary to a calendar';
    const half = estimateWidth(text) / 2;
    expect(hintPosition({ left: 0, top: 400, width: 28, height: 28 }, text, viewport).x).toBe(8 + half);
    expect(hintPosition({ left: 1190, top: 400, width: 28, height: 28 }, text, viewport).x).toBe(1200 - 8 - half);
  });
});
