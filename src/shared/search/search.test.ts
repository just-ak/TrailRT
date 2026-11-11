import { describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import type { SearchResult } from './PlaceSearchProvider';
import { classifyPostcode, compactPostcode, formatPostcode } from './postcode';
import { disambiguate, rankResults } from './rank';
import { equivalents, foldText, queryTokens, splitHouseNumber, tokenise } from './text';

describe('postcodes', () => {
  it.each(['de451aa', 'DE45 1AA', 'de45  1aa', ' De45 1Aa '])('reads %j as DE45 1AA', (text) => {
    expect(classifyPostcode(text)).toEqual({
      kind: 'full',
      postcode: 'DE45 1AA',
      outward: 'DE45',
      area: 'DE',
    });
  });

  it('formats the padded form Code-Point Open uses', () => {
    expect(formatPostcode('B1  1AA')).toBe('B1 1AA');
    expect(formatPostcode('SK176AA')).toBe('SK17 6AA');
    expect(formatPostcode('EC1A1BB')).toBe('EC1A 1BB');
    expect(formatPostcode('GIR0AA')).toBe('GIR 0AA');
    expect(formatPostcode('SK17')).toBeNull();
    expect(compactPostcode('sk17 6aa')).toBe('SK176AA');
  });

  it('reads an outcode and a sector as areas', () => {
    expect(classifyPostcode('DE45')).toEqual({ kind: 'outcode', outward: 'DE45', area: 'DE' });
    expect(classifyPostcode('sk17')).toEqual({ kind: 'outcode', outward: 'SK17', area: 'SK' });
    expect(classifyPostcode('DE45 1')).toEqual({
      kind: 'sector',
      sector: 'DE45 1',
      outward: 'DE45',
      area: 'DE',
    });
    // Half-typed: still the sector.
    expect(classifyPostcode('DE45 1A')).toMatchObject({ kind: 'sector', sector: 'DE45 1' });
    // No space and too long for an outcode: outcode plus sector digit.
    expect(classifyPostcode('DE451')).toMatchObject({ kind: 'sector', sector: 'DE45 1' });
  });

  it.each([
    ['BT1 1AA', 'Northern Ireland'],
    ['IM1 1AA', 'the Isle of Man'],
    ['JE2 3AB', 'Jersey'],
    ['GY1 1AA', 'Guernsey'],
    ['bt48', 'Northern Ireland'],
  ])('says %s is outside the data rather than not found', (text, region) => {
    expect(classifyPostcode(text)).toMatchObject({ kind: 'uncovered', region });
  });

  it.each(['Buxton', 'A515', 'A6', 'Spring Gardens', 'SK17 6AAA', 'QQ1 1AA', '12 High St', ''])(
    'treats %j as a place search',
    (text) => {
      expect(classifyPostcode(text).kind).toBe('none');
    },
  );

  it('still reads a single-letter area such as Manchester or Birmingham', () => {
    expect(classifyPostcode('M1 1AE')).toMatchObject({ kind: 'full', area: 'M' });
    expect(classifyPostcode('B1')).toMatchObject({ kind: 'outcode', area: 'B' });
  });
});

describe('text', () => {
  it('folds case, accents and punctuation', () => {
    expect(foldText("St Ann's Well")).toBe('st anns well');
    expect(foldText('Bryn-y-Maen')).toBe('bryn y maen');
    expect(foldText('Llanfair Pwllgwyngyll, Ynys Môn')).toBe('llanfair pwllgwyngyll ynys mon');
    expect(foldText('Fish & Chips')).toBe('fish and chips');
    expect(tokenise('  ')).toEqual([]);
  });

  it('treats abbreviations as their full forms, both ways', () => {
    expect(equivalents('st')).toEqual(expect.arrayContaining(['street', 'saint']));
    expect(equivalents('street')).toEqual(expect.arrayContaining(['st']));
    expect(equivalents('street')).not.toContain('saint');
    expect(equivalents('rd')).toContain('road');
    expect(equivalents('buxton')).toEqual(['buxton']);
  });

  it('matches every typed word as a prefix and its abbreviations exactly', () => {
    expect(queryTokens('Spring Gdns')).toEqual([
      { prefix: 'spring', exact: [] },
      { prefix: 'gdns', exact: ['gardens'] },
    ]);
  });

  it('splits a leading house number', () => {
    expect(splitHouseNumber('12 Spring Gardens')).toEqual({ number: '12', rest: 'Spring Gardens' });
    expect(splitHouseNumber('12A, Hall Bank')).toEqual({ number: '12a', rest: 'Hall Bank' });
    expect(splitHouseNumber('Spring Gardens')).toBeNull();
  });
});

function result(overrides: Partial<SearchResult> & Pick<SearchResult, 'kind' | 'label'>): SearchResult {
  return {
    key: `${overrides.kind}:${overrides.label}:${overrides.lat ?? 0}`,
    detail: null,
    lat: BUXTON.lat,
    lon: BUXTON.lon,
    bounds: null,
    approximate: false,
    note: null,
    source: 'osm',
    ...overrides,
  };
}

describe('rankResults', () => {
  it('puts the postcode first, then places by kind, then streets', () => {
    const ranked = rankResults(
      [
        result({ kind: 'street', label: 'Leek Road' }),
        result({ kind: 'place', label: 'Leekfrith', placeKind: 'hamlet' }),
        result({ kind: 'place', label: 'Leek', placeKind: 'town', ...LEEK }),
        result({ kind: 'postcode', label: 'ST13 5AA', source: 'codepoint' }),
      ],
      BUXTON,
      'leek',
    );
    expect(ranked.map((r) => r.label)).toEqual(['ST13 5AA', 'Leek', 'Leekfrith', 'Leek Road']);
  });

  it('orders places of the same kind by distance from the map centre', () => {
    const ranked = rankResults(
      [
        result({ kind: 'place', label: 'Newtown', placeKind: 'village', ...ASHBOURNE }),
        result({ kind: 'place', label: 'Newtown', placeKind: 'village', ...LEEK }),
      ],
      LEEK,
      'newtown',
    );
    expect(ranked.map((r) => r.lat)).toEqual([LEEK.lat, ASHBOURNE.lat]);
  });
});

describe('disambiguate', () => {
  it('names the county only where the label is shared', () => {
    const a = result({ kind: 'place', label: 'Newtown', lat: 1 });
    const b = result({ kind: 'place', label: 'Newtown', lat: 2 });
    const c = result({ kind: 'place', label: 'Buxton', lat: 3 });
    const counties = new Map([
      [a.key, 'Derbyshire'],
      [b.key, 'Cheshire'],
      [c.key, 'Derbyshire'],
    ]);
    const out = disambiguate([a, b, c], (r) => counties.get(r.key) ?? null);
    expect(out.map((r) => r.detail)).toEqual(['Derbyshire', 'Cheshire', null]);
  });
});
