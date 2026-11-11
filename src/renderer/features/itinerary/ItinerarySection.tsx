import { useState, type ReactNode } from "react";
import type { ItineraryView, OtherTransport, StopView, VehicleEnergy } from "@shared/domain/itinerary";
import type { UnitSystem } from "@shared/domain/types";
import { formatDate, formatDateRange } from "@shared/itinerary/format";
import type { TimedStop } from "@shared/itinerary/timeline";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CalendarPlus,
  ListPlus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { api, call, describeError } from "../../lib/client";
import { useGeometryStore } from "../../stores/geometryStore";
import { useItineraryStore } from "../../stores/itineraryStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { Field, INPUT_CLASS, inputAt } from "../properties/fields";
import {
  flagMessage,
  isWarning,
  joinMinutes,
  legBasis,
  legText,
  splitMinutes,
  tomorrow,
  whenText,
} from "./viewModel";

/**
 * Plan by date: the itinerary editor in a trip's properties. Phase 10
 * Requirements 1–3 and 9, design §11.1.
 *
 * Every edit goes through the main process as an undoable command, and the
 * times shown are the main process's timeline. Nothing is computed here, so
 * the editor and the calendar can never disagree.
 */

const KM_PER_MILE = 1.609344;
const SMALL_INPUT = inputAt('w-auto');

/** Runs a change, then reloads what it touched; failures become a toast. */
async function run(work: () => Promise<unknown>, done?: string): Promise<boolean> {
  try {
    await work();
    await Promise.all([
      useItineraryStore.getState().reload(),
      useGeometryStore.getState().reload(),
      useLibraryStore.getState().refresh(),
    ]);
    if (done !== undefined) useUiStore.getState().showToast(done);
    return true;
  } catch (cause) {
    useUiStore.getState().showToast(describeError(cause), "error");
    await useItineraryStore.getState().reload();
    return false;
  }
}

type StopUpdate = Parameters<Window["trailrt"]["itinerary"]["updateStop"]>[0];

function update(patch: StopUpdate): void {
  void run(() => call(api().itinerary.updateStop(patch)));
}

export function ItinerarySection({ tripId }: { tripId: string }): ReactNode {
  const view = useItineraryStore((s) => (s.tripId === tripId ? s.view : null));
  // Known once the store has answered for this trip. A reload of the same
  // trip must not unmount the form: that would throw away what the user is
  // typing every time anything else in the library changes.
  const known = useItineraryStore((s) => s.tripId === tripId && (s.view !== null || !s.loading || s.answered));

  if (view === null) {
    return known ? <PlanByDate tripId={tripId} /> : null;
  }
  return <Plan view={view} />;
}

function PlanByDate({ tripId }: { tripId: string }): ReactNode {
  const [date, setDate] = useState(tomorrow());
  const [time, setTime] = useState("09:00");
  return (
    <Field label="Plan by date">
      <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
        Give the trip a start date, then add its stops in order. Times are worked out from the drives between them.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label="Start date" value={date} onChange={(e) => setDate(e.target.value)} className={SMALL_INPUT} />
        <input type="time" aria-label="Start time" value={time} onChange={(e) => setTime(e.target.value)} className={SMALL_INPUT} />
        <Button
          variant="primary"
          disabled={date === "" || time === ""}
          onClick={() => void run(() => call(api().itinerary.create({ tripId, startDate: date, startTime: time })))}
        >
          Plan by date
        </Button>
      </div>
    </Field>
  );
}

function Plan({ view }: { view: ItineraryView }): ReactNode {
  const { itinerary, stops, timeline } = view;
  const units = useSettingsStore((s) => s.settings.units);
  const geometry = useGeometryStore((s) => (s.tripId === itinerary.tripId ? s.geometry : null));
  const openCalendar = useUiStore((s) => s.openCalendar);
  const openPoiPanel = useUiStore((s) => s.openPoiPanel);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [adding, setAdding] = useState("");

  const waypoints = geometry?.waypoints ?? [];
  const routes = geometry?.routes ?? [];
  const calendarOffset = timeline.stops[0]?.departureLocal?.offsetMinutes ?? null;
  const tripId = itinerary.tripId;

  return (
    <div data-testid="itinerary">
      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Itinerary
      </h3>

      <p className="mb-3 text-[13px] text-[var(--color-text-primary)]" data-testid="itinerary-dates">
        {formatDateRange(itinerary.startDate, timeline.endDate)}
        {!timeline.complete && (
          <span className="block text-[12px] text-[var(--color-text-muted)]">
            The end is unknown until every drive has a route.
          </span>
        )}
      </p>

      <Field label="Start">
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            aria-label="Start date"
            value={itinerary.startDate}
            onChange={(e) =>
              e.target.value !== "" &&
              void run(() => call(api().itinerary.update({ tripId, startDate: e.target.value })))
            }
            className={SMALL_INPUT}
          />
          <input
            type="time"
            aria-label="Start time"
            value={itinerary.startTime}
            onChange={(e) =>
              e.target.value !== "" &&
              void run(() => call(api().itinerary.update({ tripId, startTime: e.target.value })))
            }
            className={SMALL_INPUT}
          />
        </div>
      </Field>

      {stops.length === 0 && (
        <p className="mb-3 text-[12px] text-[var(--color-text-muted)]">
          No stops yet. Add the trip’s first place below: it is where the trip starts.
        </p>
      )}

      <ol className="mb-3 flex flex-col gap-2" aria-label="Stops">
        {stops.map((stop, index) => (
          <li key={stop.id} className="flex flex-col gap-2">
            {index > 0 && (
              <LegRow stop={stop} timed={timeline.stops[index]} routes={routes} units={units} />
            )}
            <StopRow
              stop={stop}
              index={index}
              count={stops.length}
              timed={timeline.stops[index]}
              calendarOffset={calendarOffset}
            />
          </li>
        ))}
      </ol>

      <Field label="Add a stop">
        {waypoints.length === 0 ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Add waypoints to this trip, or find places along a route, then add them here.
          </p>
        ) : (
          <div className="flex gap-2">
            <select aria-label="Waypoint to add" value={adding} onChange={(e) => setAdding(e.target.value)} className={INPUT_CLASS}>
              <option value="">Choose a waypoint…</option>
              {waypoints.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <IconButton
              hint="Add stop"
              className="h-8 w-8"
              disabled={adding === ""}
              onClick={() =>
                void run(() => call(api().itinerary.addStop({ tripId, waypointId: adding }))).then((ok) => ok && setAdding(""))
              }
            >
              <ListPlus size={16} aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </Field>

      {timeline.days
        .filter((day) => day.overDailyCap)
        .map((day) => (
          <p key={day.date} className="mb-1 text-[12px] text-[var(--color-danger)]" data-testid="over-cap">
            {formatDate(day.date)}: more driving than your daily limit. Nothing has been changed.
          </p>
        ))}

      <PlanSettings view={view} units={units} />

      <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="itinerary-actions">
        <IconButton hint="Calendar" onClick={() => openCalendar(tripId)}>
          <CalendarDays size={16} aria-hidden="true" />
        </IconButton>
        <IconButton hint="Find places along the way" onClick={() => openPoiPanel({ kind: "itinerary", tripId })}>
          <Search size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          hint="Plan the drives by road"
          onClick={() => void run(() => call(api().itinerary.planAll({ tripId })), "Drives planned where a road could be found.")}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          hint="Export to a calendar file"
          onClick={() =>
            void call(api().itinerary.exportIcs({ tripId, includeLegs: true }))
              .then((result) => {
                if (result.cancelled) return;
                const left = result.omitted.length === 0 ? "" : ` ${result.omitted.length} left out because their times are unknown.`;
                useUiStore.getState().showToast(`Saved ${result.fileName}: ${result.eventCount} events.${left}`);
              })
              .catch((cause: unknown) => useUiStore.getState().showToast(describeError(cause), "error"))
          }
        >
          <CalendarPlus size={16} aria-hidden="true" />
        </IconButton>
        {confirmRemove ? (
          <span className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
            Remove the dates and stops? Waypoints and routes stay.
            <Button
              variant="danger"
              onClick={() => void run(() => call(api().itinerary.remove({ tripId })), "Itinerary removed. Undo with ⌘Z.")}
            >
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <IconButton hint="Remove the itinerary" variant="danger" className="ml-auto" onClick={() => setConfirmRemove(true)}>
            <Trash2 size={16} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

const TRANSPORT_LABELS: Record<OtherTransport, string> = {
  ferry: "Ferry",
  train: "Train",
  flight: "Flight",
  other: "Other",
};

function LegRow({
  stop,
  timed,
  routes,
  units,
}: {
  stop: StopView;
  timed: TimedStop | undefined;
  routes: readonly { id: string; name: string }[];
  units: UnitSystem;
}): ReactNode {
  const basis = legBasis(timed);
  // Choosing "a chosen route" needs the route before anything is saved.
  const [choosing, setChoosing] = useState(false);
  const shown = choosing ? "route" : stop.legMode;
  const name = stop.place?.name ?? "this stop";

  return (
    <div className="ml-3 border-l-2 border-dashed border-[var(--color-border-subtle)] pl-3 text-[12px]" data-testid="leg">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`How you travel to ${name}`}
          value={shown}
          onChange={(e) => {
            const mode = e.target.value;
            if (mode === "route") {
              setChoosing(true);
              return;
            }
            setChoosing(false);
            void run(() =>
              call(
                api().itinerary.setLegMode(
                  mode === "other" ? { id: stop.id, mode: "other", transport: "other" } : { id: stop.id, mode: "road" },
                ),
              ),
            );
          }}
          className={inputAt('w-auto')}
        >
          <option value="road">By road</option>
          <option value="route">A route I choose</option>
          <option value="other">Other transport</option>
        </select>
        {shown === "route" && (
          <select
            aria-label={`Route to ${name}`}
            value={choosing ? "" : (stop.legRouteId ?? "")}
            onChange={(e) => {
              if (e.target.value === "") return;
              setChoosing(false);
              void run(() => call(api().itinerary.linkLeg({ id: stop.id, routeId: e.target.value })));
            }}
            className={inputAt('w-auto max-w-[12rem]')}
          >
            <option value="">Choose a route…</option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {shown === "other" && <OtherTransportFields stop={stop} />}

      <p className="mt-1 text-[var(--color-text-secondary)]" data-testid="leg-summary">
        {stop.legMode === "road" && stop.leg?.name ? `${stop.leg.name} · ` : ""}
        {legText(timed, units)}
      </p>
      {basis !== null && <p className="text-[11px] text-[var(--color-text-muted)]">{basis}</p>}
      {stop.planIssue !== null && (
        <p className="text-[var(--color-text-secondary)]" data-testid="plan-issue">
          {stop.planIssue}
        </p>
      )}
      {stop.legMode === "route" && stop.leg?.fits === false && (
        <p className="text-[var(--color-danger)]">This route does not join these two stops, so it is not used for timing.</p>
      )}
      {stop.legMode === "route" && stop.leg !== null && stop.leg.name === null && (
        <p className="text-[var(--color-danger)]">The chosen route was deleted.</p>
      )}
    </div>
  );
}

function OtherTransportFields({ stop }: { stop: StopView }): ReactNode {
  const split = splitMinutes(stop.legMinutes);
  const [hours, setHours] = useState(stop.legMinutes === null ? "" : String(split.hours));
  const [minutes, setMinutes] = useState(stop.legMinutes === null ? "" : String(split.minutes));
  const [label, setLabel] = useState(stop.legLabel ?? "");

  const save = (patch: { transport?: OtherTransport; minutes?: number | null; label?: string | null }): void => {
    void run(() =>
      call(
        api().itinerary.setLegMode({
          id: stop.id,
          mode: "other",
          transport: patch.transport ?? stop.legTransport ?? "other",
          minutes: patch.minutes === undefined ? stop.legMinutes : patch.minutes,
          label: patch.label === undefined ? stop.legLabel : patch.label,
        }),
      ),
    );
  };

  const commitTime = (): void => {
    if (hours.trim() === "" && minutes.trim() === "") {
      if (stop.legMinutes !== null) save({ minutes: null });
      return;
    }
    const total = joinMinutes(hours, minutes);
    if (total === null || total === 0) {
      useUiStore.getState().showToast("Enter the travel time in whole hours and minutes.", "error");
      return;
    }
    if (total !== stop.legMinutes) save({ minutes: total });
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[var(--color-text-secondary)]">
      <select
        aria-label="Kind of transport"
        value={stop.legTransport ?? "other"}
        onChange={(e) => save({ transport: e.target.value as OtherTransport })}
        className={SMALL_INPUT}
      >
        {(Object.keys(TRANSPORT_LABELS) as OtherTransport[]).map((kind) => (
          <option key={kind} value={kind}>
            {TRANSPORT_LABELS[kind]}
          </option>
        ))}
      </select>
      <input
        aria-label="Transport name"
        placeholder="e.g. Holyhead ferry"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          const next = label.trim();
          if (next !== (stop.legLabel ?? "")) save({ label: next.length === 0 ? null : next });
        }}
        className={inputAt('w-36')}
      />
      <span className="flex items-center gap-1 whitespace-nowrap">
        takes
        <input aria-label="Travel hours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} onBlur={commitTime} className={inputAt('w-11')} />
        h
        <input aria-label="Travel minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} onBlur={commitTime} className={inputAt('w-11')} />
        min
      </span>
    </div>
  );
}

function StopRow({
  stop,
  index,
  count,
  timed,
  calendarOffset,
}: {
  stop: StopView;
  index: number;
  count: number;
  timed: TimedStop | undefined;
  calendarOffset: number | null;
}): ReactNode {
  const isFirst = index === 0;
  const isLast = index === count - 1;
  const zone = timed?.zone ?? "";

  return (
    <div
      className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 text-[12px]"
      data-testid="stop"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[11px] font-semibold text-[var(--color-text-muted)]">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {stop.place?.name ?? "Place deleted"}
          </p>
          <p className="text-[var(--color-text-secondary)]" data-testid="stop-times">
            {isFirst
              ? `Leave ${whenText(timed?.departureLocal ?? null, calendarOffset)}`
              : isLast
                ? `Arrive ${whenText(timed?.arrivalLocal ?? null, calendarOffset)}`
                : `Arrive ${whenText(timed?.arrivalLocal ?? null, calendarOffset)} · Leave ${whenText(timed?.departureLocal ?? null, calendarOffset)}`}
          </p>
        </div>
        <div className="flex gap-0.5">
          <IconButton
            variant="ghost"
            hint={`Move ${stop.place?.name ?? "stop"} up`}
            disabled={isFirst}
            onClick={() => void run(() => call(api().itinerary.moveStop({ id: stop.id, toIndex: index - 1 })))}
          >
            <ArrowUp size={15} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="ghost"
            hint={`Move ${stop.place?.name ?? "stop"} down`}
            disabled={isLast}
            onClick={() => void run(() => call(api().itinerary.moveStop({ id: stop.id, toIndex: index + 1 })))}
          >
            <ArrowDown size={15} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="ghost"
            hint={`Remove ${stop.place?.name ?? "stop"} from the plan`}
            onClick={() => void run(() => call(api().itinerary.removeStop({ id: stop.id })))}
          >
            <X size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      {!isFirst && !isLast && <DurationEditor stop={stop} onChange={update} />}

      {!isFirst && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 whitespace-nowrap text-[var(--color-text-secondary)]">
            Arrive by
            <input
              type="time"
              aria-label="Arrive by"
              value={stop.arriveBy ?? ""}
              onChange={(e) => update({ id: stop.id, arriveBy: e.target.value === "" ? null : e.target.value })}
              className={SMALL_INPUT}
            />
          </label>
          {!isLast && stop.durationKind === "hours" && (
            <label className="flex items-center gap-1 whitespace-nowrap text-[var(--color-text-secondary)]">
              Leave at
              <input
                type="time"
                aria-label="Leave at"
                value={stop.departAt ?? ""}
                onChange={(e) => update({ id: stop.id, departAt: e.target.value === "" ? null : e.target.value })}
                className={SMALL_INPUT}
              />
            </label>
          )}
        </div>
      )}

      <NotesField stop={stop} onCommit={(notes) => update({ id: stop.id, notes })} />

      {(timed?.flags ?? []).map((flag) => (
        <p
          key={flag}
          className={isWarning(flag) ? "mt-1 text-[var(--color-danger)]" : "mt-1 text-[var(--color-text-muted)]"}
          data-testid="stop-flag"
        >
          {flagMessage(flag, zone)}
        </p>
      ))}
    </div>
  );
}

function DurationEditor({
  stop,
  onChange,
}: {
  stop: StopView;
  onChange: (patch: StopUpdate) => void;
}): ReactNode {
  const split = splitMinutes(stop.durationMinutes);
  const [hours, setHours] = useState(String(split.hours));
  const [minutes, setMinutes] = useState(String(split.minutes));
  const [days, setDays] = useState(String(stop.durationDays ?? 1));

  const commitHours = (): void => {
    const total = joinMinutes(hours, minutes);
    if (total === null) {
      useUiStore.getState().showToast("Enter whole hours and minutes, with minutes from 0 to 59.", "error");
      return;
    }
    if (total !== stop.durationMinutes) onChange({ id: stop.id, durationMinutes: total });
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[var(--color-text-secondary)]">
      <label className="flex items-center gap-1">
        Stay
        <select
          aria-label="Stay in"
          value={stop.durationKind}
          onChange={(e) => onChange({ id: stop.id, durationKind: e.target.value as "hours" | "days" })}
          className={SMALL_INPUT}
        >
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </label>
      {stop.durationKind === "hours" ? (
        <>
          <input
            aria-label="Hours"
            inputMode="numeric"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            onBlur={commitHours}
            className={inputAt('w-12')}
          />
          h
          <input
            aria-label="Minutes"
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={commitHours}
            className={inputAt('w-12')}
          />
          min
        </>
      ) : (
        <>
          <input
            aria-label="Days"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onBlur={() => {
              const value = Number(days);
              if (!Number.isInteger(value) || value < 1) {
                useUiStore.getState().showToast("A stay is a whole number of days, at least one.", "error");
                return;
              }
              if (value !== stop.durationDays) onChange({ id: stop.id, durationDays: value });
            }}
            className={inputAt('w-12')}
          />
          {Number(days) === 1 ? "day" : "days"}, leave at
          <input
            type="time"
            aria-label="Leave at"
            value={stop.departTime ?? ""}
            placeholder="default"
            onChange={(e) => onChange({ id: stop.id, departTime: e.target.value === "" ? null : e.target.value })}
            className={SMALL_INPUT}
          />
        </>
      )}
    </div>
  );
}

function NotesField({ stop, onCommit }: { stop: StopView; onCommit: (notes: string | null) => void }): ReactNode {
  const [notes, setNotes] = useState(stop.notes ?? "");
  return (
    <input
      aria-label="Stop notes"
      placeholder="Notes"
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
      onBlur={() => {
        const next = notes.trim();
        if (next !== (stop.notes ?? "")) onCommit(next.length === 0 ? null : next);
      }}
      className={`${INPUT_CLASS} mt-2`}
    />
  );
}

function PlanSettings({ view, units }: { view: ItineraryView; units: UnitSystem }): ReactNode {
  const { itinerary } = view;
  const tripId = itinerary.tripId;
  const toShown = (km: number | null): string =>
    km === null ? "" : String(Math.round(units === "imperial" ? km / KM_PER_MILE : km));
  const [range, setRange] = useState(toShown(itinerary.rangeKm));
  const [cap, setCap] = useState(itinerary.maxDriveMinutes === null ? "" : String(itinerary.maxDriveMinutes / 60));

  return (
    <details className="mt-2 text-[12px] text-[var(--color-text-secondary)]">
      <summary className="cursor-pointer text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Trip settings
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label className="flex items-center justify-between gap-2">
          Leave a day-stay at
          <input
            type="time"
            aria-label="Default departure"
            value={itinerary.defaultDepart}
            onChange={(e) =>
              e.target.value !== "" && void run(() => call(api().itinerary.update({ tripId, defaultDepart: e.target.value })))
            }
            className={SMALL_INPUT}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          Most driving in a day (hours)
          <input
            aria-label="Daily driving limit"
            inputMode="decimal"
            placeholder="No limit"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            onBlur={() => {
              const hours = cap.trim() === "" ? null : Number(cap);
              if (hours !== null && !(hours >= 0.5 && hours <= 24)) {
                useUiStore.getState().showToast("A daily limit is between half an hour and 24 hours.", "error");
                return;
              }
              const minutes = hours === null ? null : Math.round(hours * 60);
              if (minutes !== itinerary.maxDriveMinutes) void run(() => call(api().itinerary.update({ tripId, maxDriveMinutes: minutes })));
            }}
            className={inputAt('w-20')}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          Vehicle
          <select
            aria-label="Vehicle"
            value={itinerary.energy}
            onChange={(e) => void run(() => call(api().itinerary.update({ tripId, energy: e.target.value as VehicleEnergy })))}
            className={SMALL_INPUT}
          >
            <option value="fuel">Fuel</option>
            <option value="electric">Electric</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">
          Range ({units === "imperial" ? "miles" : "km"})
          <input
            aria-label="Vehicle range"
            inputMode="numeric"
            placeholder="Not set"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            onBlur={() => {
              const shown = range.trim() === "" ? null : Number(range);
              if (shown !== null && !(shown > 0)) {
                useUiStore.getState().showToast("A range is a distance more than zero, or blank for none.", "error");
                return;
              }
              const km = shown === null ? null : units === "imperial" ? shown * KM_PER_MILE : shown;
              void run(() => call(api().itinerary.update({ tripId, rangeKm: km })));
            }}
            className={inputAt('w-20')}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          Keep in reserve (%)
          <input
            aria-label="Reserve"
            type="number"
            min={0}
            max={90}
            value={itinerary.reservePct}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value >= 0 && value <= 90) {
                void run(() => call(api().itinerary.update({ tripId, reservePct: value })));
              }
            }}
            className={inputAt('w-16')}
          />
        </label>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          With a range set, “Find along the way” warns of stretches with no {itinerary.energy === "electric" ? "charging point" : "fuel station"} mapped.
        </p>
      </div>
    </details>
  );
}
