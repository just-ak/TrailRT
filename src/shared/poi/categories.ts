/**
 * Which OpenStreetMap features count as which kind of point of interest.
 *
 * The single place a POI tag is named (Phase 10 Requirement 5.7). The region
 * build's `osmium tags-filter` expression is generated from this table, and
 * the ingest classifies with it, so the two cannot disagree about what a
 * "hotel" is.
 *
 * Every row says why it is there. Tags are OSM's own vocabulary, documented on
 * the OSM wiki under the key named.
 */

export const POI_CATEGORY_IDS = [
  'accommodation',
  'fuel',
  'charging',
  'food',
  'attractions',
  'parking',
  'toilets',
  'supermarket',
  'vehicle',
] as const;

export type PoiCategoryId = (typeof POI_CATEGORY_IDS)[number];

export interface PoiTagRule {
  key: string;
  values: readonly string[];
}

export interface PoiCategory {
  id: PoiCategoryId;
  label: string;
  /** For sentences: "No fuel stations mapped within 2 km". */
  plural: string;
  rules: readonly PoiTagRule[];
  /** Waypoint symbol id from `shared/domain/symbols.ts`. */
  symbol: string;
  reason: string;
}

export const POI_CATEGORIES: readonly PoiCategory[] = [
  {
    id: 'accommodation',
    label: 'Accommodation',
    plural: 'places to stay',
    rules: [
      {
        key: 'tourism',
        values: [
          'hotel',
          'motel',
          'guest_house',
          'hostel',
          'camp_site',
          'caravan_site',
          'chalet',
          'apartment',
        ],
      },
    ],
    symbol: 'lodging',
    reason:
      'Every tourism value for somewhere a traveller can book a night. Bed and breakfasts are tagged guest_house in OSM.',
  },
  {
    id: 'fuel',
    label: 'Fuel',
    plural: 'fuel stations',
    rules: [{ key: 'amenity', values: ['fuel'] }],
    symbol: 'fuel',
    reason: 'amenity=fuel is the only OSM tag for a filling station.',
  },
  {
    id: 'charging',
    label: 'EV charging',
    plural: 'charging points',
    rules: [{ key: 'amenity', values: ['charging_station'] }],
    // There is no charging symbol, and Garmin has no <sym> name for one, so
    // the fuel symbol is the nearest honest choice.
    symbol: 'fuel',
    reason: 'amenity=charging_station is the OSM tag for a vehicle charging point.',
  },
  {
    id: 'food',
    label: 'Food and drink',
    plural: 'places to eat or drink',
    rules: [{ key: 'amenity', values: ['restaurant', 'cafe', 'pub', 'fast_food', 'bar'] }],
    symbol: 'food',
    reason: 'The amenity values for somewhere to sit and eat or drink. Pubs in the UK usually serve food.',
  },
  {
    id: 'attractions',
    label: 'Attractions and viewpoints',
    plural: 'attractions',
    rules: [
      {
        key: 'tourism',
        values: ['attraction', 'museum', 'viewpoint', 'gallery', 'zoo', 'theme_park', 'picnic_site'],
      },
      { key: 'historic', values: ['castle', 'ruins', 'monument'] },
    ],
    symbol: 'viewpoint',
    reason:
      'Things worth stopping for. Historic values are limited to the visitable ones; historic=memorial covers every plaque and bench.',
  },
  {
    id: 'parking',
    label: 'Parking',
    plural: 'car parks',
    rules: [{ key: 'amenity', values: ['parking', 'motorcycle_parking'] }],
    symbol: 'parking',
    reason:
      'Car parks and motorcycle bays. Private parking and unnamed on-street bays are excluded; they were 15,000 of the 35,000 POIs in three counties and buried everything else.',
  },
  {
    id: 'toilets',
    label: 'Toilets',
    plural: 'public toilets',
    rules: [{ key: 'amenity', values: ['toilets'] }],
    symbol: 'pin',
    reason: 'amenity=toilets. Private ones are excluded.',
  },
  {
    id: 'supermarket',
    label: 'Supermarkets and shops',
    plural: 'supermarkets or shops',
    rules: [{ key: 'shop', values: ['supermarket', 'convenience'] }],
    symbol: 'pin',
    reason: 'Where to buy food and supplies. Convenience stores are included because rural areas often have nothing larger.',
  },
  {
    id: 'vehicle',
    label: 'Vehicle services',
    plural: 'garages',
    rules: [{ key: 'shop', values: ['car_repair', 'motorcycle', 'tyres'] }],
    symbol: 'pin',
    reason: 'Repairs, tyres and motorcycle dealers, which usually service too.',
  },
];

const BY_ID: ReadonlyMap<PoiCategoryId, PoiCategory> = new Map(
  POI_CATEGORIES.map((category) => [category.id, category]),
);

export function categoryById(id: PoiCategoryId): PoiCategory {
  const category = BY_ID.get(id);
  if (category === undefined) throw new Error(`Unknown POI category: ${id}`);
  return category;
}

export function isPoiCategoryId(value: unknown): value is PoiCategoryId {
  return (POI_CATEGORY_IDS as readonly unknown[]).includes(value);
}

/** Excluded whatever else they are tagged with: the public cannot use them. */
const PRIVATE_ACCESS = new Set(['private', 'no']);

/** Unnamed parking of these kinds is kerbside bays, not somewhere to aim for. */
const KERBSIDE_PARKING = new Set(['street_side', 'lane', 'on_kerb', 'half_on_kerb']);

export interface Classification {
  category: PoiCategoryId;
  /** The tag value that matched, e.g. `hotel`. */
  kind: string;
}

/**
 * Classifies a feature's tags, or returns null when it is not a POI here.
 *
 * Categories are tried in table order, so a feature tagged both
 * `tourism=hotel` and `amenity=restaurant` is accommodation, which is what
 * someone looking for a bed needs to find.
 */
export function classifyTags(tags: Readonly<Record<string, string>>): Classification | null {
  if (PRIVATE_ACCESS.has(tags.access ?? '')) return null;

  for (const category of POI_CATEGORIES) {
    for (const rule of category.rules) {
      const value = tags[rule.key];
      if (value === undefined || !rule.values.includes(value)) continue;
      if (
        category.id === 'parking' &&
        (tags.name === undefined || tags.name === '') &&
        KERBSIDE_PARKING.has(tags.parking ?? '')
      ) {
        return null;
      }
      return { category: category.id, kind: value };
    }
  }
  return null;
}

/** The waypoint symbol for a classified POI. Camp and caravan sites get the tent. */
export function symbolFor(classification: Classification): string {
  if (classification.kind === 'camp_site' || classification.kind === 'caravan_site') {
    return 'campground';
  }
  return categoryById(classification.category).symbol;
}

/**
 * `osmium tags-filter` expressions selecting every POI in the table.
 *
 * `nwr/` takes nodes, ways and relations: a hotel can be a point, a building
 * outline or a multipolygon, and Requirement 5.2 forbids dropping the areas.
 * Rules sharing a key are merged into one expression.
 */
export function osmiumPoiFilters(): string[] {
  const byKey = new Map<string, Set<string>>();
  for (const category of POI_CATEGORIES) {
    for (const rule of category.rules) {
      const values = byKey.get(rule.key) ?? new Set<string>();
      for (const value of rule.values) values.add(value);
      byKey.set(rule.key, values);
    }
  }
  return [...byKey.entries()].map(([key, values]) => `nwr/${key}=${[...values].join(',')}`);
}
