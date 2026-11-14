import { CalendarPlus, CheckCircle2, Map as MapIcon, Route as RouteIcon, Search, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { dayLimitText } from '@shared/itinerary/consequence';
import { Button } from '../../components/Button';
import { api, call, describeError } from '../../lib/client';
import { useItineraryStore } from '../../stores/itineraryStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { PlanSettings, run } from '../itinerary/ItinerarySection';
import { saveToCalendar } from './companionActions';
import { DetailsHeading, OpenTripButton, OptionsMenu, SectionLabel } from './parts';

/**
 * The right panel for a trip (Phase 14 Requirement 4.2, design §4.8): only
 * what the left panel does not show. Its name, dates, days and stops are on
 * the left; here are when it leaves, whether the days fit the driving limit,
 * the driving rules, and the trip-wide actions. Every field saves on change,
 * one undo step each; there is no separate editor.
 */

const FIELD =
  'rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)]';

async function deleteTrip(tripId: string, name: string): Promise<void> {
  try {
    const trip = await call(api().trips.get({ id: tripId }));
    useUiStore.getState().openDialog({
      kind: 'confirmDelete',
      target: { type: 'trip', id: tripId, name },
      counts: { routeCount: trip.routeCount, trackCount: trip.trackCount, waypointCount: trip.waypointCount },
    });
  } catch (cause) {
    useUiStore.getState().showToast(describeError(cause), 'error');
  }
}

/** Description and notes, out of the way under ⋯ (Requirement 11.6). Kept in the data and its exports. */
function AboutFields({ tripId, onClose }: { tripId: string; onClose: () => void }): ReactNode {
  const trip = useSelectionStore((s) => (s.trip?.id === tripId ? s.trip : null));
  const [description, setDescription] = useState(trip?.description ?? '');
  const [notes, setNotes] = useState(trip?.notes ?? '');
  const save = (patch: { description?: string | null; notes?: string | null }): void => {
    void (async () => {
      try {
        await call(api().trips.update({ id: tripId, ...patch }));
        await useSelectionStore.getState().reload();
      } catch (cause) {
        useUiStore.getState().showToast(describeError(cause), 'error');
      }
    })();
  };
  return (
    <section aria-label="Description and notes" className="mt-3 grid gap-2 rounded-xl bg-[var(--color-surface-sunken)] p-3">
      <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
        Description
        <textarea
          aria-label="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => save({ description: description.trim() === '' ? null : description })}
          className={FIELD}
        />
      </label>
      <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
        Notes
        <textarea
          aria-label="Notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => save({ notes: notes.trim() === '' ? null : notes })}
          className={FIELD}
        />
      </label>
      <Button onClick={onClose}>Done</Button>
    </section>
  );
}

export function TripDetails({ tripId }: { tripId: string }): ReactNode {
  const view = useItineraryStore((s) => (s.tripId === tripId ? s.view : null));
  const name = useLibraryStore((s) => s.overview.find((t) => t.id === tripId)?.name ?? 'This trip');
  const units = useSettingsStore((s) => s.settings.units);
  const openPoiPanel = useUiStore((s) => s.openPoiPanel);
  const [about, setAbout] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (view === null) return null;

  const { itinerary } = view;
  const limit = dayLimitText(view);

  return (
    <div data-testid="trip-details">
      <DetailsHeading icon={<MapIcon size={18} aria-hidden="true" className="text-[var(--color-accent)]" />} title="This trip">
        <OpenTripButton tripId={tripId} />
        <OptionsMenu
          hint="Trip options"
          items={[
            { label: 'Description and Notes…', onSelect: () => setAbout(true) },
            { label: 'Remove the Plan…', separatorBefore: true, danger: true, onSelect: () => setRemoving(true) },
            { label: 'Delete Trip…', danger: true, onSelect: () => void deleteTrip(tripId, name) },
          ]}
        />
      </DetailsHeading>

      {about && <AboutFields tripId={tripId} onClose={() => setAbout(false)} />}

      {removing && (
        <div role="alertdialog" aria-label="Remove the plan" className="mt-3 rounded-xl border border-[var(--color-danger)] p-3 text-[12px]">
          <p className="text-[var(--color-text-primary)]">Remove the plan? The stops’ waypoints and the routes stay in the trip.</p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="danger"
              onClick={() => {
                setRemoving(false);
                void run(() => call(api().itinerary.remove({ tripId })), 'Plan removed. Undo brings it back.');
              }}
            >
              Remove
            </Button>
            <Button onClick={() => setRemoving(false)}>Keep it</Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
          Leave
          <input
            type="date"
            aria-label="Leave on"
            value={itinerary.startDate}
            onChange={(e) => e.target.value !== '' && void run(() => call(api().itinerary.update({ tripId, startDate: e.target.value })))}
            className={FIELD}
          />
        </label>
        <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
          at
          <input
            type="time"
            aria-label="Leave at"
            value={itinerary.startTime}
            onChange={(e) => e.target.value !== '' && void run(() => call(api().itinerary.update({ tripId, startTime: e.target.value })))}
            className={FIELD}
          />
        </label>
      </div>

      {limit !== null && (
        <p
          data-testid="day-limit"
          className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium ${
            limit.ok ? 'bg-[var(--color-accent)]/10 text-[var(--color-text-primary)]' : 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
          }`}
        >
          {limit.ok ? <CheckCircle2 size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
          {limit.text}
        </p>
      )}

      <PlanSettings view={view} units={units} open />

      <SectionLabel>Along the trip</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {view.stops.some((stop, i) => i > 0 && stop.legMode === 'road' && stop.legRouteId === null) && (
          <Button onClick={() => void run(() => call(api().itinerary.planAll({ tripId })), 'Planned the drives the map regions cover.')}>
            <RouteIcon size={14} aria-hidden="true" /> Plan the drives by road
          </Button>
        )}
        <Button onClick={() => openPoiPanel({ kind: 'itinerary', tripId })}>
          <Search size={14} aria-hidden="true" /> Places along the trip
        </Button>
        <Button onClick={() => void saveToCalendar(tripId)}>
          <CalendarPlus size={14} aria-hidden="true" /> Save to a calendar
        </Button>
      </div>
    </div>
  );
}
