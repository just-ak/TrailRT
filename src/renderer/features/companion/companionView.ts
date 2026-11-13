import type { LibrarySection, ObjectRef } from '@shared/domain/types';

/**
 * Which view the right panel shows. Phase 14, design §4.3.
 *
 * The left panel holds structure and the map holds place; the right panel
 * answers "when" for whatever is selected. Pure, so every case is tested
 * without a window.
 */

export type CompanionView =
  | { kind: 'year' }
  /** A trip whose itinerary has not answered yet: nothing is guessed. */
  | { kind: 'loading'; tripId: string }
  | { kind: 'trip'; tripId: string }
  | { kind: 'undated'; tripId: string }
  | { kind: 'object'; ref: ObjectRef }
  | { kind: 'edit'; ref: ObjectRef };

export interface CompanionInput {
  selected: ObjectRef | null;
  /** The rail's section: the trip list shows trips and folders only. */
  section: LibrarySection;
  openTripId: string | null;
  editing: boolean;
  /** The trip the itinerary store has answered for, and whether it has dates. */
  itinerary: { tripId: string | null; answered: boolean; dated: boolean };
}

function tripView(tripId: string, itinerary: CompanionInput['itinerary']): CompanionView {
  if (itinerary.tripId !== tripId || (!itinerary.answered && !itinerary.dated)) return { kind: 'loading', tripId };
  return itinerary.dated ? { kind: 'trip', tripId } : { kind: 'undated', tripId };
}

export function companionView({ selected, section, openTripId, editing, itinerary }: CompanionInput): CompanionView {
  // Back at the trip list, an object left selected inside the trip is out of
  // sight: the year shows, as with nothing selected.
  if (section === 'trips' && openTripId === null && selected !== null && selected.kind !== 'trip' && selected.kind !== 'folder') {
    return { kind: 'year' };
  }
  if (editing && selected !== null) return { kind: 'edit', ref: selected };
  if (selected !== null && selected.kind !== 'trip') return { kind: 'object', ref: selected };
  // A trip shows by the hour while it is open. One still selected after going
  // back to the list gives way to the year.
  if (selected?.kind === 'trip' && selected.id === openTripId) return tripView(selected.id, itinerary);
  if (selected === null && openTripId !== null) return tripView(openTripId, itinerary);
  return { kind: 'year' };
}
