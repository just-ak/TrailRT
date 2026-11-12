import initial from './0000_initial.sql?raw';
import addObjectMetadata from './0001_add_object_metadata.sql?raw';
import routingAndAttributes from './0002_routing_and_attributes.sql?raw';
import controlPointRoles from './0003_control_point_roles.sql?raw';
import itinerary from './0004_itinerary.sql?raw';
import legModes from './0005_leg_modes.sql?raw';
import linkedFolders from './0006_linked_folders.sql?raw';

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
];

/** drizzle-kit's statement separator. */
export const STATEMENT_SEPARATOR = '--> statement-breakpoint';

export function splitStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
