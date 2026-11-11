import { describe, expect, it } from 'vitest';
import { SYMBOL_IDS } from '../domain/symbols';
import { compactTags, describeAttributes, extractAttributes } from './attributes';
import {
  classifyTags,
  osmiumPoiFilters,
  POI_CATEGORIES,
  POI_CATEGORY_IDS,
  symbolFor,
} from './categories';
import { openAt, parseOpeningHours } from './openingHours';

describe('POI categories', () => {
  it('covers every category Requirement 6.1 names, once each', () => {
    expect(POI_CATEGORIES.map((c) => c.id)).toEqual([...POI_CATEGORY_IDS]);
  });

  it('maps every category to a real waypoint symbol and gives a reason', () => {
    for (const category of POI_CATEGORIES) {
      expect(SYMBOL_IDS).toContain(category.symbol);
      expect(category.reason.length).toBeGreaterThan(10);
    }
    expect(SYMBOL_IDS).toContain(symbolFor({ category: 'accommodation', kind: 'camp_site' }));
  });

  it('classifies by tag and prefers accommodation over food', () => {
    expect(classifyTags({ amenity: 'fuel' })).toEqual({ category: 'fuel', kind: 'fuel' });
    expect(classifyTags({ tourism: 'hotel', amenity: 'restaurant' })).toEqual({
      category: 'accommodation',
      kind: 'hotel',
    });
    expect(classifyTags({ historic: 'castle' })?.category).toBe('attractions');
    expect(classifyTags({ shop: 'hairdresser' })).toBeNull();
    expect(classifyTags({ highway: 'primary' })).toBeNull();
  });

  it('excludes private places and unnamed kerbside parking', () => {
    expect(classifyTags({ amenity: 'parking', access: 'private' })).toBeNull();
    expect(classifyTags({ amenity: 'toilets', access: 'no' })).toBeNull();
    expect(classifyTags({ amenity: 'parking', parking: 'street_side' })).toBeNull();
    expect(classifyTags({ amenity: 'parking', parking: 'street_side', name: 'Market Place' })).not.toBeNull();
    expect(classifyTags({ amenity: 'parking', parking: 'surface' })).not.toBeNull();
    expect(classifyTags({ amenity: 'parking', access: 'customers' })).not.toBeNull();
  });

  it('builds one osmium expression per key, taking nodes, ways and relations', () => {
    const filters = osmiumPoiFilters();
    expect(filters.every((f) => f.startsWith('nwr/'))).toBe(true);
    expect(new Set(filters.map((f) => f.split('=')[0])).size).toBe(filters.length);
    expect(filters.find((f) => f.startsWith('nwr/amenity='))).toContain('charging_station');
  });
});

describe('POI attributes', () => {
  const tags = {
    name: 'Example Services',
    amenity: 'fuel',
    brand: 'Shell',
    'addr:housenumber': '12',
    'addr:street': 'London Road',
    'addr:city': 'Buxton',
    'addr:postcode': 'SK17 9NX',
    phone: '+44 1298 000000',
    website: 'https://example.org',
    opening_hours: 'Mo-Su 06:00-22:00',
    'fuel:diesel': 'yes',
    'fuel:octane_95': 'yes',
    'fuel:lpg': 'no',
    'socket:type2': '2',
    'socket:type2:output': '22 kW',
    'socket:chademo': 'yes',
    toilets: 'yes',
    'source:geometry': 'survey',
  };

  it('keeps only the Requirement 7.1 tags', () => {
    expect(Object.keys(compactTags(tags)).toSorted()).toEqual(
      [
        'addr:city',
        'addr:housenumber',
        'addr:postcode',
        'addr:street',
        'brand',
        'fuel:diesel',
        'fuel:lpg',
        'fuel:octane_95',
        'name',
        'opening_hours',
        'phone',
        'socket:chademo',
        'socket:type2',
        'socket:type2:output',
        'website',
      ].toSorted(),
    );
  });

  it('reads the attributes as plain text', () => {
    expect(extractAttributes(tags)).toEqual({
      address: '12 London Road, Buxton SK17 9NX',
      phone: '+44 1298 000000',
      website: 'https://example.org',
      openingHours: 'Mo-Su 06:00-22:00',
      brand: 'Shell',
      stars: null,
      fuels: ['Diesel', 'Unleaded (95)'],
      sockets: ['CHAdeMO', 'Type 2 × 2'],
    });
  });

  it('does not repeat a house name that is the street name', () => {
    expect(
      extractAttributes({
        'addr:housename': 'The Crescent',
        'addr:street': 'The Crescent',
        'addr:city': 'Buxton',
        'addr:postcode': 'SK17 6BH',
      }).address,
    ).toBe('The Crescent, Buxton SK17 6BH');
    expect(extractAttributes({ 'addr:housename': 'Rose Cottage', 'addr:street': 'Hall Bank' }).address).toBe(
      'Rose Cottage, Hall Bank',
    );
  });

  it('leaves a missing attribute absent, never defaulted', () => {
    const bare = extractAttributes({ amenity: 'fuel' });
    expect(bare).toEqual({
      address: null,
      phone: null,
      website: null,
      openingHours: null,
      brand: null,
      stars: null,
      fuels: [],
      sockets: [],
    });
    expect(describeAttributes(bare)).toEqual([]);
  });

  it('describes only what is present', () => {
    expect(describeAttributes(extractAttributes({ phone: '01298 000000', stars: '4' }))).toEqual([
      'Phone: 01298 000000',
      'Stars: 4',
    ]);
  });
});

const MON = 0;
const SAT = 5;
const SUN = 6;

function at(weekday: number, time: string): { weekday: number; minutes: number } {
  const [h, m] = time.split(':').map(Number);
  return { weekday, minutes: (h ?? 0) * 60 + (m ?? 0) };
}

describe('opening hours', () => {

  it('24/7 is always open', () => {
    const hours = parseOpeningHours('24/7');
    expect(openAt(hours, at(SUN, '03:00'))).toBe('open');
  });

  it('reads weekday ranges and lists', () => {
    const hours = parseOpeningHours('Mo-Fr 08:00-18:00; Sa 09:00-12:00');
    expect(openAt(hours, at(MON, '08:00'))).toBe('open');
    expect(openAt(hours, at(MON, '18:00'))).toBe('closed');
    expect(openAt(hours, at(SAT, '11:59'))).toBe('open');
    expect(openAt(hours, at(SAT, '12:30'))).toBe('closed');
    expect(openAt(hours, at(SUN, '10:00'))).toBe('closed');
  });

  it('handles split hours and a wrapping weekday range', () => {
    const hours = parseOpeningHours('Fr-Mo 10:00-12:00, 14:00-16:00');
    expect(openAt(hours, at(SUN, '11:00'))).toBe('open');
    expect(openAt(hours, at(SUN, '13:00'))).toBe('closed');
    expect(openAt(hours, at(MON, '15:00'))).toBe('open');
    expect(openAt(hours, at(2, '11:00'))).toBe('closed');
  });

  it('runs past midnight into the next day', () => {
    const hours = parseOpeningHours('Fr,Sa 18:00-02:00');
    expect(openAt(hours, at(SAT, '01:30'))).toBe('open'); // Friday night
    expect(openAt(hours, at(SUN, '01:30'))).toBe('open'); // Saturday night
    expect(openAt(hours, at(MON, '01:30'))).toBe('closed');
  });

  it('lets a later rule replace an earlier one for the days it names', () => {
    const hours = parseOpeningHours('Mo-Su 09:00-17:00; Su off');
    expect(openAt(hours, at(SAT, '10:00'))).toBe('open');
    expect(openAt(hours, at(SUN, '10:00'))).toBe('closed');
  });

  it('notes and skips public-holiday rules', () => {
    const hours = parseOpeningHours('Mo-Sa 07:00-22:00; PH off');
    expect(hours.kind === 'parsed' && hours.ignoredHolidays).toBe(true);
    expect(openAt(hours, at(MON, '07:30'))).toBe('open');
  });

  it.each([
    'Jan-Mar Mo-Fr 09:00-17:00',
    'sunrise-sunset',
    'Mo-Fr 09:00-17:00 || "by appointment"',
    'Mo-Fr 18:00+',
    'week 1-26 Mo 10:00-12:00',
    'open sometimes',
    '',
  ])('leaves %j unparsed rather than guessing', (raw) => {
    const hours = parseOpeningHours(raw);
    expect(hours.kind).toBe('unparsed');
    expect(openAt(hours, at(MON, '10:00'))).toBe('unknown');
  });

  it('absent hours are unknown, not open', () => {
    expect(openAt(null, at(MON, '10:00'))).toBe('unknown');
  });
});
