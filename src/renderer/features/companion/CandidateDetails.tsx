import { Activity, Map as MapIcon, MapPin, Plus, Route as RouteIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { haversineDistance, type LatLon } from '@shared/geo/distance';
import { formatDistance } from '@shared/geo/units';
import { isNear, routeFit } from '@shared/itinerary/routeFit';
import { Button } from '../../components/Button';
import { useItineraryStore } from '../../stores/itineraryStore';
import { usePlanStore, type Candidate, type Elsewhere } from '../../stores/planStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { addCandidate } from '../library/planActions';
import { DetailsHeading, KIND_COLOUR, Note, SectionLabel } from './parts';

/**
 * What adding the highlighted result would do, before it is added (Phase 14
 * Requirements 11.4 and 12, design §4.9 and §5.5). Distances to a place are
 * straight lines until the drive is planned, and say so; a time is an
 * estimate at the planning speed. Nothing is joined without asking: a route
 * whose ends are not at the stops offers its ends as stops instead.
 */

function icon(candidate: Candidate): ReactNode {
  const props = { size: 18, 'aria-hidden': true } as const;
  switch (candidate.kind) {
    case 'waypoint':
      return <MapPin {...props} style={{ color: KIND_COLOUR.waypoint }} />;
    case 'route':
      return <RouteIcon {...props} style={{ color: KIND_COLOUR.route }} />;
    case 'track':
      return <Activity {...props} style={{ color: KIND_COLOUR.track }} />;
    default:
      return <MapIcon {...props} className="text-[var(--color-text-secondary)]" />;
  }
}

function where(candidate: Candidate): string {
  if (candidate.kind === 'place') return candidate.detail ?? 'A place';
  const kind = candidate.kind === 'waypoint' ? 'Waypoint' : candidate.kind === 'route' ? 'Route' : 'Track';
  if (candidate.from === null) return `${kind} in this trip`;
  return candidate.from.loose ? `${kind}, not in a trip` : `${kind} in ${candidate.from.tripName}`;
}

/** Copy (the default) or move, for something in another trip (Requirement 12.6). */
function TransferChoice({ from, canCopy }: { from: Elsewhere | null; canCopy: boolean }): ReactNode {
  const transfer = usePlanStore((s) => s.transfer);
  if (from === null) return null;
  if (from.loose) return <Note>It moves into this trip from Not in a trip.</Note>;
  if (!canCopy) return <Note>It moves here from {from.tripName}: a recorded track is moved, not copied.</Note>;
  return (
    <fieldset className="mt-3 grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
      <legend className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">It is in {from.tripName}</legend>
      <label className="flex items-center gap-2">
        <input type="radio" name="transfer" checked={transfer === 'copy'} onChange={() => usePlanStore.getState().setTransfer('copy')} />
        Copy it here, and leave it in {from.tripName}
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name="transfer" checked={transfer === 'move'} onChange={() => usePlanStore.getState().setTransfer('move')} />
        Move it here
      </label>
    </fieldset>
  );
}

export function CandidateDetails(): ReactNode {
  const candidate = usePlanStore((s) => s.candidate);
  const adding = usePlanStore((s) => s.adding);
  const view = useItineraryStore((s) => s.view);
  const units = useSettingsStore((s) => s.settings.units);
  const speed = useSettingsStore((s) => s.settings.planningSpeedKmh);
  if (candidate === null || adding === null || view === null) return null;

  const before = view.stops[adding.index - 1]?.placeOut ?? null;
  const after = view.stops[adding.index]?.place ?? null;
  const crowFlies = (at: LatLon, from: { lat: number; lon: number; name: string }): string => {
    const m = haversineDistance(from, at);
    return `${formatDistance(m, units)} as the crow flies from ${from.name}, about ${Math.round((m / 1000 / speed) * 60)} min at ${speed} km/h`;
  };

  let body: ReactNode;
  if (candidate.kind === 'waypoint' || candidate.kind === 'place') {
    body = (
      <>
        <SectionLabel>{before === null ? 'As the first stop' : `If you stop here after ${before.name}`}</SectionLabel>
        <ul className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
          {before !== null && <li>{crowFlies(candidate, before)}</li>}
          {after !== null && <li>{crowFlies(candidate, after)}, on to {after.name}</li>}
        </ul>
        {candidate.kind === 'waypoint' && <TransferChoice from={candidate.from} canCopy />}
        <div className="mt-3">
          <Button variant="primary" onClick={() => void addCandidate()}>
            <Plus size={14} aria-hidden="true" /> {before === null ? 'Add as the first stop' : `Add after ${before.name}`}
          </Button>
        </div>
        {candidate.kind === 'place' && <Note>A place or postcode becomes a waypoint in the trip when it is added.</Note>}
      </>
    );
  } else if (candidate.kind === 'route') {
    // Requirement 14: a route is an entry of its own. Where its ends are not
    // at the entries beside it, a drive by road joins them.
    const fit = candidate.ends === null ? null : routeFit(candidate.ends, before, after);
    const lines: string[] = [];
    if (fit !== null) {
      if (before === null) lines.push('It starts the plan.');
      else if (isNear(fit.startM)) lines.push(`It starts at ${before.name}.`);
      else lines.push(`It starts ${formatDistance(fit.startM ?? 0, units)} from ${before.name}; a drive by road joins them.`);
      if (after === null) lines.push('It ends the plan.');
      else if (isNear(fit.endM)) lines.push(`${after.name} is where it ends.`);
      else lines.push(`It ends ${formatDistance(fit.endM ?? 0, units)} from ${after.name}; a drive by road joins them.`);
    }
    body = (
      <>
        <SectionLabel>{before === null ? 'As the start of the plan' : `After ${before.name}`}</SectionLabel>
        {fit === null ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">Reading its line…</p>
        ) : (
          <ul className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]" data-testid="route-fit">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <TransferChoice from={candidate.from} canCopy />
        <div className="mt-3">
          <Button variant="primary" onClick={() => void addCandidate()}>
            <Plus size={14} aria-hidden="true" /> Put it in the plan
          </Button>
        </div>
        <Note>A route is an entry of its own in the plan: drag it to put it anywhere.</Note>
      </>
    );
  } else {
    body = (
      <>
        <SectionLabel>A recorded track</SectionLabel>
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          {candidate.startedAt === null
            ? 'It has no times, so it cannot be placed on a day. It will be in the trip, not in the plan.'
            : 'It is never a stop. In this trip, it is placed on the day and at the hour it was recorded.'}
        </p>
        <TransferChoice from={candidate.from} canCopy={false} />
        {candidate.from !== null && (
          <div className="mt-3">
            <Button variant="primary" onClick={() => void addCandidate()}>
              <Plus size={14} aria-hidden="true" /> Move it into this trip
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div data-testid="candidate-details">
      <DetailsHeading icon={icon(candidate)} title={candidate.name} sub={where(candidate)} />
      {body}
    </div>
  );
}
