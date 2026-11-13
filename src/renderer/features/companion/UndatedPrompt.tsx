import { Pencil, Route as RouteIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RouteWithPoints } from '@shared/domain/types';
import { estimateDurationSeconds, formatDistance, formatDuration } from '@shared/geo/units';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { api, call } from '../../lib/client';
import { useGeometryStore } from '../../stores/geometryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { runPlanChange } from '../itinerary/ItinerarySection';
import { tomorrow } from '../itinerary/viewModel';
import { KIND_COLOUR, SectionLabel } from './parts';

/**
 * A trip with no dates (Requirement 4.8, view 9). It asks when the trip is
 * and says what a date will give. Until then drives are measured, never
 * timed: nothing here has a time.
 */

const NO_ROUTES: RouteWithPoints[] = [];
const FIELD = 'w-full rounded-md border-0 bg-[var(--color-surface-sunken)] px-2.5 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]';

export function UndatedPrompt({ tripId, onEdit }: { tripId: string; onEdit: () => void }): ReactNode {
  const routes = useGeometryStore((s) => (s.tripId === tripId ? (s.geometry?.routes ?? NO_ROUTES) : NO_ROUTES));
  const units = useSettingsStore((s) => s.settings.units);
  const speed = useSettingsStore((s) => s.settings.planningSpeedKmh);
  const selected = useSelectionStore((s) => s.selected);
  const [date, setDate] = useState(tomorrow());
  const [time, setTime] = useState('09:00');

  return (
    <div data-testid="undated-prompt">
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-[18px] font-semibold text-[var(--color-text-primary)]">When is it?</h2>
        <IconButton variant="ghost" hint="Edit the trip" onClick={onEdit}>
          <Pencil size={15} aria-hidden="true" />
        </IconButton>
      </div>
      <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
        This side of the window shows time. With a start date, the trip appears here by the hour.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-[12px] text-[var(--color-text-muted)]">
          Start date
          <input type="date" aria-label="Start date" value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${FIELD}`} />
        </label>
        <label className="text-[12px] text-[var(--color-text-muted)]">
          Leave at
          <input type="time" aria-label="Start time" value={time} onChange={(e) => setTime(e.target.value)} className={`mt-1 ${FIELD}`} />
        </label>
      </div>
      <Button
        variant="primary"
        className="mt-4 px-8"
        disabled={date === '' || time === ''}
        onClick={() => void runPlanChange(() => call(api().itinerary.create({ tripId, startDate: date, startTime: time })))}
      >
        Plan by date
      </Button>

      <div className="mt-6 h-px bg-[var(--color-border-subtle)]" />
      <SectionLabel>Until then</SectionLabel>
      <p className="text-[13px] text-[var(--color-text-secondary)]">Stops can be ordered without dates, and drives are measured, but not timed.</p>
      <div className="mt-3 flex flex-col gap-2">
        {routes.map((route) => {
          const estimate = estimateDurationSeconds(route.distanceM, speed);
          const detail = [
            route.distanceM === null ? 'length unknown' : formatDistance(route.distanceM, units),
            estimate === null ? null : `about ${formatDuration(estimate)} at ${speed} km/h`,
          ].filter((x) => x !== null);
          const chosen = selected?.kind === 'route' && selected.id === route.id;
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => void useSelectionStore.getState().select({ kind: 'route', id: route.id })}
              className={`flex items-start gap-2 rounded-xl bg-[var(--color-surface-sunken)] p-3 text-left ${chosen ? 'outline-2 outline-[var(--color-accent)]' : ''}`}
            >
              <RouteIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: KIND_COLOUR.route }} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{route.name}</span>
                <span className="block truncate text-[12px] text-[var(--color-text-muted)]">{detail.join(' · ')}</span>
              </span>
            </button>
          );
        })}
        {routes.length === 0 && <p className="text-[12px] text-[var(--color-text-muted)]">No routes in this trip yet.</p>}
      </div>
    </div>
  );
}
