import { ArrowLeftRight, ChartArea, Search } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import type { RouteWithPoints, UnitSystem } from "@shared/domain/types";
import { ROUTE_COLOURS, routeColour } from "@shared/domain/symbols";
import {
  estimateDurationSeconds,
  formatCoordinates,
  formatDistance,
  formatDuration,
  formatElevation,
  formatTimestamp,
} from "@shared/geo/units";
import { SPEED_BASIS, travelSpeedKmh } from "@shared/routing/travelTime";
import * as actions from "../../lib/actions";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton, InfoIcon } from "../../components/IconButton";
import { useSettingsStore } from "../../stores/settingsStore";
import { Field, INPUT_CLASS, ReadOnly } from "./fields";
import { RoadDetails, RoadSummary, TransportModeSelect } from "./roadData";
import { WazeButton } from "./WazeButton";

/**
 * Route inspector.
 *
 * Reworked after owner feedback (Phase 7 Requirement 6). The panel shows what
 * someone planning a trip asks first: how far, how long, and what the roads
 * are like. Coordinates, point counts, provenance and the routing engine moved
 * to a Details popup behind the ⓘ button. Duplicate and Delete are in the
 * library's context menu, and point editing is in the profile drawer.
 *
 * Absent data is rendered as an em dash by the formatters, never as zero. A
 * route with no elevation data and a genuinely flat route are different facts
 * and this panel has to show the difference.
 */

/** A speed in the user's units, to the precision a caption needs. */
function formatCaptionSpeed(kmh: number, units: UnitSystem): string {
  if (units === "imperial") {
    const mph = kmh / 1.609344;
    return `${mph < 10 ? mph.toFixed(1) : Math.round(mph)} mph`;
  }
  return `${kmh < 10 ? kmh.toFixed(1) : Math.round(kmh)} km/h`;
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {label}
      </p>
      <p className="text-[15px] font-medium text-[var(--color-text-primary)] tabular-nums">
        {value}
      </p>
      {children}
    </div>
  );
}

export function RouteProperties({
  route,
  units,
  planningSpeedKmh,
}: {
  route: RouteWithPoints;
  units: UnitSystem;
  planningSpeedKmh: number;
}): ReactNode {
  const [name, setName] = useState(route.name);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Stable, because the dialog re-opens itself whenever its onClose changes.
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  const mode = useSettingsStore((s) => s.settings.transportMode);

  const speedKmh = travelSpeedKmh(mode, planningSpeedKmh);
  const duration = estimateDurationSeconds(route.distanceM, speedKmh);
  const hasElevation = route.elevGainM !== null;

  return (
    <div className="h-full overflow-y-auto p-3">
      <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Route
      </h2>

      <Field label="Name">
        <input
          value={name}
          aria-label="Route name"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed.length === 0) {
              setName(route.name);
              return;
            }
            if (trimmed !== route.name)
              void actions.renameRoute(route.id, trimmed);
          }}
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Colour">
        <div className="flex flex-wrap gap-1.5">
          {ROUTE_COLOURS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.label}
              aria-label={option.label}
              aria-pressed={routeColour(route.colour) === option.hex}
              onClick={() => void actions.setRouteColour(route.id, option.hex)}
              style={{ background: option.hex }}
              className={`h-6 w-6 rounded-full border-2 ${
                routeColour(route.colour) === option.hex
                  ? "border-[var(--color-text-primary)]"
                  : "border-transparent"
              }`}
            />
          ))}
        </div>
      </Field>

      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Stat label="Distance" value={formatDistance(route.distanceM, units)} />
        <Stat label="Time" value={formatDuration(duration)} />
        {hasElevation && (
          <Stat label="Climb" value={formatElevation(route.elevGainM, units)} />
        )}
      </div>

      <div className="mb-1 flex items-center justify-between gap-2">
        <label
          htmlFor={`mode-${route.id}`}
          className="text-[12px] text-[var(--color-text-secondary)]"
        >
          Travelling by
        </label>
        <TransportModeSelect id={`mode-${route.id}`} />
      </div>
      {/* Labelled as an estimate with the speed visible: this is not a
          measurement, and Requirement 4.3 forbids implying it is. */}
      <p className="mb-4 text-[11px] text-[var(--color-text-muted)]">
        Time is an estimate at {formatCaptionSpeed(speedKmh, units)},{" "}
        {SPEED_BASIS[mode]}.
      </p>

      <RoadSummary
        ownerType="route"
        ownerId={route.id}
        units={units}
        pointCount={route.pointCount}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <IconButton hint="Profile and points" onClick={() => actions.openProfile("route", route.id)}>
          <ChartArea size={16} aria-hidden="true" />
        </IconButton>
        <IconButton hint="Reverse the route" onClick={() => void actions.reverseRoute(route.id)}>
          <ArrowLeftRight size={16} aria-hidden="true" />
        </IconButton>
        <IconButton hint="Find places along the route" onClick={() => useUiStore.getState().openPoiPanel({ kind: "route", routeId: route.id })}>
          <Search size={16} aria-hidden="true" />
        </IconButton>
        <div className="ml-auto flex items-center gap-1.5">
          <WazeButton
            selection={{
              kind: "route",
              name: route.name,
              points: route.points.map((p) => ({ lat: p.lat, lon: p.lon })),
            }}
          />
          <IconButton
            hint="Route details"
            onClick={() => setDetailsOpen(true)}
          >
            <InfoIcon />
          </IconButton>
        </div>
      </div>

      {detailsOpen && (
        <RouteDetailsDialog
          route={route}
          units={units}
          onClose={closeDetails}
        />
      )}
    </div>
  );
}

/** Everything the panel no longer shows, for whoever wants it. */
function RouteDetailsDialog({
  route,
  units,
  onClose,
}: {
  route: RouteWithPoints;
  units: UnitSystem;
  onClose: () => void;
}): ReactNode {
  const first = route.points.at(0) ?? null;
  const last = route.points.at(-1) ?? null;

  return (
    <Dialog
      title={`${route.name} — details`}
      onClose={onClose}
      width={480}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Start">
          <ReadOnly
            value={first === null ? "—" : formatCoordinates(first.lat, first.lon)}
          />
        </Field>
        <Field label="End">
          <ReadOnly
            value={last === null ? "—" : formatCoordinates(last.lat, last.lon)}
          />
        </Field>
        <Field label="Points">
          <ReadOnly value={route.pointCount.toLocaleString()} />
        </Field>
        <Field label="Source">
          <ReadOnly
            value={route.source === "import" ? "Imported" : "Drawn here"}
          />
        </Field>
        <Field label="Last modified">
          <ReadOnly value={formatTimestamp(route.updatedAt)} />
        </Field>
      </div>

      <Field label="Elevation">
        {route.elevGainM !== null ? (
          <ul className="text-[13px] text-[var(--color-text-primary)]">
            <li>Gain {formatElevation(route.elevGainM, units)}</li>
            <li>Loss {formatElevation(route.elevLossM, units)}</li>
            <li>
              Range {formatElevation(route.elevMinM, units)} –{" "}
              {formatElevation(route.elevMaxM, units)}
            </li>
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            No elevation data in this route.
            <span className="block text-[11px] text-[var(--color-text-muted)]">
              The profile shows terrain heights from an elevation model instead.
            </span>
          </p>
        )}
      </Field>

      <div className="my-3 h-px bg-[var(--color-border-subtle)]" />

      <RoadDetails
        ownerType="route"
        ownerId={route.id}
        units={units}
        pointCount={route.pointCount}
      />
    </Dialog>
  );
}
