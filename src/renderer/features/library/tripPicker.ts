import { compileNamePattern, matchesName } from '@shared/search/namePattern';

/**
 * The logic of Move to Trip… (Phase 14 Requirement 21), kept free of React so
 * it can be tested directly. `TripPickerDialog` draws it.
 */

export interface Destination {
  id: string;
  name: string;
}

export type Filtered =
  | { ok: true; items: Destination[] }
  | { ok: false; message: string };

/**
 * The destinations whose names match the filter, in their given order. The
 * filter takes the library search's patterns (Requirement 21.2), so one
 * syntax works in both places; an empty one keeps everything.
 */
export function filterDestinations(destinations: readonly Destination[], filter: string): Filtered {
  if (filter.trim().length === 0) return { ok: true, items: [...destinations] };
  const compiled = compileNamePattern(filter);
  if (!compiled.ok) return { ok: false, message: compiled.message };
  return { ok: true, items: destinations.filter((d) => matchesName(compiled.regex, d.name)) };
}

export type PickerKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp';

const PAGE = 10;

/**
 * Where the highlight goes for a key, in a list of `count`. It stops at the
 * ends rather than wrapping, as a macOS list does, and is -1 only when there
 * is nothing to highlight.
 */
export function moveHighlight(index: number, key: PickerKey, count: number): number {
  if (count <= 0) return -1;
  const from = Math.min(Math.max(index, -1), count - 1);
  switch (key) {
    case 'ArrowDown':
      return Math.min(from + 1, count - 1);
    case 'ArrowUp':
      return Math.max(from - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'PageDown':
      return Math.min(Math.max(from, 0) + PAGE, count - 1);
    case 'PageUp':
      return Math.max(from - PAGE, 0);
  }
}

export function isPickerKey(key: string): key is PickerKey {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End' || key === 'PageDown' || key === 'PageUp';
}
