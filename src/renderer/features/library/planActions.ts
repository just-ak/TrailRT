import { api, call, describeError } from '../../lib/client';
import { useGeometryStore } from '../../stores/geometryStore';
import { useItineraryStore } from '../../stores/itineraryStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { usePlanStore } from '../../stores/planStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiStore } from '../../stores/uiStore';

/**
 * The plan's structure, changed from the left panel (Phase 14 Requirement
 * 11, design §4.9). Each is one undoable command in the main process.
 */

async function reloadAll(): Promise<void> {
  await Promise.all([
    useItineraryStore.getState().reload(),
    useGeometryStore.getState().reload(),
    useLibraryStore.getState().refresh(),
  ]);
}

async function attempt<T>(work: () => Promise<T>, done?: string): Promise<T | null> {
  try {
    const result = await work();
    await reloadAll();
    if (done !== undefined) useUiStore.getState().showToast(done);
    return result;
  } catch (cause) {
    useUiStore.getState().showToast(describeError(cause), 'error');
    await useItineraryStore.getState().reload();
    return null;
  }
}

/**
 * Adds the highlighted result where the open Add says, and selects it
 * (Requirements 11.4 and 12). A waypoint or place becomes a stop; a route
 * becomes the drive into the stop at that index, with a point stop at any end
 * that is not at the stop beside it (Requirement 13.4); a track is moved into the trip, where its own
 * times place it. Anything in another trip is copied or moved in, as chosen.
 */
export async function addCandidate(): Promise<void> {
  const { adding, candidate, transfer } = usePlanStore.getState();
  if (adding === null || candidate === null) return;
  const how = (from: { loose: boolean } | null) => (from === null || from.loose ? {} : { transfer });
  const added = await attempt(async (): Promise<{ kind: 'waypoint' | 'route' | 'track'; id: string }> => {
    switch (candidate.kind) {
      case 'waypoint': {
        if (candidate.from === null) {
          await call(api().itinerary.addStop({ tripId: adding.tripId, waypointId: candidate.id, index: adding.index }));
          return { kind: 'waypoint', id: candidate.id };
        }
        const out = await call(
          api().itinerary.addWaypointStop({ tripId: adding.tripId, waypointId: candidate.id, index: adding.index, ...how(candidate.from) }),
        );
        return { kind: 'waypoint', id: out.waypointId };
      }
      case 'place': {
        const out = await call(
          api().itinerary.addPlaceStop({ tripId: adding.tripId, name: candidate.name, lat: candidate.lat, lon: candidate.lon, index: adding.index }),
        );
        return { kind: 'waypoint', id: out.waypoint.id };
      }
      case 'route': {
        const out = await call(
          api().itinerary.addRouteLeg({ tripId: adding.tripId, routeId: candidate.id, index: adding.index, ...how(candidate.from) }),
        );
        return { kind: 'route', id: out.routeId };
      }
      case 'track': {
        // A track is never a stop: in the trip, its own times place it.
        await call(api().tracks.move({ id: candidate.id, tripId: adding.tripId }));
        return { kind: 'track', id: candidate.id };
      }
    }
  });
  if (added === null) return;
  usePlanStore.getState().stopAdding();
  await useSelectionStore.getState().select(added);
}

/**
 * A route dropped on a day (Requirement 12.7): it goes in there, joined to
 * the stops beside it where its ends are near them, and with a point stop
 * where they are not (Requirement 13.4).
 */
export async function dropRoute(tripId: string, routeId: string, index: number): Promise<void> {
  await attempt(() => call(api().itinerary.addRouteLeg({ tripId, routeId, index })));
}

/** Moves a stop to the index it has after the move. */
export function moveStop(stopId: string, toIndex: number): void {
  void attempt(() => call(api().itinerary.moveStop({ id: stopId, toIndex })));
}

/** Takes a stop out of the plan; its waypoint stays in the trip. */
export function removeStop(stopId: string, name: string): void {
  void attempt(() => call(api().itinerary.removeStop({ id: stopId })), `${name} taken out of the plan. It stays in the trip.`);
}

/** Puts a waypoint already in the trip into the plan at an index. */
export function addWaypointStop(tripId: string, waypointId: string, index: number): void {
  void attempt(() => call(api().itinerary.addStop({ tripId, waypointId, index })));
}

/** Add a Day (Requirement 15.1): after a day, or at the end of the plan. */
export function addDay(tripId: string, afterDate?: string): void {
  void attempt(() => call(api().itinerary.addDay({ tripId, ...(afterDate === undefined ? {} : { afterDate }) })));
}

/**
 * Remove a Day (Requirement 15.2): its routes and waypoints leave the plan
 * and stay in the trip, under Not in the plan. One undo step.
 */
export function removeDay(tripId: string, date: string, label: string): void {
  void attempt(async () => {
    const { removed } = await call(api().itinerary.removeDay({ tripId, date }));
    useUiStore
      .getState()
      .showToast(removed === 0 ? `${label} removed. Undo with ⌘Z.` : `${label} removed. Its ${removed === 1 ? 'entry is' : `${removed} entries are`} in Not in the plan. Undo with ⌘Z.`);
  });
}

/**
 * Delete from the plan's menus (Requirement 16.2): a route or waypoint goes
 * with every plan entry that uses it, as one undo step.
 */
export function deleteItem(ref: { kind: 'route' | 'waypoint'; id: string }, name: string): void {
  void attempt(async () => {
    await call(api().itinerary.deleteItem(ref));
    const selected = useSelectionStore.getState().selected;
    if (selected?.kind === ref.kind && selected.id === ref.id) await useSelectionStore.getState().select(null);
    useUiStore.getState().showToast(`${name} deleted. Undo with ⌘Z.`);
  });
}

/** Delete a track, through the confirmation that says it cannot be undone. */
export async function deleteTrack(id: string): Promise<void> {
  try {
    const members = [{ kind: 'track' as const, id }];
    const assessment = await call(api().batch.assess({ members, operation: 'delete' }));
    if (assessment.total > 0) useUiStore.getState().openDialog({ kind: 'confirmBatchDelete', members, assessment });
  } catch (cause) {
    useUiStore.getState().showToast(describeError(cause), 'error');
  }
}

/** Move Out of the Trip (ADR 0022): the item goes to Not in a trip, one undo step. */
export function moveOutOfTrip(ref: { kind: 'route' | 'waypoint' | 'track'; id: string }, name: string): void {
  void attempt(async () => {
    const loose = await call(api().trips.loose());
    await call(api().batch.move({ members: [ref], tripId: loose.id }));
    useUiStore.getState().showToast(`${name} moved out of the trip. Undo with ⌘Z.`);
  });
}
