import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UnitSystem } from "@shared/domain/types";
import { formatTimestamp } from "@shared/geo/units";
import {
  TRANSPORT_MODES,
  type TransportMode,
} from "@shared/routing/RoutingProvider";
import type { AttributeOwnerType } from "@shared/routing/results";
import { Button } from "../../components/Button";
import * as actions from "../../lib/actions";
import { routingKey, useRoutingStore } from "../../stores/routingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { SpeedDistributionBar } from "../profile/SpeedDistributionBar";

/**
 * Road data for a route or track: speed limits, snapping and map matching.
 *
 * Split in two after owner feedback (Phase 7 Requirement 6). `RoadSummary` is
 * what a person planning a ride needs in the panel: the speed-limit bar and
 * anything wrong with the route. `RoadDetails` holds the engine, the snap
 * provenance and the band table, and is shown in the Details popup.
 *
 * ## Looked up automatically, but only on this machine
 *
 * With the built-in engine, selecting a route or track looks its roads up
 * straight away. Nothing leaves the machine (ADR 0013), so there is no consent
 * to ask for and no reason to make the user press a button. A remote service
 * is different: the consent the user gave covers actions they take, so
 * selection never contacts one, and the panel offers a button instead.
 *
 * Each geometry is tried once per selection. A failure is shown inline with a
 * retry, never retried in a loop.
 *
 * ## Snapping moves routes, never tracks
 *
 * There is no snap control for a track anywhere here. A recording is measured
 * data and moving its samples onto a road would be falsifying it (ADR 0011 §4).
 * A track can still be *matched*, which reads road attributes and leaves every
 * sample where it was.
 */

export const TRANSPORT_LABELS: Record<TransportMode, string> = {
  auto: "Car",
  motorcycle: "Motorcycle",
  bicycle: "Bicycle",
  pedestrian: "Walking",
};

/**
 * Loads the cached road data and, with the built-in engine and `auto` set,
 * fills it in. Only the summary passes `auto`, so a geometry with both views
 * mounted is looked up once.
 */
export function useRoadData(
  ownerType: AttributeOwnerType,
  ownerId: string,
  pointCount: number,
  auto: boolean,
) {
  const key = routingKey(ownerType, ownerId);
  const status = useRoutingStore((s) => s.status);
  const loadStatus = useRoutingStore((s) => s.loadStatus);
  const loadAttributes = useRoutingStore((s) => s.loadAttributes);
  const loadDistribution = useRoutingStore((s) => s.loadDistribution);
  const attributes = useRoutingStore((s) => s.attributes[key]);
  const posted = useRoutingStore((s) => s.posted[key]);
  const recorded = useRoutingStore((s) => s.recorded[key]);
  const provenance = useRoutingStore((s) =>
    ownerType === "route" ? s.provenance[ownerId] : undefined,
  );
  const busy = useRoutingStore((s) => s.busy[key] === true);
  const [failed, setFailed] = useState(false);
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    // Local database reads. None of them can reach the network.
    void loadStatus();
    void loadAttributes(ownerType, ownerId);
    void loadDistribution(ownerType, ownerId, "posted");
    if (ownerType === "track") {
      void loadDistribution(ownerType, ownerId, "recorded");
    }
  }, [loadStatus, loadAttributes, loadDistribution, ownerType, ownerId]);

  const available = status?.available === true;
  const local = available && status?.kind === "embedded";

  /*
   * The automatic lookup. Waits for the cached attributes to be read, so a
   * route that already has road data is not matched again, and re-reads when
   * the geometry has changed since (`stale`).
   */
  const stale = attributes?.status.stale === true;
  const fetchedAt = attributes?.status.fetchedAt ?? null;
  useEffect(() => {
    if (!auto || !local || busy || pointCount < 2) return;
    if (attributes === undefined) return;
    if (attributes !== null && !stale) return;

    const attempt = `${key}:${fetchedAt ?? "none"}`;
    if (attempted.current.has(attempt)) return;
    attempted.current.add(attempt);

    void actions
      .matchRoads(ownerType, ownerId, { quiet: true, force: stale })
      .then((ok) => setFailed(!ok));
  }, [
    auto,
    local,
    busy,
    pointCount,
    attributes,
    stale,
    fetchedAt,
    key,
    ownerType,
    ownerId,
  ]);

  const retry = (): void => {
    setFailed(false);
    void actions
      .matchRoads(ownerType, ownerId, { force: true })
      .then((ok) => setFailed(!ok));
  };

  return {
    status,
    available,
    local,
    attributes,
    posted,
    recorded,
    provenance,
    busy,
    failed,
    retry,
  };
}

/** The transport mode. A global setting: it decides how the next route is made. */
export function TransportModeSelect({ id }: { id: string }): ReactNode {
  const mode = useSettingsStore((s) => s.settings.transportMode);
  const updateSetting = useSettingsStore((s) => s.set);
  return (
    <select
      id={id}
      aria-label="Transport mode"
      value={mode}
      onChange={(event) =>
        void updateSetting({
          key: "transportMode",
          value: event.target.value as TransportMode,
        })
      }
      className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[12px] text-[var(--color-text-primary)]"
    >
      {TRANSPORT_MODES.map((option) => (
        <option key={option} value={option}>
          {TRANSPORT_LABELS[option]}
        </option>
      ))}
    </select>
  );
}

const HEADING =
  "mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase";

/** What a person planning a trip needs from the road data. */
export function RoadSummary({
  ownerType,
  ownerId,
  units,
  pointCount,
}: {
  ownerType: AttributeOwnerType;
  ownerId: string;
  units: UnitSystem;
  pointCount: number;
}): ReactNode {
  const road = useRoadData(ownerType, ownerId, pointCount, true);
  const openDialog = useUiStore((s) => s.openDialog);
  const { status, available, local, posted, recorded, provenance, busy } = road;

  const straight =
    ownerType === "route" &&
    provenance !== undefined &&
    provenance.routingProvider === null;

  return (
    <section aria-label="Roads" className="mb-3">
      {!available && (
        <div className="mb-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-2">
          {/*
            Each state gets the action that actually resolves it. A missing map
            region is not fixed in the same place as a missing service.
          */}
          {status?.reason === "no-map-data" ? (
            <>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                Speed limits and road following need map data for this area.
              </p>
              <Button
                className="mt-2"
                variant="primary"
                onClick={() => actions.openSettings()}
              >
                Add map data in Settings…
              </Button>
            </>
          ) : status?.reason === "no-engine" ? (
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              This build is missing its routing engine, so road data is
              unavailable. Nothing in Settings will fix it; the app needs
              rebuilding.
            </p>
          ) : (
            <>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                {status?.message ??
                  "Road data is off. Routes stay as the straight lines you draw."}
              </p>
              <Button
                className="mt-2"
                onClick={() => openDialog({ kind: "settings" })}
              >
                Open Settings
              </Button>
            </>
          )}
        </div>
      )}

      {straight && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Drawn as straight lines.
          </p>
          {available && (
            <Button
              disabled={busy || pointCount < 2}
              onClick={() => void actions.snapRoute(ownerId)}
              title={
                pointCount < 2
                  ? "A route needs at least two points before it can follow roads."
                  : `Replaces the straight lines between your ${pointCount} points with roads. Your points are kept.`
              }
            >
              {busy ? "Working…" : "Follow roads"}
            </Button>
          )}
        </div>
      )}

      {/*
        Problems stay in the panel, not behind Details. A route snapped against
        a map region that does not reach it is wrong until it is fixed. ADR 0016.
      */}
      {provenance !== undefined && provenance.displaced.length > 0 && (
        <p
          role="note"
          className="mb-2 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-1.5 py-1 text-[11px] text-[var(--color-text-primary)]"
        >
          {provenance.displaced.length} point
          {provenance.displaced.length === 1 ? " is" : "s are"} outside the
          loaded map area, so part of this route is a straight line. Add the
          regions it crosses in Settings.
        </p>
      )}
      {provenance !== undefined &&
        provenance.displaced.length === 0 &&
        provenance.unmatchedLegs.length > 0 && (
          <p className="mb-2 text-[11px] text-[var(--color-danger)]">
            {provenance.unmatchedLegs.length} section
            {provenance.unmatchedLegs.length === 1 ? " has" : "s have"} no road
            and {provenance.unmatchedLegs.length === 1 ? "is" : "are"} drawn as
            a dashed red line.
          </p>
        )}

      {available && (
        <div>
          <h3 className={HEADING}>Speed limits</h3>
          {posted != null ? (
            <SpeedDistributionBar
              compact
              distribution={posted.distribution}
              units={units}
              fetchedAt={posted.status?.fetchedAt ?? null}
              provider={posted.status?.provider ?? null}
              stale={posted.status?.stale === true}
            />
          ) : busy ? (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Reading the roads…
            </p>
          ) : road.failed ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                The roads here could not be read.
              </p>
              <Button onClick={road.retry}>Try again</Button>
            </div>
          ) : local ? (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              {pointCount < 2 ? "Needs at least two points." : "Reading the roads…"}
            </p>
          ) : (
            // A remote service: contacted only when the user asks.
            <Button
              onClick={() => void actions.matchRoads(ownerType, ownerId)}
              title={`Sends this ${ownerType} to ${status?.origin ?? "the routing service"} to read its speed limits.`}
            >
              Look up speed limits
            </Button>
          )}
        </div>
      )}

      {/* Recorded speed, tracks only, never merged with the posted limits. */}
      {ownerType === "track" && recorded != null && (
        <div className="mt-3">
          <h3 className={HEADING}>Recorded speed</h3>
          <SpeedDistributionBar
            compact
            distribution={recorded.distribution}
            units={units}
            fetchedAt={null}
            provider={null}
            stale={false}
          />
        </div>
      )}
    </section>
  );
}

/** The technical side: engine, provenance, the full band tables, refresh. */
export function RoadDetails({
  ownerType,
  ownerId,
  units,
  pointCount,
}: {
  ownerType: AttributeOwnerType;
  ownerId: string;
  units: UnitSystem;
  pointCount: number;
}): ReactNode {
  const road = useRoadData(ownerType, ownerId, pointCount, false);
  const { status, available, attributes, posted, recorded, provenance, busy } =
    road;

  return (
    <section aria-label="Road data details">
      <h3 className={HEADING}>Road data</h3>

      <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
        {!available
          ? (status?.message ?? "No routing engine or service is available.")
          : status?.kind === "embedded"
            ? `Built-in engine${status.engineVersion === null ? "" : ` (Valhalla ${status.engineVersion})`} — runs on this machine, nothing is sent anywhere.`
            : `Remote service at ${status?.origin ?? "a configured host"}.`}
      </p>

      {ownerType === "route" && provenance !== undefined && (
        <div className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
          {provenance.routingProvider === null ? (
            <p>Hand-drawn: straight lines between the points you placed.</p>
          ) : (
            <p>
              Follows roads for{" "}
              {provenance.transportMode === null
                ? "an unknown mode"
                : (
                    TRANSPORT_LABELS[provenance.transportMode as TransportMode] ??
                    provenance.transportMode
                  ).toLowerCase()}
              , made with {provenance.routingProvider} on{" "}
              {formatTimestamp(provenance.snappedAt)} from{" "}
              {provenance.controlPointCount} control points.
            </p>
          )}
          {provenance.displaced.length > 0 && (
            <p className="mt-1">
              {provenance.displaced.length} point
              {provenance.displaced.length === 1 ? "" : "s"} had no road nearby —
              the furthest was{" "}
              {(
                Math.max(...provenance.displaced.map((d) => d.displacementM)) /
                1000
              ).toFixed(1)}{" "}
              km from the nearest road in the loaded map region. Those sections
              were left straight.
            </p>
          )}
          {provenance.unmatchedLegs.length > 0 && (
            <p className="mt-1">
              {provenance.unmatchedLegs.length} section
              {provenance.unmatchedLegs.length === 1 ? "" : "s"} had no road
              route and remain straight lines.
            </p>
          )}
        </div>
      )}

      {ownerType === "track" && (
        <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
          A recording is measured data, so a track is never moved onto a road.
          Reading road data leaves every sample where it is.
        </p>
      )}

      {available && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button
            disabled={busy || pointCount < 2}
            onClick={() =>
              void actions.matchRoads(ownerType, ownerId, { force: true })
            }
          >
            {busy ? "Reading…" : "Read road data again"}
          </Button>
          {attributes != null && (
            <Button
              disabled={busy}
              onClick={() => void actions.clearRoadAttributes(ownerType, ownerId)}
            >
              Clear road data
            </Button>
          )}
        </div>
      )}

      <h4 className="mb-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">
        Posted speed limits
      </h4>
      {posted == null ? (
        <p className="text-[12px] text-[var(--color-text-muted)]">
          {available ? "Not read yet." : "Needs a routing engine to read."}
        </p>
      ) : (
        <SpeedDistributionBar
          distribution={posted.distribution}
          units={units}
          fetchedAt={posted.status?.fetchedAt ?? null}
          provider={posted.status?.provider ?? null}
          stale={posted.status?.stale === true}
        />
      )}

      {ownerType === "track" && (
        <div className="mt-3">
          <h4 className="mb-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">
            Recorded speed
          </h4>
          {recorded == null ? (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              This recording has no timestamps, so no speed can be derived from
              it. That is different from the speeds being unknown.
            </p>
          ) : (
            <SpeedDistributionBar
              distribution={recorded.distribution}
              units={units}
              fetchedAt={null}
              provider={null}
              stale={false}
            />
          )}
          {/*
            The two series are never combined. Said out loud, because a reader
            looking at two bars will otherwise wonder why they do not agree.
          */}
          {posted != null && recorded != null && (
            <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
              These two are separate measurements and are never combined. The
              first is what the road data says the limit is; the second is how
              fast the recording actually moved.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
