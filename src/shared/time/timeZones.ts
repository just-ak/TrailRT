import type { LatLon } from '../geo/distance';
import { pointInRings, ringsBoundingBox, type Ring } from '../geo/polygon';
import { UK_BOUNDARY } from '../geo/ukBoundary';

/**
 * Which time zone a place is in, answered offline.
 *
 * A stop's times are shown in its own local time (Requirement 3.8), and the
 * answer must not need a network (3.9). Valhalla can answer it from
 * `timezones.sqlite`, but building that file downloads a boundary release of
 * about 60 MB, which is a network dependency for an answer that, for every
 * region the app offers today, is one polygon. ADR 0019 §3.
 *
 * So the answer comes from a small table of polygons. A place outside all of
 * them is **unknown**, and the caller shows that stop in the computer's own
 * zone with a label saying so. It is never quietly assumed to be London.
 * Adding a country is a row here, not a code change.
 */

export type TimeZoneResolver = (point: LatLon) => string | null;

export interface ZonePolygon {
  /** IANA zone name. */
  zone: string;
  rings: readonly Ring[];
  /** Where the outline came from, for the attribution trail. */
  source: string;
}

export const ZONE_POLYGONS: readonly ZonePolygon[] = [
  {
    zone: 'Europe/London',
    rings: [UK_BOUNDARY],
    // Includes Northern Ireland; excludes the Isle of Man and the Channel
    // Islands, which keep their own zones (Europe/Isle_of_Man, Europe/Jersey,
    // Europe/Guernsey) even though their clocks match London's.
    source: 'Geofabrik united-kingdom boundary, via shared/geo/ukBoundary.ts',
  },
];

/** Builds a resolver over a polygon table. The table is checked in order. */
export function createZoneResolver(
  table: readonly ZonePolygon[] = ZONE_POLYGONS,
): TimeZoneResolver {
  const entries = table.map((entry) => ({
    ...entry,
    box: ringsBoundingBox(entry.rings),
  }));

  return (point) => {
    for (const entry of entries) {
      const box = entry.box;
      if (
        box === null ||
        point.lat < box.minLat ||
        point.lat > box.maxLat ||
        point.lon < box.minLon ||
        point.lon > box.maxLon
      ) {
        continue;
      }
      if (pointInRings(entry.rings, point)) return entry.zone;
    }
    return null;
  };
}

/** The resolver the application uses. */
export const resolveTimeZone: TimeZoneResolver = createZoneResolver();
