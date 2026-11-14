import initial from './0000_initial.sql?raw';
import addObjectMetadata from './0001_add_object_metadata.sql?raw';
import routingAndAttributes from './0002_routing_and_attributes.sql?raw';
import controlPointRoles from './0003_control_point_roles.sql?raw';
import itinerary from './0004_itinerary.sql?raw';
import legModes from './0005_leg_modes.sql?raw';
import linkedFolders from './0006_linked_folders.sql?raw';
import tripRole from './0007_trip_role.sql?raw';
import pointStops from './0008_point_stops.sql?raw';
import routeEntries from './0009_route_entries.sql?raw';
import dayEntries from './0010_day_entries.sql?raw';

export interface Migration {
  /** Monotonic. Recorded in `schema_migrations` once applied. */
  version: number;
  name: string;
  sql: string;
}

/**
 * Ordered migration list. Append only — never edit an applied migration, since
 * existing installations will not re-run it.
 *
 * Regenerate SQL with `npm run db:generate` after changing `schema.ts`, then
 * add the new file here.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0000_initial', sql: initial },
  // Phase 3: routes, tracks and waypoints gain a metadata column so imported
  // fields with no column of their own are preserved rather than dropped.
  { version: 2, name: '0001_add_object_metadata', sql: addObjectMetadata },
  // Phase 4: snap-to-road provenance on routes, the control points the user
  // placed, and the map-matched road-attribute cache.
  { version: 3, name: '0002_routing_and_attributes', sql: routingAndAttributes },
  // Phase 6: control points gain a role (via or shaping) and the index of
  // their leg boundary in `route_points`, so one leg can be replaced in place.
  { version: 4, name: '0003_control_point_roles', sql: controlPointRoles },
  // Phase 10: a trip's dated itinerary of stops. Two new tables; nothing
  // existing changes. ADR 0019 §2.
  { version: 5, name: '0004_itinerary', sql: itinerary },
  // Phase 10 feedback: each leg is by road, a chosen route, or other transport.
  { version: 6, name: '0005_leg_modes', sql: legModes },
  // Phase 11: linked folders, the file index and photo metadata. Three new
  // tables; nothing existing changes. ADR 0020, design §2.
  { version: 7, name: '0006_linked_folders', sql: linkedFolders },
  // Phase 14: a trip's role, so one hidden holder can keep items that are
  // outside any trip. One column and one index. ADR 0022.
  { version: 8, name: '0007_trip_role', sql: tripRole },
  // Phase 14: a stop may be a point rather than a waypoint, so a plan can
  // start or end with a route. The stops table is rebuilt. Design §5.6.
  { version: 9, name: '0008_point_stops', sql: pointStops },
  // Phase 14: a route placed in the plan as an entry of its own, so a plan is
  // routes and waypoints in any order. The stops table is rebuilt. §5.7.
  { version: 10, name: '0009_route_entries', sql: routeEntries },
  // Phase 14: a day break as an entry, so days are added and removed. §5.8.
  { version: 11, name: '0010_day_entries', sql: dayEntries },
];

/** drizzle-kit's statement separator. */
export const STATEMENT_SEPARATOR = '--> statement-breakpoint';

export function splitStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
