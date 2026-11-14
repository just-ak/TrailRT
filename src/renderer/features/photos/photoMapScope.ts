import type { PhotoMapScope } from '@shared/domain/linkedFolders';

/**
 * Which photos the map shows (design §9.1). While the Photos view is
 * selected, every trip's located photos, narrowed by the view's Year and Trip
 * filters (all-trips mode, Requirement 5.6). Otherwise, the photos of the trip
 * the map is showing (trip mode), or none.
 */
export function mapScopeFor(input: {
  allTrips: boolean;
  tripId: string | null;
  filter: { year?: number | 'none'; tripId?: string };
  includeArchived: boolean;
}): PhotoMapScope | null {
  if (input.allTrips) {
    const scope: PhotoMapScope = { all: true, includeArchived: input.includeArchived };
    if (input.filter.year !== undefined) scope.year = input.filter.year;
    if (input.filter.tripId !== undefined) scope.tripId = input.filter.tripId;
    return scope;
  }
  return input.tripId === null ? null : { tripId: input.tripId };
}

/** A stable key for a scope, so the same request is not made twice. */
export function scopeKey(scope: PhotoMapScope | null): string {
  return scope === null ? 'none' : JSON.stringify(scope);
}
