/**
 * Where a button's hint goes: above it, or below when there is no room above,
 * centred on it but kept inside the window. Pure, so it is tested without a
 * browser. Phase 10 Requirement 17.2.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HintPlacement {
  /** Centre x of the bubble, in window pixels. */
  x: number;
  /** Top of the bubble when below, bottom when above. */
  y: number;
  side: 'above' | 'below';
}

const GAP = 6;
const MARGIN = 8;
const BUBBLE_HEIGHT = 26;

/** A bubble's width for a hint, estimated before it is drawn: 6.5 px a character. */
export function estimateWidth(text: string): number {
  return Math.min(260, Math.ceil(text.length * 6.5) + 16);
}

export function hintPosition(button: Rect, text: string, viewport: { width: number; height: number }): HintPlacement {
  const half = estimateWidth(text) / 2;
  const centre = button.left + button.width / 2;
  const x = Math.min(Math.max(centre, MARGIN + half), viewport.width - MARGIN - half);
  const roomAbove = button.top - GAP - BUBBLE_HEIGHT >= MARGIN;
  return roomAbove
    ? { x, y: button.top - GAP, side: 'above' }
    : { x, y: Math.min(button.top + button.height + GAP, viewport.height - MARGIN - BUBBLE_HEIGHT), side: 'below' };
}
