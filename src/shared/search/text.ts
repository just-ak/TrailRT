/**
 * Turning names and what someone typed into comparable tokens.
 *
 * Phase 10 Requirement 11.14: matching ignores case and punctuation, matches
 * from the start of a word as the user types, and treats common
 * abbreviations as their full form. The same folding runs on the index at
 * build time and on the query at search time, so they always agree.
 */

/**
 * Lower case, accents removed, apostrophes dropped, other punctuation turned
 * into spaces. `St Ann's Well` → `st anns well`; `Bryn-y-Maen` → `bryn y maen`.
 */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replaceAll(/\p{M}+/gu, '')
    .toLowerCase()
    .replaceAll(/['’`]/g, '')
    .replaceAll('&', ' and ')
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokenise(text: string): string[] {
  const folded = foldText(text);
  return folded.length === 0 ? [] : folded.split(' ');
}

/**
 * Abbreviation groups. Each word in a group matches every other.
 *
 * `st` is in two groups on purpose: it is "Street" after a name and "Saint"
 * before one, and the text alone cannot say which. Both are matched and
 * ranking sorts it out.
 */
const GROUPS: readonly (readonly string[])[] = [
  ['st', 'street'],
  ['st', 'saint'],
  ['rd', 'road'],
  ['ave', 'av', 'avenue'],
  ['ln', 'lane'],
  ['dr', 'drive'],
  ['cl', 'close'],
  ['cres', 'cresc', 'crescent'],
  ['pl', 'place'],
  ['sq', 'square'],
  ['ter', 'terr', 'terrace'],
  ['gdns', 'gardens'],
  ['pk', 'park'],
  ['ct', 'court'],
  ['gr', 'grove'],
  ['hts', 'heights'],
  ['mt', 'mount'],
  ['n', 'north'],
  ['s', 'south'],
  ['e', 'east'],
  ['w', 'west'],
  ['upr', 'upper'],
  ['lwr', 'lower'],
  ['gt', 'great'],
];

const EQUIVALENTS: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of GROUPS) {
    for (const word of group) {
      const set = map.get(word) ?? new Set([word]);
      for (const other of group) set.add(other);
      map.set(word, set);
    }
  }
  return new Map([...map.entries()].map(([word, set]) => [word, [...set]]));
})();

/** A token and every word it abbreviates or is abbreviated by. */
export function equivalents(token: string): readonly string[] {
  return EQUIVALENTS.get(token) ?? [token];
}

/**
 * How one typed token is looked up.
 *
 * Every token is matched as a word prefix, so `spri gard` finds Spring
 * Gardens. Its abbreviation equivalents are matched exactly, so `st` finds
 * `street` but `str` does not find `saint`.
 */
export interface TokenQuery {
  prefix: string;
  exact: readonly string[];
}

export function queryTokens(text: string): TokenQuery[] {
  return tokenise(text).map((token) => ({
    prefix: token,
    exact: equivalents(token).filter((word) => word !== token),
  }));
}

/** A leading house number, e.g. `12`, `12a`, `12-14`, split from the rest. */
export function splitHouseNumber(text: string): { number: string; rest: string } | null {
  const match = /^\s*(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)[\s,]+(.+)$/i.exec(text);
  if (match === null) return null;
  return { number: (match[1] ?? '').replaceAll(/\s+/g, '').toLowerCase(), rest: match[2] ?? '' };
}
