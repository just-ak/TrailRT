/**
 * How tall the panel below the map may be. Phase 10 Requirement 16.3.
 *
 * At least `MIN_DRAWER`, so it is never dragged to nothing, and never so tall
 * that the map is left with less than `MIN_MAP`. When the window is too short
 * for both, the map wins.
 */

export const MIN_DRAWER = 120;
export const MIN_MAP = 160;
export const DEFAULT_DRAWER = 300;

export function clampDrawerHeight(height: number, columnHeight: number): number {
  const max = Math.max(MIN_DRAWER, columnHeight - MIN_MAP);
  const wanted = Number.isFinite(height) ? height : DEFAULT_DRAWER;
  return Math.round(Math.min(max, Math.max(MIN_DRAWER, wanted)));
}
