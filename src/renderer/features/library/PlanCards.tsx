import { Activity, CalendarMinus, CalendarPlus, Dot, GripVertical, MapPin, Plus, Route as RouteIcon, Search, TrainFront, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ItineraryView } from '@shared/domain/itinerary';
import type { Photo } from '@shared/domain/linkedFolders';
import type { TripGeometry } from '@shared/domain/types';
import { dayCards, durationText, type DayCard, type DayRow } from '@shared/itinerary/dayCards';
import { addIndex, moveTarget, rowStopId } from '@shared/itinerary/planEdit';
import type { RouteWithTrip, TrackWithTrip, WaypointWithTrip } from '@shared/ipc/api';
import type { SearchResult } from '@shared/search/PlaceSearchProvider';
import { dayPhotoText } from '@shared/photos/library';
import { api, callOr } from '../../lib/client';
import { useLibraryStore } from '../../stores/libraryStore';
import { usePlanStore, type Candidate } from '../../stores/planStore';
import { refKey, useSelectionStore } from '../../stores/selectionStore';
import { KIND_COLOUR } from '../companion/parts';
import { photosByDay } from './libraryRoots';
import { addCandidate, addDay, addWaypointStop, deleteItem, deleteTrack, dropRoute, moveOutOfTrip, moveStop, removeDay, removeStop } from './planActions';
import { ContextMenu, type MenuItem } from '../../components/ContextMenu';

/**
 * A dated trip's Plan tab, drawn as the day cards of the drawings (Phase 14
 * Requirement 10.2 and 11, design §4.9). The left panel holds the plan's
 * structure, so its changes are made here: select a row, drag a stop to
 * reorder it, × to take it out, and Add in each day. Details are on the right.
 */

const STOP_MIME = 'application/x-trailrt-stop';
const WAYPOINT_MIME = 'application/x-trailrt-waypoint';
const ROUTE_MIME = 'application/x-trailrt-route';
/** Where the place search ranks from when the plan has no stops yet: the project's test geography. */
const FALLBACK_FOCUS = { lat: 53.26, lon: -1.91 };

function RowIcon({ row }: { row: DayRow }): ReactNode {
  const props = { size: 14, 'aria-hidden': true } as const;
  switch (row.kind) {
    case 'stop':
      return <MapPin {...props} style={{ color: KIND_COLOUR.waypoint }} />;
    case 'drive':
      return <RouteIcon {...props} style={{ color: KIND_COLOUR.route }} />;
    case 'point':
      return <Dot {...props} strokeWidth={6} className="text-[var(--color-text-muted)]" />;
    case 'leg':
      return <RouteIcon {...props} style={{ color: KIND_COLOUR.route }} />;
    case 'unplanned':
      return <RouteIcon {...props} className="text-[var(--color-text-muted)]" />;
    case 'track':
      return <Activity {...props} style={{ color: KIND_COLOUR.track }} />;
    case 'other':
      return <TrainFront {...props} className="text-[var(--color-text-secondary)]" />;
    default:
      return <TriangleAlert {...props} className="text-[var(--color-danger)]" />;
  }
}

/**
 * The plan entry being dragged, for the drop to know which way it is going:
 * the data itself cannot be read until the drop.
 */
let draggingIndex: number | null = null;

function carries(event: React.DragEvent): boolean {
  const types = event.dataTransfer.types;
  return types.includes(STOP_MIME) || types.includes(WAYPOINT_MIME) || types.includes(ROUTE_MIME);
}

/**
 * What a drop at `at` does (Requirement 14.1 and 14.2): an entry of the plan
 * moves there; a waypoint or a route from Not in the plan goes in there.
 */
function dropInto(event: React.DragEvent, tripId: string, stopIndex: ReadonlyMap<string, number>, at: number): void {
  const moving = event.dataTransfer.getData(STOP_MIME);
  if (moving !== '') {
    const from = stopIndex.get(moving);
    const to = from === undefined ? null : moveTarget(from, at);
    if (to !== null) moveStop(moving, to);
    return;
  }
  const waypoint = event.dataTransfer.getData(WAYPOINT_MIME);
  if (waypoint !== '') addWaypointStop(tripId, waypoint, at);
  const route = event.dataTransfer.getData(ROUTE_MIME);
  if (route !== '') void dropRoute(tripId, route, at);
}

interface RowProps {
  row: DayRow;
  stopIndex: Map<string, number>;
  selectedKey: string | null;
  focusedLeg: string | null;
  focusedStop: string | null;
  tripId: string;
  dropBefore: number | null;
  setDropBefore: (index: number | null) => void;
  onMenu: (event: React.MouseEvent, row: DayRow, stopId: string | null) => void;
}

/**
 * The index a drop on this row means. An entry of the plan dropped on
 * another entry takes its place, so a swap within a day is one drag in
 * either direction (Requirement 16.3). Anything else goes before the row, or
 * after it in its lower half.
 */
function dropIndexFor(row: DayRow, stopIndex: Map<string, number>, lowerHalf: boolean): number | null {
  const target = rowStopId(row.key);
  if (target === null) return null;
  const index = stopIndex.get(target.stopId);
  if (index === undefined) return null;
  if (target.kind === 'stop' && draggingIndex !== null) return draggingIndex < index ? index + 1 : index;
  return target.kind === 'stop' && lowerHalf ? index + 1 : index;
}

function PlanRow({ row, stopIndex, selectedKey, focusedLeg, focusedStop, tripId, dropBefore, setDropBefore, onMenu }: RowProps): ReactNode {
  const target = rowStopId(row.key);
  const isStop = target?.kind === 'stop';
  const index = target === null ? undefined : stopIndex.get(target.stopId);
  const selected =
    (row.ref !== null && refKey(row.ref) === selectedKey) ||
    (row.ref === null && target !== null && (target.kind === 'leg' ? focusedLeg : focusedStop) === target.stopId);
  const lineBefore = index !== undefined && dropBefore === index && (target?.kind === 'leg' || isStop);

  const select = (): void => {
    if (row.ref !== null) {
      void useSelectionStore.getState().select(row.ref);
      return;
    }
    // A drive with no route has nothing of its own to select. Its trip is
    // selected, which keeps the plan on the map, and the companion shows the
    // drive from the plan's focus.
    if (target !== null) {
      void useSelectionStore.getState().select({ kind: 'trip', id: tripId });
      if (target.kind === 'leg') usePlanStore.getState().focusLeg(target.stopId);
      else usePlanStore.getState().focusStop(target.stopId);
    }
  };

  return (
    <div
      className="relative"
      onDragOver={(event) => {
        if (!carries(event)) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const at = dropIndexFor(row, stopIndex, event.clientY > rect.top + rect.height / 2);
        if (at === null) return;
        event.preventDefault();
        setDropBefore(at);
      }}
      onDrop={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const at = dropIndexFor(row, stopIndex, event.clientY > rect.top + rect.height / 2);
        setDropBefore(null);
        if (at === null) return;
        event.preventDefault();
        event.stopPropagation();
        dropInto(event, tripId, stopIndex, at);
      }}
    >
      {lineBefore && <div aria-hidden="true" className="absolute -top-px right-2 left-2 h-0.5 rounded bg-[var(--color-accent)]" />}
      <button
        type="button"
        data-testid={row.kind === 'drive' ? 'plan-drive' : isStop ? 'plan-stop' : target?.kind === 'leg' ? 'plan-leg' : 'plan-row'}
        aria-label={row.name}
        aria-pressed={selected}
        draggable={isStop}
        onDragStart={(event) => {
          if (target === null) return;
          event.dataTransfer.setData(STOP_MIME, target.stopId);
          event.dataTransfer.effectAllowed = 'move';
          draggingIndex = index ?? null;
        }}
        onDragEnd={() => {
          draggingIndex = null;
          setDropBefore(null);
        }}
        onContextMenu={(event) => {
          if (!isStop || target === null) return;
          event.preventDefault();
          onMenu(event, row, target.stopId);
        }}
        onClick={select}
        onKeyDown={(event) => {
          // Reordering without a pointer (Requirement 11.5).
          if (!isStop || !event.altKey || index === undefined || target === null) return;
          if (event.key === 'ArrowUp' && index > 0) {
            event.preventDefault();
            moveStop(target.stopId, index - 1);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveStop(target.stopId, index + 1);
          }
        }}
        className={`group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] ${
          selected ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]'
        }`}
      >
        {isStop ? (
          <GripVertical size={12} aria-hidden="true" className={`-ml-1 shrink-0 ${selected ? 'text-white/70' : 'text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100'}`} />
        ) : (
          <span className="-ml-1 w-3 shrink-0" />
        )}
        <span className={selected ? '[&_svg]:!text-white' : ''}>
          <RowIcon row={row} />
        </span>
        <span className="min-w-0 flex-1 truncate">{row.name}</span>
        <span className={`shrink-0 text-[11px] ${selected ? 'text-white/80' : 'text-[var(--color-text-muted)]'}`}>{row.time}</span>
      </button>
      {isStop && target !== null && (
        <button
          type="button"
          aria-label={`Take ${row.name} out of the plan`}
          title="Take out of the plan"
          onClick={() => removeStop(target.stopId, row.name)}
          className={`absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded ${
            selected ? 'bg-[var(--color-accent)] text-white' : 'hidden bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)]'
          }`}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface Hit {
  key: string;
  group: string;
  candidate: Candidate;
  detail: string;
}

/**
 * Add, opened in a day card: one search over the trip's waypoints and the
 * offline places and postcodes. The highlighted result is shown on the right
 * before it is added (Requirement 11.4).
 */
/** Everything outside this trip that Add can bring in (Requirement 12.1). */
interface Elsewhere {
  routes: readonly RouteWithTrip[];
  waypoints: readonly WaypointWithTrip[];
  tracks: readonly TrackWithTrip[];
}

const NOTHING_ELSEWHERE: Elsewhere = { routes: [], waypoints: [], tracks: [] };

function fromOf(item: { tripId: string; tripName: string }, looseTripId: string | null): { tripId: string; tripName: string; loose: boolean } {
  const loose = item.tripId === looseTripId;
  return { tripId: item.tripId, tripName: loose ? 'Not in a trip' : item.tripName, loose };
}

/** The search's groups, in order: this trip, outside any trip, other trips, then places. */
function findHits(
  q: string,
  tripId: string,
  geometry: TripGeometry | null,
  elsewhere: Elsewhere,
  looseTripId: string | null,
  places: readonly SearchResult[],
): Hit[] {
  if (q === '') return [];
  const has = (name: string) => name.toLowerCase().includes(q);
  const here: Hit[] = [
    ...(geometry?.waypoints ?? [])
      .filter((w) => has(w.name))
      .slice(0, 6)
      .map<Hit>((w) => ({ key: `w:${w.id}`, group: 'In this trip', detail: 'waypoint', candidate: { kind: 'waypoint', id: w.id, name: w.name, lat: w.lat, lon: w.lon, from: null } })),
    ...(geometry?.routes ?? [])
      .filter((r) => has(r.name))
      .slice(0, 4)
      .map<Hit>((r) => ({ key: `r:${r.id}`, group: 'In this trip', detail: 'route', candidate: { kind: 'route', id: r.id, name: r.name, distanceM: r.distanceM, from: null, ends: null } })),
  ];
  const outside: Hit[] = [
    ...elsewhere.routes
      .filter((r) => r.tripId !== tripId && has(r.name))
      .map<Hit>((r) => {
        const from = fromOf(r, looseTripId);
        return { key: `r:${r.id}`, group: from.loose ? 'Not in a trip' : 'Other trips', detail: from.loose ? 'route' : `route · ${from.tripName}`, candidate: { kind: 'route', id: r.id, name: r.name, distanceM: r.distanceM, from, ends: null } };
      }),
    ...elsewhere.waypoints
      .filter((w) => w.tripId !== tripId && has(w.name))
      .map<Hit>((w) => {
        const from = fromOf(w, looseTripId);
        return { key: `w:${w.id}`, group: from.loose ? 'Not in a trip' : 'Other trips', detail: from.loose ? 'waypoint' : `waypoint · ${from.tripName}`, candidate: { kind: 'waypoint', id: w.id, name: w.name, lat: w.lat, lon: w.lon, from } };
      }),
    ...elsewhere.tracks
      .filter((t) => t.tripId !== tripId && has(t.name))
      .map<Hit>((t) => {
        const from = fromOf(t, looseTripId);
        return { key: `t:${t.id}`, group: from.loose ? 'Not in a trip' : 'Other trips', detail: from.loose ? 'track' : `track · ${from.tripName}`, candidate: { kind: 'track', id: t.id, name: t.name, startedAt: t.startedAt, from } };
      }),
  ];
  const rank = (h: Hit) => (h.group === 'Not in a trip' ? 0 : 1);
  const found = places.map<Hit>((p) => ({
    key: `p:${p.key}`,
    group: 'Places',
    detail: p.detail ?? p.kind,
    candidate: { kind: 'place', name: p.label, detail: p.detail, lat: p.lat, lon: p.lon },
  }));
  return [...here, ...outside.toSorted((a, b) => rank(a) - rank(b)).slice(0, 8), ...found];
}

/** A route's list row carries no line; its ends are fetched when it is highlighted, to judge the fit. */
function fetchEnds(candidate: Candidate | null): void {
  if (candidate?.kind !== 'route' || candidate.ends !== null) return;
  void callOr(api().routes.get({ id: candidate.id }), null).then((route) => {
    const first = route?.points[0];
    const last = route?.points.at(-1);
    const current = usePlanStore.getState().candidate;
    if (first === undefined || last === undefined || current?.kind !== 'route' || current.id !== candidate.id) return;
    usePlanStore.getState().setCandidate({ ...current, ends: { start: first, end: last } });
  });
}

/** Return adds what is highlighted. A route goes in whatever its ends (Requirement 13.4). */
function enterCandidate(): void {
  void addCandidate();
}

function AddSearch({ tripId, geometry, focus }: { tripId: string; geometry: TripGeometry | null; focus: { lat: number; lon: number } }): ReactNode {
  const [text, setText] = useState('');
  const [places, setPlaces] = useState<SearchResult[]>([]);
  const [elsewhere, setElsewhere] = useState<Elsewhere>(NOTHING_ELSEWHERE);
  const looseTripId = useLibraryStore((s) => s.looseTripId);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
    void Promise.all([
      callOr(api().routes.listAll(), []),
      callOr(api().waypoints.listAll(), []),
      callOr(api().tracks.listAll(), []),
    ]).then(([routes, waypoints, tracks]) => setElsewhere({ routes, waypoints, tracks }));
    return () => clearTimeout(timer.current);
  }, []);

  const hits = useMemo(
    () => findHits(text.trim().toLowerCase(), tripId, geometry, elsewhere, looseTripId, places),
    [text, tripId, geometry, elsewhere, looseTripId, places],
  );

  const highlight = (index: number, list: readonly Hit[] = hits): void => {
    setActive(index);
    const next = list[index]?.candidate ?? null;
    usePlanStore.getState().setCandidate(next);
    fetchEnds(next);
  };

  const ask = (value: string): void => {
    setText(value);
    setActive(0);
    clearTimeout(timer.current);
    if (value.trim() === '') {
      setPlaces([]);
      usePlanStore.getState().setCandidate(null);
      return;
    }
    timer.current = setTimeout(() => {
      void callOr(api().search.query({ text: value, lat: focus.lat, lon: focus.lon, limit: 6 }), null).then((answer) => {
        setPlaces(answer?.results ?? []);
      });
    }, 200);
  };

  // The first result is the candidate as results arrive, so Return adds it
  // and the right panel already shows what it would do.
  useEffect(() => {
    const plan = usePlanStore.getState();
    if (hits.length > 0 && plan.candidate === null) {
      const first = hits[0]?.candidate ?? null;
      plan.setCandidate(first);
      fetchEnds(first);
    }
  }, [hits]);

  return (
    <div className="relative px-1 py-1" data-testid="add-search">
      <label className="flex h-7 items-center gap-2 rounded-md border border-[var(--color-accent)] bg-[var(--color-surface)] px-2">
        <Search size={13} aria-hidden="true" className="text-[var(--color-accent)]" />
        <input
          ref={input}
          aria-label="Find a stop"
          placeholder="Waypoint, place or postcode"
          value={text}
          onChange={(e) => ask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              highlight(Math.min(active + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              highlight(Math.max(active - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              enterCandidate();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              usePlanStore.getState().stopAdding();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--color-text-primary)] outline-none"
        />
      </label>
      {hits.length > 0 && (
        <ul role="listbox" aria-label="Stops to add" className="mt-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-1 shadow-md">
          {hits.map((hit, i) => {
            const heading = i === 0 || hits[i - 1]?.group !== hit.group ? hit.group : null;
            return (
              <li key={hit.key} role="presentation">
                {heading !== null && (
                  <p className="px-2 pt-1 text-[10px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">{heading}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => highlight(i)}
                  onClick={() => {
                    highlight(i);
                    void addCandidate();
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[12.5px] ${i === active ? 'bg-[var(--color-accent)]/12' : ''}`}
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{hit.candidate.name}</span>
                  <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">{hit.detail}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DayHeading({
  day,
  photos,
  tripId,
}: {
  day: DayCard;
  photos: Map<string, { count: number; cameraTime: number }>;
  tripId: string;
}): ReactNode {
  const parts: string[] = [];
  if (day.driveSeconds > 0) parts.push(`${durationText(day.driveSeconds)} driving`);
  if (day.otherSeconds > 0) parts.push(`${durationText(day.otherSeconds)} other`);
  const shot = photos.get(day.date);
  if (shot !== undefined) parts.push(dayPhotoText(shot));
  return (
    <div className="group/day flex items-center gap-2 px-2.5 pt-2 pb-1">
      <h3 className="text-[10.5px] font-bold tracking-[0.06em] text-[var(--color-text-primary)] uppercase">{day.label}</h3>
      <span className="min-w-0 flex-1 truncate text-right text-[10.5px] text-[var(--color-text-muted)]">{parts.join(' · ')}</span>
      {/* Requirement 15: a day is added after this one, or removed with its entries leaving the plan. */}
      <button
        type="button"
        aria-label={`Add a day after ${day.label}`}
        title="Add a day after this one"
        onClick={() => addDay(tripId, day.date)}
        className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-accent)]"
      >
        <CalendarPlus size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Remove ${day.label}`}
        title="Remove this day: its routes and waypoints go to Not in the plan"
        onClick={() => removeDay(tripId, day.date, day.label)}
        className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-danger)]"
      >
        <CalendarMinus size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Each day with its stops' indices and where a stop added to an empty day would go. */
function layoutDays(
  planned: readonly DayCard[],
  startDate: string,
  stopIndex: ReadonlyMap<string, number>,
): { day: DayCard; dayStops: number[]; startsAt: number }[] {
  const cards: readonly DayCard[] =
    planned.length > 0 ? planned : [{ date: startDate, label: 'First day', driveSeconds: 0, distanceM: 0, otherSeconds: 0, rows: [], breakId: null }];
  const out: { day: DayCard; dayStops: number[]; startsAt: number }[] = [];
  let next = 0;
  for (const day of cards) {
    const dayStops = day.rows.flatMap((r) => {
      const t = rowStopId(r.key);
      const i = t?.kind === 'stop' ? stopIndex.get(t.stopId) : undefined;
      return i === undefined ? [] : [i];
    });
    // A day that a day break starts begins after the break (Requirement 15).
    const broken = day.breakId === null ? undefined : stopIndex.get(day.breakId);
    const startsAt = broken === undefined ? next : broken + 1;
    out.push({ day, dayStops, startsAt });
    next = dayStops.length > 0 ? (dayStops.at(-1) ?? 0) + 1 : startsAt;
  }
  return out;
}

export function PlanCards({
  tripId,
  view,
  geometry,
  photos,
}: {
  tripId: string;
  view: ItineraryView;
  geometry: TripGeometry | null;
  photos: readonly Photo[];
}): ReactNode {
  const selected = useSelectionStore((s) => s.selected);
  const selectedKey = selected === null ? null : refKey(selected);
  const focusedLeg = usePlanStore((s) => s.focusedLeg);
  const focusedStop = usePlanStore((s) => s.focusedStop);
  const adding = usePlanStore((s) => s.adding);
  const [dropBefore, setDropBefore] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // Requirement 16.1: an entry's menu takes it out of the plan or deletes it.
  const planMenu = (event: React.MouseEvent, row: DayRow, stopId: string | null): void => {
    if (stopId === null) return;
    const ref = row.ref;
    const items: MenuItem[] = [{ label: 'Take Out of the Plan', onSelect: () => removeStop(stopId, row.name) }];
    if (ref?.kind === 'waypoint' || ref?.kind === 'route') {
      items.push({
        label: ref.kind === 'waypoint' ? 'Delete Waypoint' : 'Delete Route',
        danger: true,
        separatorBefore: true,
        onSelect: () => deleteItem({ kind: ref.kind as 'route' | 'waypoint', id: ref.id }, row.name),
      });
    }
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  // What is in the trip but not the plan: put it in, take it out of the trip, or delete it.
  const looseMenu = (event: React.MouseEvent, row: DayRow): void => {
    const ref = row.ref;
    if (ref === null) return;
    event.preventDefault();
    const end = view.stops.length;
    const items: MenuItem[] = [];
    if (ref.kind === 'waypoint') items.push({ label: 'Add to the End of the Plan', onSelect: () => addWaypointStop(tripId, ref.id, end) });
    if (ref.kind === 'route') items.push({ label: 'Add to the End of the Plan', onSelect: () => void dropRoute(tripId, ref.id, end) });
    items.push({ label: 'Move Out of the Trip', separatorBefore: items.length > 0, onSelect: () => moveOutOfTrip(ref, row.name) });
    items.push(
      ref.kind === 'track'
        ? { label: 'Delete Track…', danger: true, separatorBefore: true, onSelect: () => void deleteTrack(ref.id) }
        : { label: ref.kind === 'waypoint' ? 'Delete Waypoint' : 'Delete Route', danger: true, separatorBefore: true, onSelect: () => deleteItem({ kind: ref.kind as 'route' | 'waypoint', id: ref.id }, row.name) },
    );
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const plan = useMemo(
    () =>
      dayCards(
        view,
        geometry === null
          ? { routes: [], tracks: [], waypoints: [] }
          : {
              routes: geometry.routes.map((r) => ({ id: r.id, name: r.name, distanceM: r.distanceM })),
              tracks: geometry.tracks.map((t) => ({ id: t.id, name: t.name, startedAt: t.startedAt, endedAt: t.endedAt })),
              waypoints: geometry.waypoints.map((w) => ({ id: w.id, name: w.name })),
            },
      ),
    [view, geometry],
  );
  const byDay = useMemo(() => photosByDay(photos), [photos]);
  const stopIndex = useMemo(() => new Map(view.stops.map((s, i) => [s.id, i])), [view.stops]);
  const selectedStop = selected?.kind === 'waypoint' ? view.stops.findIndex((s) => s.waypointId === selected.id) : -1;

  // A plan with no stops yet still has its first day to add to. Each day
  // knows its stops' indices, and where a stop added to it would begin.
  const days = useMemo(() => layoutDays(plan.days, view.itinerary.startDate, stopIndex), [plan.days, view.itinerary.startDate, stopIndex]);

  const rowProps = { stopIndex, selectedKey, focusedLeg, focusedStop, tripId, dropBefore, setDropBefore, onMenu: planMenu };
  // The place search ranks from the stop the new one would follow.
  const focus = view.stops[(adding?.index ?? 1) - 1]?.place ?? view.stops[0]?.place ?? geometry?.waypoints[0] ?? FALLBACK_FOCUS;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="plan-cards" onDragLeave={() => setDropBefore(null)}>
      {days.map(({ day, dayStops, startsAt }) => {
        const open = adding !== null && adding.tripId === tripId && adding.day === day.date;
        return (
          <section
            key={day.date}
            aria-label={day.label}
            data-testid="day-card"
            className="mb-2 rounded-lg bg-[var(--color-surface-sunken)] pb-1"
            // A drop on the card but not on a row goes at the end of the day,
            // so an empty plan can be filled by dragging (Requirement 14.1).
            onDragOver={(event) => {
              if (carries(event)) event.preventDefault();
            }}
            onDrop={(event) => {
              if (!carries(event)) return;
              event.preventDefault();
              setDropBefore(null);
              dropInto(event, tripId, stopIndex, dayStops.length > 0 ? (dayStops.at(-1) ?? 0) + 1 : startsAt);
            }}
          >
            <DayHeading day={day} photos={byDay} tripId={tripId} />
            <div className="px-1">
              {day.rows.map((row) => (
                <PlanRow key={row.key} row={row} {...rowProps} />
              ))}
            </div>
            {open ? (
              <AddSearch tripId={tripId} geometry={geometry} focus={focus} />
            ) : (
              <button
                type="button"
                aria-label={`Add a stop to ${day.label}`}
                onClick={() =>
                  usePlanStore.getState().startAdding({ tripId, day: day.date, index: addIndex(dayStops, selectedStop < 0 ? null : selectedStop, startsAt) })
                }
                className="mx-1 flex h-7 w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 text-[12px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-surface)]"
              >
                <Plus size={13} aria-hidden="true" /> Add
              </button>
            )}
          </section>
        );
      })}

      <button
        type="button"
        onClick={() => addDay(tripId)}
        className="mb-2 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-accent)] hover:border-[var(--color-accent)]"
      >
        <CalendarPlus size={14} aria-hidden="true" /> Add a day
      </button>

      {plan.unknown.length > 0 && (
        <section aria-label="Unknown times" className="mb-2 rounded-lg bg-[var(--color-surface-sunken)] pb-1">
          <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.06em] text-[var(--color-text-primary)] uppercase">Unknown times</div>
          <p className="px-2.5 pb-1 text-[11px] text-[var(--color-text-muted)]">Until every drive before them is planned.</p>
          <div className="px-1">
            {plan.unknown.map((row) => (
              <PlanRow key={row.key} row={row} {...rowProps} />
            ))}
          </div>
        </section>
      )}

      {plan.notInPlan.length > 0 && (
        <section aria-label="Not in the plan" className="mt-3">
          <h3 className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">Not in the plan</h3>
          {plan.notInPlan.map((row) => {
            const waypoint = row.ref?.kind === 'waypoint' ? row.ref.id : null;
            const route = row.ref?.kind === 'route' ? row.ref.id : null;
            // A track is never dragged in: its own times place it (Requirement 12.4).
            const isTrack = row.ref?.kind === 'track';
            const isSelected = row.ref !== null && refKey(row.ref) === selectedKey;
            return (
              <button
                key={row.key}
                type="button"
                data-testid="not-in-plan"
                aria-label={row.name}
                aria-pressed={isSelected}
                draggable={waypoint !== null || route !== null}
                title={isTrack ? 'A track is placed by the times it was recorded, not dragged into the plan.' : 'Drag onto a day to put it in the plan'}
                onDragStart={(event) => {
                  if (waypoint !== null) event.dataTransfer.setData(WAYPOINT_MIME, waypoint);
                  if (route !== null) event.dataTransfer.setData(ROUTE_MIME, route);
                }}
                onClick={() => row.ref !== null && void useSelectionStore.getState().select(row.ref)}
                onContextMenu={(event) => looseMenu(event, row)}
                className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] ${
                  isSelected ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]'
                }`}
              >
                <RowIcon row={row} />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
              </button>
            );
          })}
        </section>
      )}
      {menu !== null && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
