import { Route as RouteIcon, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Route } from '@shared/domain/types';
import { formatDistance } from '@shared/geo/units';
import { Button } from '../../components/Button';
import { api, call } from '../../lib/client';
import { useCompanionStore } from '../../stores/companionStore';
import { useGeometryStore } from '../../stores/geometryStore';
import { useItineraryStore } from '../../stores/itineraryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { LegRow, run } from '../itinerary/ItinerarySection';
import { RoadSummary } from '../properties/roadData';
import { climb } from './ObjectCard';
import { DetailsHeading, KIND_COLOUR, OptionsMenu, SectionLabel } from './parts';

/**
 * The right panel for a drive (Phase 14 Requirement 4.5, design §4.8): the
 * route arriving at a stop. How it is travelled is the field; its height and
 * roads are the route's, and places on the way can be added as stops.
 */

const NO_ROUTES: readonly Route[] = [];

/**
 * A route placed in the plan as an entry of its own (Requirement 14): what
 * joins it to the entries either side, its roads, and taking it out.
 */
function RouteEntry({ stopId }: { stopId: string }): ReactNode {
  const view = useItineraryStore((s) => s.view);
  const route = useSelectionStore((s) => s.route);
  const units = useSettingsStore((s) => s.settings.units);
  const openPoiPanel = useUiStore((s) => s.openPoiPanel);
  const index = view?.stops.findIndex((s) => s.id === stopId) ?? -1;
  const entry = index < 0 ? undefined : view?.stops[index];
  if (view === null || entry === undefined) return null;
  // Day breaks are not places: the neighbours are the entries either side of them.
  const before = view.stops.slice(0, index).findLast((s) => s.kind !== 'day');
  const after = view.stops.slice(index + 1).find((s) => s.kind !== 'day');
  const routeId = entry.entryRouteId;
  const shown = route !== null && route.id === routeId ? route : null;
  const name = entry.drive?.name ?? 'Route deleted';
  const joins: string[] = [
    before === undefined
      ? 'It starts the plan.'
      : entry.joined
        ? `It starts where ${before.place?.name ?? 'the entry before'} ${before.kind === 'route' ? 'ends' : 'is'}.`
        : `A drive by road joins it from ${before.placeOut?.name ?? 'the entry before'}.`,
    after === undefined
      ? 'It ends the plan.'
      : after.joined
        ? `${after.place?.name ?? 'The next entry'} starts where it ends.`
        : `A drive by road joins it to ${after.place?.name ?? 'the next entry'}.`,
  ];

  return (
    <div data-testid="drive-details">
      <DetailsHeading
        icon={<RouteIcon size={18} aria-hidden="true" style={{ color: KIND_COLOUR.route }} />}
        title={name}
        sub={['In the plan', entry.drive?.distanceM == null ? null : formatDistance(entry.drive.distanceM, units)].filter(Boolean).join(' · ')}
      >
        <OptionsMenu
          hint="Drive options"
          items={[
            ...(routeId === null ? [] : [{ label: 'Edit the Route…', onSelect: () => useCompanionStore.getState().edit({ kind: 'route', id: routeId }) }]),
            {
              label: 'Take Out of the Plan',
              separatorBefore: routeId !== null,
              onSelect: () => void run(() => call(api().itinerary.removeStop({ id: entry.id })), `${name} taken out of the plan. It stays in the trip.`),
            },
          ]}
        />
      </DetailsHeading>
      <ul className="mt-3 grid gap-1 text-[12px] text-[var(--color-text-secondary)]" data-testid="entry-joins">
        {joins.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {shown !== null && (
        <>
          <SectionLabel>Roads</SectionLabel>
          <RoadSummary ownerType="route" ownerId={shown.id} units={units} pointCount={shown.points.length} />
          <Button onClick={() => openPoiPanel({ kind: 'route', routeId: shown.id })}>
            <Search size={14} aria-hidden="true" /> Places on the way
          </Button>
        </>
      )}
    </div>
  );
}

export function DriveDetails({ stopId }: { stopId: string }): ReactNode {
  const view = useItineraryStore((s) => s.view);
  const routes = useGeometryStore((s) => s.geometry?.routes ?? NO_ROUTES);
  const route = useSelectionStore((s) => s.route);
  const units = useSettingsStore((s) => s.settings.units);
  const openPoiPanel = useUiStore((s) => s.openPoiPanel);

  const index = view?.stops.findIndex((s) => s.id === stopId) ?? -1;
  const stop = index < 0 ? undefined : view?.stops[index];
  const from = index > 0 ? view?.stops.slice(0, index).findLast((s) => s.kind !== 'day') : undefined;
  if (view === null || stop === undefined) return null;
  if (stop.kind === 'route') return <RouteEntry stopId={stopId} />;
  const routeId = stop.legRouteId;
  const shown = route !== null && route.id === routeId ? route : null;

  return (
    <div data-testid="drive-details">
      <DetailsHeading
        icon={<RouteIcon size={18} aria-hidden="true" style={{ color: KIND_COLOUR.route }} />}
        title={`${from?.place?.name ?? 'Previous stop'} → ${stop.place?.name ?? 'Next stop'}`}
        sub={[`Drive ${index}`, shown?.distanceM == null ? null : formatDistance(shown.distanceM, units), shown === null ? null : climb(shown.elevGainM, shown.elevLossM, units)]
          .filter(Boolean)
          .join(' · ')}
      >
        <OptionsMenu
          hint="Drive options"
          items={[
            ...(routeId === null ? [] : [{ label: 'Edit the Route…', onSelect: () => useCompanionStore.getState().edit({ kind: 'route', id: routeId }) }]),
            ...(stop.legMode === 'route'
              ? [
                  {
                    label: 'Take Out of the Plan',
                    separatorBefore: true,
                    onSelect: () =>
                      void run(() => call(api().itinerary.setLegMode({ id: stop.id, mode: 'road' })), 'The drive is planned by road again. The route stays in the trip.'),
                  },
                ]
              : []),
          ]}
        />
      </DetailsHeading>

      <SectionLabel>How</SectionLabel>
      <LegRow stop={stop} timed={view.timeline.stops[index]} routes={routes} units={units} />

      {shown !== null && (
        <>
          <SectionLabel>Roads</SectionLabel>
          <RoadSummary ownerType="route" ownerId={shown.id} units={units} pointCount={shown.points.length} />
          <Button onClick={() => openPoiPanel({ kind: 'route', routeId: shown.id })}>
            <Search size={14} aria-hidden="true" /> Places on the way
          </Button>
        </>
      )}
    </div>
  );
}
