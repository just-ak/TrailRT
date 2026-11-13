import type { Id, TripStatus } from './types';

/**
 * One trip as the library lists it. Phase 14, design §3.2.
 *
 * Built once per change in the main process, beside the itinerary it reads,
 * so the trip list and the year view need one call, not one per trip.
 */
export interface TripOverview {
  id: Id;
  name: string;
  folderId: Id | null;
  status: TripStatus;
  /** `YYYY-MM-DD` of the itinerary's start; null for a trip with no dates. */
  startDate: string | null;
  /** Its last day, when every drive is timed; null when unknown or undated. */
  endDate: string | null;
  /** Number of days, when the end is known. */
  days: number | null;
  /** Planned length by road; null when nothing is measured. */
  distanceM: number | null;
  /** Planned driving, when every drive is timed; null otherwise, never zero for unknown. */
  driveSeconds: number | null;
  /** The first stop's name and when the trip leaves it, for the year view's today and tomorrow. */
  startPlace: string | null;
  startTime: string | null;
  counts: { routes: number; tracks: number; waypoints: number; photos: number; linkedFolders: number };
  createdAt: number;
  updatedAt: number;
}
