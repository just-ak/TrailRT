import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ItineraryView } from '@shared/domain/itinerary';
import type { RouteWithPoints } from '@shared/domain/types';
import { formatDistance } from '@shared/geo/units';
import { isNear, routeFit } from '@shared/itinerary/routeFit';
import { Button } from '../../components/Button';
import { api, call, callOr, describeError } from '../../lib/client';
import { useGeometryStore } from '../../stores/geometryStore';
import { useItineraryStore } from '../../stores/itineraryStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useNavStore } from '../../stores/navStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { SectionLabel } from './parts';

/**
 * Put it in a plan (Phase 14 Requirement 12.5, design §5.5): a route made on
 * its own goes into a trip's plan from its own details. Choose the trip and
 * the stop it follows; the panel says whether it joins the next stop before
 * anything is changed.
 */

const SELECT =
  'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[12.5px] text-[var(--color-text-primary)]';

async function put(route: RouteWithPoints, tripId: string, index: number, transfer: 'move' | 'copy' | undefined): Promise<void> {
  try {
    const out = await call(api().itinerary.addRouteLeg({ tripId, routeId: route.id, index, ...(transfer === undefined ? {} : { transfer }) }));
    await useLibraryStore.getState().refresh();
    useNavStore.getState().openTrip(tripId);
    await useSelectionStore.getState().select({ kind: 'route', id: out.routeId });
    await Promise.all([useGeometryStore.getState().reload(), useItineraryStore.getState().reload()]);
    useUiStore.getState().showToast(`${route.name} is in the plan.`);
  } catch (cause) {
    useUiStore.getState().showToast(describeError(cause), 'error');
  }
}

export function PutInPlan({ route }: { route: RouteWithPoints }): ReactNode {
  const overview = useLibraryStore((s) => s.overview);
  const trips = useMemo(() => overview.filter((t) => t.startDate !== null), [overview]);
  const looseTripId = useLibraryStore((s) => s.looseTripId);
  const units = useSettingsStore((s) => s.settings.units);
  const [tripId, setTripId] = useState('');
  const [after, setAfter] = useState(0);
  const [transfer, setTransfer] = useState<'move' | 'copy'>('copy');
  const [plan, setPlan] = useState<ItineraryView | null>(null);

  useEffect(() => {
    if (tripId === '') return;
    void callOr(api().itinerary.get({ tripId }), null).then((view) => setPlan(view));
  }, [tripId]);

  if (trips.length === 0) return null;
  const first = route.points[0];
  const last = route.points.at(-1);
  const stops = plan !== null && plan.itinerary.tripId === tripId ? plan.stops : [];
  // `after` is the stop index the route follows; -1 is the start of the plan.
  const at = Math.min(after, stops.length - 1);
  const before = at < 0 ? null : (stops[at]?.placeOut ?? null);
  const next = stops[at + 1]?.place ?? null;
  const fit = first === undefined || last === undefined ? null : routeFit({ start: first, end: last }, before, next);
  const elsewhere = tripId !== '' && route.tripId !== tripId && route.tripId !== looseTripId;
  const how = elsewhere ? transfer : undefined;
  const says: string[] = [];
  if (fit !== null && tripId !== '' && plan !== null) {
    if (before === null) says.push('It starts the plan.');
    else says.push(isNear(fit.startM) ? `It starts at ${before.name}.` : `It starts ${formatDistance(fit.startM ?? 0, units)} from ${before.name}; a drive by road joins them.`);
    if (next === null) says.push('It ends the plan.');
    else says.push(isNear(fit.endM) ? `${next.name} is where it ends.` : `It ends ${formatDistance(fit.endM ?? 0, units)} from ${next.name}; a drive by road joins them.`);
  }

  return (
    <section aria-label="Put it in a plan" className="mt-3 grid gap-2 rounded-xl bg-[var(--color-surface-sunken)] p-3 text-[12px]" data-testid="put-in-plan">
      <SectionLabel>Put it in a plan</SectionLabel>
      <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
        Trip
        <select aria-label="Trip to put it in" value={tripId} onChange={(e) => (setTripId(e.target.value), setAfter(0))} className={SELECT}>
          <option value="">Choose a trip…</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {tripId !== '' && plan !== null && (
        <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
          After
          <select aria-label="Stop it follows" value={at} onChange={(e) => setAfter(Number(e.target.value))} className={SELECT}>
            <option value={-1}>The start of the plan</option>
            {stops.map((s, i) => (
              <option key={s.id} value={i}>
                {s.place?.name ?? 'Place deleted'}
              </option>
            ))}
          </select>
        </label>
      )}
      {elsewhere && (
        <div className="grid gap-1 text-[var(--color-text-secondary)]">
          <label className="flex items-center gap-2">
            <input type="radio" name="put-transfer" checked={transfer === 'copy'} onChange={() => setTransfer('copy')} />
            Copy it there, and keep this one
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="put-transfer" checked={transfer === 'move'} onChange={() => setTransfer('move')} />
            Move it there
          </label>
        </div>
      )}
      {says.length > 0 && (
        <>
          <ul className="grid gap-0.5 text-[var(--color-text-secondary)]" data-testid="put-fit">
            {says.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Button variant="primary" onClick={() => void put(route, tripId, at + 1, how)}>
            <Plus size={14} aria-hidden="true" /> Put it in the plan
          </Button>
        </>
      )}
    </section>
  );
}
