/**
 * The search box's behaviour that does not need React. Phase 10, design §11.4.
 */

/**
 * Keeps only the newest answer. Each keystroke takes a ticket; an answer is
 * shown only if its ticket is still the latest, so a slow reply to "bu" can
 * never replace the results for "buxton".
 */
export function createLatest(): { take(): number; isLatest(ticket: number): boolean } {
  let latest = 0;
  return {
    take: () => {
      latest += 1;
      return latest;
    },
    isLatest: (ticket) => ticket === latest,
  };
}

/** The highlighted row after a key press; -1 is none. Wraps at both ends. */
export function nextIndex(current: number, key: string, count: number): number {
  if (count === 0) return -1;
  if (key === 'ArrowDown') return current >= count - 1 ? 0 : current + 1;
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return current;
}

/** How long to wait after a keystroke before asking. */
export const SEARCH_DEBOUNCE_MS = 60;
