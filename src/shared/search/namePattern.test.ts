import { describe, expect, it } from 'vitest';
import { compileNamePattern, matchesName } from './namePattern';

function matches(pattern: string, name: string): boolean {
  const compiled = compileNamePattern(pattern);
  if (!compiled.ok) throw new Error(compiled.message);
  return matchesName(compiled.regex, name);
}

describe('compileNamePattern', () => {
  it('finds plain text anywhere in a name, ignoring case', () => {
    expect(matches('peak', 'Peak District Weekend')).toBe(true);
    expect(matches('WEEKEND', 'Peak District Weekend')).toBe(true);
    expect(matches('district week', 'Peak District Weekend')).toBe(true);
    expect(matches('alps', 'Peak District Weekend')).toBe(false);
  });

  it('treats the text as a pattern', () => {
    expect(matches('^Day [0-9]', 'Day 3: Leek to Ashbourne')).toBe(true);
    expect(matches('^Day [0-9]', 'Rest day 3')).toBe(false);
    expect(matches('wales|scotland', 'North Wales loop')).toBe(true);
    expect(matches('20(24|25)', 'Alps 2025')).toBe(true);
    expect(matches('20(24|25)', 'Alps 2023')).toBe(false);
    expect(matches('loop$', 'Buxton loop')).toBe(true);
    expect(matches('loop$', 'Loop round Buxton')).toBe(false);
  });

  it('keeps the characters SQL LIKE treated as wildcards literal', () => {
    expect(matches('100%', '100% tarmac')).toBe(true);
    expect(matches('a_b', 'a_b')).toBe(true);
    expect(matches('a_b', 'axb')).toBe(false);
  });

  it('folds accented letters', () => {
    expect(matches('écosse', 'ÉCOSSE en été')).toBe(true);
  });

  it('accepts escapes typed out of habit', () => {
    expect(matches('A\\-road', 'A-road')).toBe(true);
    expect(matches('St\\. Ives', 'St. Ives')).toBe(true);
    expect(matches('St\\. Ives', 'Stx Ives')).toBe(false);
  });

  it('ignores the spaces around a pattern, as the search field does', () => {
    expect(matches('  ^Peak  ', 'Peak District Weekend')).toBe(true);
  });

  it.each([
    ['(', 'Unterminated group'],
    ['[a-', 'Unterminated character class'],
    ['*peak', 'Nothing to repeat'],
    ['a{2,1}', 'numbers out of order in {} quantifier'],
  ])('explains %j without the engine prefix', (pattern, message) => {
    const compiled = compileNamePattern(pattern);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.message.toLowerCase()).toContain(message.toLowerCase());
    expect(compiled.message).not.toMatch(/^Invalid regular expression/);
    expect(compiled.message.charAt(0)).toBe(compiled.message.charAt(0).toUpperCase());
  });

  it('gives the same answer every time it is used, with no state between calls', () => {
    const compiled = compileNamePattern('peak');
    if (!compiled.ok) throw new Error('unexpected');
    for (let i = 0; i < 3; i++) expect(matchesName(compiled.regex, 'Peak loop')).toBe(true);
  });

  it('never matches a missing name', () => {
    const compiled = compileNamePattern('');
    if (!compiled.ok) throw new Error('unexpected');
    expect(matchesName(compiled.regex, null)).toBe(false);
    expect(matchesName(compiled.regex, 'anything')).toBe(true);
  });
});
