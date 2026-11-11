/**
 * The facts about a POI worth showing, taken from its OSM tags.
 *
 * Only the fields Phase 10 Requirement 7.1 lists are kept: address, phone,
 * website, opening hours, brand, star rating, fuel types and charging
 * connectors. The rest of the tags are dropped at ingest, which keeps the
 * snapshot small and keeps the UI from showing tags nobody asked for.
 *
 * Every value is **untrusted plain text** from a public map. It is never
 * rendered as HTML, and a website goes through `openExternal`'s allowlist
 * before anything opens (Requirement 7.2).
 *
 * A missing tag is `null` or an empty list. It is never defaulted: a fuel
 * station with no opening hours is not "open 24 hours" (Requirement 7.4).
 */

export interface PoiAttributes {
  address: string | null;
  phone: string | null;
  website: string | null;
  /** Raw `opening_hours` text. Parsing is `openingHours.ts`'s job. */
  openingHours: string | null;
  brand: string | null;
  /** `stars`, as written: OSM allows `3`, `3S` (superior) and similar. */
  stars: string | null;
  /** Human labels for every `fuel:*=yes`, e.g. "Diesel". */
  fuels: string[];
  /** Human labels for every `socket:*`, with counts where given, e.g. "Type 2 × 4". */
  sockets: string[];
}

/** Tag prefixes and keys kept in the snapshot; everything else is dropped. */
const KEPT_KEYS = new Set([
  'name',
  'brand',
  'operator',
  'stars',
  'opening_hours',
  'phone',
  'contact:phone',
  'website',
  'contact:website',
  'addr:housenumber',
  'addr:housename',
  'addr:street',
  'addr:place',
  'addr:city',
  'addr:town',
  'addr:village',
  'addr:postcode',
]);

const KEPT_PREFIXES = ['fuel:', 'socket:'];

/** Longest value kept. OSM has a 255-character limit; this is a guard, not a policy. */
const MAX_VALUE = 255;

/** The subset of tags the snapshot stores. */
export function compactTags(tags: Readonly<Record<string, string>>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    if (KEPT_KEYS.has(key) || KEPT_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      kept[key] = value.slice(0, MAX_VALUE);
    }
  }
  return kept;
}

const FUEL_LABELS: Readonly<Record<string, string>> = {
  diesel: 'Diesel',
  'octane_95': 'Unleaded (95)',
  'octane_97': 'Super unleaded (97)',
  'octane_98': 'Super unleaded (98)',
  'octane_99': 'Super unleaded (99)',
  e10: 'E10 unleaded',
  e5: 'E5 unleaded',
  lpg: 'LPG',
  adblue: 'AdBlue',
  hgv_diesel: 'HGV diesel',
  cng: 'CNG',
  biodiesel: 'Biodiesel',
};

const SOCKET_LABELS: Readonly<Record<string, string>> = {
  type2: 'Type 2',
  type2_combo: 'CCS',
  chademo: 'CHAdeMO',
  type1: 'Type 1',
  type1_combo: 'CCS (Type 1)',
  bs1363: '3-pin plug',
  tesla_supercharger: 'Tesla Supercharger',
  tesla_destination: 'Tesla destination',
  type3: 'Type 3',
  cee_blue: 'Blue commando',
};

function humanise(key: string): string {
  const words = key.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function first(tags: Readonly<Record<string, string>>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = tags[key];
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return null;
}

function address(tags: Readonly<Record<string, string>>): string | null {
  const street = first(tags, 'addr:street', 'addr:place');
  const number = first(tags, 'addr:housenumber');
  // A house name that only repeats the street ("The Crescent, The Crescent")
  // adds nothing, so it is dropped.
  const named = first(tags, 'addr:housename');
  const house = named !== null && street !== null && named.toLowerCase() === street.toLowerCase() ? null : named;
  const locality = first(tags, 'addr:city', 'addr:town', 'addr:village');
  const postcode = first(tags, 'addr:postcode');

  const line1 = [house, [number, street].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const line2 = [locality, postcode].filter(Boolean).join(' ');
  const parts = [line1, line2].filter((part) => part.length > 0);
  return parts.length === 0 ? null : parts.join(', ');
}

export function extractAttributes(tags: Readonly<Record<string, string>>): PoiAttributes {
  const fuels: string[] = [];
  const sockets: string[] = [];

  for (const [key, value] of Object.entries(tags)) {
    if (key.startsWith('fuel:') && value === 'yes') {
      const fuel = key.slice('fuel:'.length);
      fuels.push(FUEL_LABELS[fuel] ?? humanise(fuel));
    }
    // `socket:type2=4` counts; `socket:type2:output=22 kW` is a detail of it.
    if (key.startsWith('socket:') && key.split(':').length === 2 && value !== 'no' && value !== '0') {
      const socket = key.slice('socket:'.length);
      const label = SOCKET_LABELS[socket] ?? humanise(socket);
      const count = Number.parseInt(value, 10);
      sockets.push(Number.isFinite(count) && count > 0 && /^\d+$/.test(value) ? `${label} × ${count}` : label);
    }
  }

  return {
    address: address(tags),
    phone: first(tags, 'phone', 'contact:phone'),
    website: first(tags, 'website', 'contact:website'),
    openingHours: first(tags, 'opening_hours'),
    brand: first(tags, 'brand', 'operator'),
    stars: first(tags, 'stars'),
    fuels: fuels.toSorted(),
    sockets: sockets.toSorted(),
  };
}

/**
 * Plain-text lines for a waypoint description made from a POI.
 *
 * Only the attributes that are present appear, so a description never shows
 * an empty "Phone:" line that looks like data was lost.
 */
export function describeAttributes(attributes: PoiAttributes): string[] {
  const lines: string[] = [];
  if (attributes.address !== null) lines.push(`Address: ${attributes.address}`);
  if (attributes.phone !== null) lines.push(`Phone: ${attributes.phone}`);
  if (attributes.website !== null) lines.push(`Website: ${attributes.website}`);
  if (attributes.openingHours !== null) lines.push(`Opening hours: ${attributes.openingHours}`);
  if (attributes.brand !== null) lines.push(`Brand: ${attributes.brand}`);
  if (attributes.stars !== null) lines.push(`Stars: ${attributes.stars}`);
  if (attributes.fuels.length > 0) lines.push(`Fuel: ${attributes.fuels.join(', ')}`);
  if (attributes.sockets.length > 0) lines.push(`Connectors: ${attributes.sockets.join(', ')}`);
  return lines;
}
