/**
 * The library search's patterns (Phase 14 Requirement 20).
 *
 * Search text is a JavaScript regular expression, matched anywhere in a name
 * and ignoring case, so plain words still find what they always did. Both
 * processes compile through here: the renderer to explain a bad pattern as it
 * is typed, and the main process to refuse one and to match it in SQLite.
 *
 * The flag is `i` alone. `u` would reject escapes people type out of habit,
 * such as `\-`, and without it `i` still folds accented Latin letters.
 */

export type NamePattern =
  | { ok: true; regex: RegExp }
  | { ok: false; message: string };

export const NAME_PATTERN_FLAGS = 'i';

export function compileNamePattern(text: string): NamePattern {
  const source = text.trim();
  try {
    return { ok: true, regex: new RegExp(source, NAME_PATTERN_FLAGS) };
  } catch (error) {
    return { ok: false, message: describePatternError(error) };
  }
}

/** The engine's own explanation, without the `Invalid regular expression: /…/i: ` prefix. */
function describePatternError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const stripped = raw.replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, '');
  const message = stripped.length > 0 ? stripped : raw;
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/** True when the name matches. A null name, which no table allows today, never does. */
export function matchesName(pattern: RegExp, name: string | null): boolean {
  if (name === null) return false;
  // `test` on a regex without `g` or `y` keeps no state between calls.
  return pattern.test(name);
}
