/**
 * Reading what someone typed as a UK postcode.
 *
 * A postcode is an outward code (area letters, district number, optional
 * letter: `B1`, `SK17`, `EC1A`) and an inward code (sector digit and two unit
 * letters: `6AA`). People type them in every case and with any spacing, so
 * `de451aa`, `DE45 1AA` and `de45  1aa` must all mean the same thing
 * (Phase 10 Requirement 11.4).
 *
 * The classification decides what search does:
 *
 * - **full**: one postcode, resolved to its centre (11.5)
 * - **sector** (`DE45 1`) or **outcode** (`DE45`): an area, shown as
 *   approximate (11.6)
 * - **uncovered**: a well-formed postcode in an area Code-Point Open does not
 *   cover, which gets its own message rather than "not found" (11.8)
 * - **none**: not a postcode, so it is searched as a place name (11.7)
 *
 * Postcodes are stored formatted, with exactly one space (`DE45 1AA`). That
 * makes "outcode DE4" the prefix `DE4 `, which can never match `DE45 …`.
 */

/** Areas a well-formed postcode can be in that Code-Point Open does not cover. */
export const UNCOVERED_AREAS: Readonly<Record<string, string>> = {
  BT: 'Northern Ireland',
  IM: 'the Isle of Man',
  JE: 'Jersey',
  GY: 'Guernsey',
};

/**
 * The 120 postcode areas Code-Point Open covers: Great Britain. Taken from the
 * file names of the 2026-11 release, one CSV per area. A road number such as
 * `A515` has the shape of a postcode sector, so the area has to be checked
 * against a real list before anything is read as a postcode.
 */
export const GB_POSTCODE_AREAS: ReadonlySet<string> = new Set([
  'AB', 'AL', 'B', 'BA', 'BB', 'BD', 'BH', 'BL', 'BN', 'BR', 'BS', 'CA', 'CB',
  'CF', 'CH', 'CM', 'CO', 'CR', 'CT', 'CV', 'CW', 'DA', 'DD', 'DE', 'DG', 'DH',
  'DL', 'DN', 'DT', 'DY', 'E', 'EC', 'EH', 'EN', 'EX', 'FK', 'FY', 'G', 'GL',
  'GU', 'HA', 'HD', 'HG', 'HP', 'HR', 'HS', 'HU', 'HX', 'IG', 'IP', 'IV', 'KA',
  'KT', 'KW', 'KY', 'L', 'LA', 'LD', 'LE', 'LL', 'LN', 'LS', 'LU', 'M', 'ME',
  'MK', 'ML', 'N', 'NE', 'NG', 'NN', 'NP', 'NR', 'NW', 'OL', 'OX', 'PA', 'PE',
  'PH', 'PL', 'PO', 'PR', 'RG', 'RH', 'RM', 'S', 'SA', 'SE', 'SG', 'SK', 'SL',
  'SM', 'SN', 'SO', 'SP', 'SR', 'SS', 'ST', 'SW', 'SY', 'TA', 'TD', 'TF', 'TN',
  'TQ', 'TR', 'TS', 'TW', 'UB', 'W', 'WA', 'WC', 'WD', 'WF', 'WN', 'WR', 'WS',
  'WV', 'YO', 'ZE',
]);

export type PostcodeQuery =
  | { kind: 'full'; postcode: string; outward: string; area: string }
  | { kind: 'sector'; sector: string; outward: string; area: string }
  | { kind: 'outcode'; outward: string; area: string }
  | { kind: 'uncovered'; area: string; region: string; text: string }
  | { kind: 'none' };

const OUTWARD = /^([A-Z]{1,2})[0-9][A-Z0-9]?$/;
const FULL_COMPACT = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;
const SECTOR_COMPACT = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9])$/;

/** Upper case, all whitespace removed: `de45 1aa` → `DE451AA`. */
export function compactPostcode(text: string): string {
  return text.toUpperCase().replaceAll(/\s+/g, '');
}

/**
 * The stored form, with one space before the inward code, or null when the
 * text is not a full postcode. Code-Point Open pads short outward codes to a
 * fixed width (`B1  1AA`); this undoes that.
 */
export function formatPostcode(text: string): string | null {
  const compact = compactPostcode(text);
  if (compact === 'GIR0AA') return 'GIR 0AA';
  const match = FULL_COMPACT.exec(compact);
  if (match === null) return null;
  return `${match[1]} ${match[2]}`;
}

function areaOf(outward: string): string {
  return OUTWARD.exec(outward)?.[1] ?? outward;
}

function classified(
  query: Exclude<PostcodeQuery, { kind: 'none' | 'uncovered' }>,
  text: string,
): PostcodeQuery {
  const region = UNCOVERED_AREAS[query.area];
  if (region !== undefined) return { kind: 'uncovered', area: query.area, region, text };
  if (!GB_POSTCODE_AREAS.has(query.area)) return { kind: 'none' };
  return query;
}

export function classifyPostcode(input: string): PostcodeQuery {
  const text = input.trim().toUpperCase().replaceAll(/\s+/g, ' ');
  if (text.length === 0 || /[^A-Z0-9 ]/.test(text)) return { kind: 'none' };
  if (text.replaceAll(' ', '') === 'GIR0AA') {
    return { kind: 'full', postcode: 'GIR 0AA', outward: 'GIR', area: 'GIR' };
  }

  const parts = text.split(' ');
  if (parts.length > 2) return { kind: 'none' };

  // With a space, the user has told us where the outward code ends.
  if (parts.length === 2) {
    const [outward = '', inward = ''] = parts;
    if (!OUTWARD.test(outward)) return { kind: 'none' };
    const area = areaOf(outward);
    if (/^[0-9][A-Z]{2}$/.test(inward)) {
      return classified({ kind: 'full', postcode: `${outward} ${inward}`, outward, area }, text);
    }
    // `DE45 1` and `DE45 1A` (half-typed) both search the sector.
    if (/^[0-9][A-Z]?$/.test(inward)) {
      return classified({ kind: 'sector', sector: `${outward} ${inward.charAt(0)}`, outward, area }, text);
    }
    return { kind: 'none' };
  }

  const compact = parts[0] ?? '';
  const full = FULL_COMPACT.exec(compact);
  if (full !== null) {
    const outward = full[1] ?? '';
    return classified(
      { kind: 'full', postcode: `${outward} ${full[2] ?? ''}`, outward, area: areaOf(outward) },
      text,
    );
  }
  // `DE45` is read as an outcode before it is read as DE4 sector 5: an
  // outcode is what people type when they mean an area.
  if (OUTWARD.test(compact)) {
    return classified({ kind: 'outcode', outward: compact, area: areaOf(compact) }, text);
  }
  const sector = SECTOR_COMPACT.exec(compact);
  if (sector !== null) {
    const outward = sector[1] ?? '';
    return classified(
      { kind: 'sector', sector: `${outward} ${sector[2] ?? ''}`, outward, area: areaOf(outward) },
      text,
    );
  }
  return { kind: 'none' };
}
