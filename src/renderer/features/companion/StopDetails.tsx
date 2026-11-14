import { Camera, MapPin } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Photo } from '@shared/domain/linkedFolders';
import { haversineDistance } from '@shared/geo/distance';
import { consequenceText, stayConsequence } from '@shared/itinerary/consequence';
import { shortDay } from '@shared/library/tripGroups';
import { utcToWallClock } from '@shared/time/zoned';
import { api, call } from '../../lib/client';
import { useCompanionStore } from '../../stores/companionStore';
import { useItineraryStore } from '../../stores/itineraryStore';
import { usePhotoStore } from '../../stores/photoStore';
import { DurationEditor, NotesField, run, StopFlags, StopTimes, update } from '../itinerary/ItinerarySection';
import { DetailsHeading, KIND_COLOUR, OptionsMenu, SectionLabel } from './parts';

/**
 * The right panel for a stop (Phase 14 Requirement 4.4, design §4.8). The
 * stay is the one thing set here; arrival and leaving are worked out, and
 * shown on the left. While the stay is being typed, a line says what it would
 * move, before anything is saved.
 */

const NO_PHOTOS: readonly Photo[] = [];
/** Photos taken this close count as taken at the stop. */
const NEAR_M = 1000;

export function StopDetails({ stopId }: { stopId: string }): ReactNode {
  const view = useItineraryStore((s) => s.view);
  const tripPhotos = usePhotoStore((s) => (s.tripPhotos.tripId === view?.itinerary.tripId ? s.tripPhotos.photos : NO_PHOTOS));
  const [draft, setDraft] = useState<{ minutes?: number; days?: number } | null>(null);

  const index = view?.stops.findIndex((s) => s.id === stopId) ?? -1;
  const stop = index < 0 ? undefined : view?.stops[index];
  const place = stop?.place ?? null;
  const near = useMemo(
    () =>
      place === null
        ? 0
        : tripPhotos.filter((p) => p.lat !== null && p.lon !== null && haversineDistance(place, { lat: p.lat, lon: p.lon }) <= NEAR_M).length,
    [place, tripPhotos],
  );
  if (view === null || stop === undefined) return null;

  const timed = view.timeline.stops[index];
  const day = timed?.arrival != null ? shortDay(utcToWallClock(timed.arrival, timed.zone).date) : index === 0 ? shortDay(view.itinerary.startDate) : null;
  const consequence = draft === null ? null : stayConsequence(view, stop.id, draft);
  const isLast = index === view.stops.length - 1;
  // The first stop is left at the trip's leaving time; the last is where it ends.
  const hasStay = index > 0 && !isLast;

  return (
    <div data-testid="stop-details">
      <DetailsHeading
        icon={<MapPin size={18} aria-hidden="true" style={{ color: KIND_COLOUR.waypoint }} />}
        title={place?.name ?? 'Place deleted'}
        sub={[stop.point !== null ? `Point ${index + 1}, where a route starts or ends` : `Stop ${index + 1}`, day].filter(Boolean).join(' · ')}
      >
        <OptionsMenu
          hint="Stop options"
          items={[
            // A point is not a waypoint: it has no place of its own to edit.
            ...(stop.waypointId === null
              ? []
              : [{ label: 'Edit the Place…', onSelect: () => useCompanionStore.getState().edit({ kind: 'waypoint', id: stop.waypointId as string }) }]),
            {
              label: 'Take Out of the Plan',
              separatorBefore: stop.waypointId !== null,
              onSelect: () => void run(() => call(api().itinerary.removeStop({ id: stop.id })), 'Taken out of the plan. The waypoint stays in the trip.'),
            },
          ]}
        />
      </DetailsHeading>

      {hasStay && (
        <section aria-label="Stay" className="mt-3">
          <DurationEditor key={`${stop.id}:${stop.updatedAt}`} stop={stop} onChange={update} onDraft={setDraft} />
          {consequence !== null && (
            <p data-testid="consequence" role="status" className="mt-2 rounded-xl bg-[var(--color-accent)]/10 px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
              {consequenceText(consequence)}
            </p>
          )}
        </section>
      )}

      <StopTimes stop={stop} isFirst={index === 0} isLast={isLast} />
      <StopFlags timed={timed} zone={timed?.zone ?? ''} />

      <SectionLabel>Notes for this stop</SectionLabel>
      <NotesField key={`${stop.id}:notes:${stop.updatedAt}`} stop={stop} onCommit={(notes) => update({ id: stop.id, notes })} />

      <SectionLabel aside={near > 0 ? String(near) : undefined}>Photos taken here</SectionLabel>
      <p className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
        <Camera size={14} aria-hidden="true" style={{ color: KIND_COLOUR.photo }} />
        {near === 0 ? 'None within a kilometre.' : `${near} within a kilometre, shown on the map.`}
      </p>
    </div>
  );
}
