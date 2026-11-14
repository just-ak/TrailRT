import { api, call, describeError } from '../../lib/client';
import { useUiStore } from '../../stores/uiStore';

/** Saves a trip's plan as a calendar file (Phase 10 Requirement 5). */
export function saveToCalendar(tripId: string): void {
  void call(api().itinerary.exportIcs({ tripId, includeLegs: true }))
    .then((result) => {
      if (result.cancelled) return;
      const left = result.omitted.length === 0 ? '' : ` ${result.omitted.length} left out because their times are unknown.`;
      useUiStore.getState().showToast(`Saved ${result.fileName}: ${result.eventCount} events.${left}`);
    })
    .catch((cause: unknown) => useUiStore.getState().showToast(describeError(cause), 'error'));
}
