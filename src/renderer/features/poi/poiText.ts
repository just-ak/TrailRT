import type { UnitSystem } from '@shared/domain/types';
import { formatDistance } from '@shared/geo/units';
import type { RangeGap } from '@shared/itinerary/rangeCheck';
import { formatDate } from '@shared/itinerary/format';
import { categoryById, type PoiCategoryId } from '@shared/poi/categories';
import type { OpenState } from '@shared/poi/openingHours';

/**
 * Wording for the along-the-route panel. Pure, so the honesty rules are
 * tested: an empty result says nothing is **mapped**, never that nothing
 * exists (Requirement 7.5), and a range warning says the same (9.4).
 */

/** "fuel stations", "fuel stations or places to eat or drink", … */
export function categoriesText(categories: readonly PoiCategoryId[]): string {
  const words = categories.map((id) => categoryById(id).plural);
  if (words.length <= 1) return words[0] ?? 'places';
  return `${words.slice(0, -1).join(', ')} or ${words.at(-1) ?? ''}`;
}

export function dataDateText(date: string | null): string {
  return date === null ? 'date unknown' : `data from ${formatDate(date)}`;
}

export function emptyText(
  categories: readonly PoiCategoryId[],
  widthM: number,
  dataDate: string | null,
  units: UnitSystem,
): string {
  return `No ${categoriesText(categories)} mapped in OpenStreetMap within ${formatDistance(widthM, units)} of the route · ${dataDateText(dataDate)}. That does not mean there are none.`;
}

export function rangeGapText(gap: RangeGap, widthM: number, units: UnitSystem, electric: boolean): string {
  const where = `${formatDistance(gap.fromM, units)} to ${formatDistance(gap.toM, units)}`;
  const thing = electric ? 'charging point' : 'fuel station';
  if (gap.status === 'not-checked') {
    return `${where}: longer than your range, and partly outside your map regions, so it could not be checked.`;
  }
  return `${where} (${formatDistance(gap.lengthM, units)}): no ${thing} mapped in OpenStreetMap within ${formatDistance(widthM, units)} of the route, which is further than your range less reserve. There may be one that is not mapped.`;
}

export function openText(state: OpenState): string | null {
  if (state === 'open') return 'Should be open then';
  if (state === 'closed') return 'Should be closed then';
  return null;
}

/** Only web addresses go to the browser; anything else in a website tag is shown as text. */
export function safeWebsite(raw: string | null): string | null {
  if (raw === null) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
