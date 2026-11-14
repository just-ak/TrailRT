import type { ItineraryStop } from '@shared/domain/itinerary';
import type { Waypoint } from '@shared/domain/types';
import { NO_LOCATION_TEXT, photoDay, photoWaypointFields } from '@shared/photos/photoWaypoint';
import type { Db } from '../db/client';
import { batch } from './compose';
import { ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as itineraryService from './itineraryService';
import type { PlanningSettings } from './itineraryService';
import * as photoService from './photoService';
import * as waypointService from './waypointService';

/**
 * A photo used as a waypoint, or as a stop. Phase 14 Requirement 18.3 to
 * 18.5, design §5.11.
 *
 * The renderer names the photo, never its coordinates: they are read again
 * from the index here. A photo used twice in the same trip gives back the
 * waypoint it made the first time, matched by source, name and place, so
 * nothing is stored in the waypoint's `metadata`, which holds imported
 * fields the Garmin phase writes back out.
 */

/** The trip a photo's waypoint goes in: the one given, or the photo's own. */
function targetTrip(db: Db, photoId: string, tripId: string | undefined): { tripId: string; details: ReturnType<typeof photoService.details> } {
  const details = photoService.details(db, photoId);
  return { tripId: tripId ?? details.tripId, details };
}

/** Makes the waypoint, or finds the one this photo already made in the trip. */
export function fromPhoto(db: Db, input: { photoId: string; tripId?: string | undefined }): Mutation<Waypoint> {
  return db.transaction(() => {
    const { tripId, details } = targetTrip(db, input.photoId, input.tripId);
    const fields = photoWaypointFields(details.photo);
    if (fields === null) throw new ServiceError('INVALID_REQUEST', NO_LOCATION_TEXT);
    const existing = waypointService
      .listForTrip(db, tripId)
      .find((w) => w.source === 'photo' && w.name === fields.name && w.lat === fields.lat && w.lon === fields.lon);
    if (existing !== undefined) return { result: existing, inverse: { kind: 'none', payload: {} } };
    return waypointService.create(db, {
      tripId,
      ...fields,
      notes: null,
      groupId: null,
      source: 'photo',
    });
  });
}

/**
 * A photo as a stop in the trip's plan, waypoint and all, one undo: at
 * `index`, or else on the day it was taken, or at the end.
 */
export function addPhotoStop(
  db: Db,
  input: { tripId: string; photoId: string; index?: number | undefined },
  settings: PlanningSettings,
): Mutation<{ waypoint: Waypoint; stop: ItineraryStop }> {
  return db.transaction(() => {
    const index =
      input.index ??
      itineraryService.dayIndex(db, input.tripId, photoDay(photoService.details(db, input.photoId).photo.takenLocal), settings);
    const waypoint = fromPhoto(db, { photoId: input.photoId, tripId: input.tripId });
    const stop = itineraryService.addStop(db, {
      tripId: input.tripId,
      waypointId: waypoint.result.id,
      index,
      durationKind: 'hours',
      durationMinutes: 30,
    });
    return batch({ waypoint: waypoint.result, stop: stop.result }, waypoint, stop);
  });
}
