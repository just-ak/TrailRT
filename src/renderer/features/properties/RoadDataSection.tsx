import { useEffect, type ReactNode } from "react";
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
 * Road data for a route or track: snapping, map matching and speed shares.
 *
 * ## Nothing here fires on render
 *
 * The cached distribution and status are read on mount — both are local
 * database reads. The *provider* is only ever contacted by pressing a button.
 * Selecting a route must not cause an outbound request, because the consent the
 * user gave covers actions they take.
 *
 * ## Snapping moves routes, never tracks
 *
 * There is no snap control for a track anywhere in this component. A recording
 * is measured data and moving its samples onto a road would be falsifying it
 * (ADR 0011 §4). A track can still be *matched*, which reads road attributes
 * and leaves every sample where it was.
 */

const TRANSPORT_LABELS: Record<TransportMode, string> = {
  auto: "Car",
  motorcycle: "Motorcycle",
  bicycle: "Bicycle",
  pedestrian: "Walking",
};

export function RoadDataSection({
  ownerType,
  ownerId,
  units,
  /** Points in the current geometry, for the snap preview. */
  pointCount,
}: {
  ownerType: AttributeOwnerType;
  ownerId: string;
  units: UnitSystem;
  pointCount: number;
}): ReactNode {
  const key = routingKey(ownerType, ownerId);
  const settings = useSettingsStore((s) => s.settings);
  const updateSetting = useSettingsStore((s) => s.set);
  const openDialog = useUiStore((s) => s.openDialog);

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

  useEffect(() => {
    // All three are local reads. None of them can reach the network.
    void loadStatus();
    void loadAttributes(ownerType, ownerId);
    void loadDistribution(ownerType, ownerId, "posted");
    if (ownerType === "track") {
      void loadDistribution(ownerType, ownerId, "recorded");
    }
  }, [loadStatus, loadAttributes, loadDistribution, ownerType, ownerId]);

  const available = status?.available === true;

  return (
    <section aria-labelledby={`road-data-${ownerId}`} className="mt-4">
      <h3
        id={`road-data-${ownerId}`}
        className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
      >
        Road data
      </h3>

      {!available && (
        <div className="mb-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-2">
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            {status?.message ??
              "Road routing is unavailable. Routes stay as the straight lines you draw."}
          </p>
          {/*
            A missing map region is a different problem from a missing or
            unconsented server, and sending the user to Settings for it would
            be a dead end — there is nothing there to fix it. Each state gets
            the action that actually resolves it.
          */}
          <div className="mt-2">
            {status?.reason === "no-map-data" ? (
              /*
                Points at Settings rather than opening the picker here.
                Map data is now a section of its own there, so this is no
                longer the dead end it would have been — and one place to
                manage regions beats two entry points into the same dialog.
              */
              <Button variant="primary" onClick={() => actions.openSettings()}>
                Add map data in Settings…
              </Button>
            ) : status?.reason === "no-engine" ? (
              <p className="text-[11px] text-[var(--color-text-muted)]">
                This build is missing the routing engine. Nothing in Settings
                will fix it; the app needs rebuilding.
              </p>
            ) : (
              <Button onClick={() => openDialog({ kind: "settings" })}>
                Open Settings
              </Button>
            )}
          </div>
        </div>
      )}

      {available && (
        <>
          <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">
            {status?.kind === "embedded"
              ? `Built-in engine${status.engineVersion === null ? "" : ` (Valhalla ${status.engineVersion})`} — runs on this machine, nothing is sent anywhere.`
              : `Remote service at ${status?.origin ?? "a configured host"}.`}
          </p>
          <div className="mb-2 flex items-center justify-between gap-2">
            <label
              htmlFor={`mode-${ownerId}`}
              className="text-[12px] text-[var(--color-text-secondary)]"
            >
              Transport mode
            </label>
            <select
              id={`mode-${ownerId}`}
              value={settings.transportMode}
              onChange={(event) =>
                void updateSetting({
                  key: "transportMode",
                  value: event.target.value as TransportMode,
                })
              }
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[12px] text-[var(--color-text-primary)]"
            >
              {TRANSPORT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {TRANSPORT_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            {/*
              Only for a route that does not already follow roads: an import,
              or one drawn straight. A road-routed route re-routes itself when
              it is edited, so a button here would only invite a needless
              whole-route re-snap. ADR 0018.
            */}
            {ownerType === "route" &&
              provenance !== undefined &&
              provenance.routingProvider === null && (
              <Button
                disabled={busy || pointCount < 2}
                onClick={() => void actions.snapRoute(ownerId)}
                title={
                  pointCount < 2
                    ? "A route needs at least two points before it can be snapped."
                    : `Replaces the straight lines between your ${pointCount} points with road geometry. Your points are kept as control points.`
                }
              >
                {busy ? "Snapping…" : "Snap to roads"}
              </Button>
            )}

            <Button
              disabled={busy}
              onClick={() => void actions.matchRoads(ownerType, ownerId)}
              title={
                ownerType === "track"
                  ? "Reads speed limits and road classes along this track. The recorded points are not moved."
                  : "Reads speed limits and road classes along this route."
              }
            >
              {busy ? "Matching…" : "Look up road data"}
            </Button>

            {attributes != null && (
              <>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void actions.matchRoads(ownerType, ownerId, { force: true })
                  }
                >
                  Refresh
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void actions.clearRoadAttributes(ownerType, ownerId)
                  }
                >
                  Clear
                </Button>
              </>
            )}
          </div>

          {ownerType === "track" && (
            <p className="mb-2 text-[11px] text-[var(--color-text-secondary)]">
              A recording is measured data, so a track is never moved onto a
              road. Looking up road data reads attributes and leaves every
              sample where it is.
            </p>
          )}
        </>
      )}

      {/* --- snap provenance, route only */}
      {ownerType === "route" &&
        provenance !== undefined &&
        provenance.routingProvider !== null && (
          <div className="mb-2 text-[11px] text-[var(--color-text-secondary)]">
            <p>
              Snapped with {provenance.routingProvider} (
              {provenance.transportMode ?? "unknown mode"}) on{" "}
              {formatTimestamp(provenance.snappedAt)}, from{" "}
              {provenance.controlPointCount} control points.
            </p>
            {/*
              Reported above the unmatched-leg count, because it is the more
              serious finding. "No road between these two points" is a fact
              about the route. "No road anywhere near this point" means the
              loaded map region does not reach it, which makes the result wrong
              rather than incomplete — and the engine does not say so on its
              own. See ADR 0016.
            */}
            {provenance.displaced.length > 0 && (
              <p
                role="note"
                className="mt-1 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-1.5 py-1 text-[var(--color-text-primary)]"
              >
                {provenance.displaced.length} point
                {provenance.displaced.length === 1 ? "" : "s"} had no road
                nearby — the furthest was{" "}
                {(
                  Math.max(
                    ...provenance.displaced.map((d) => d.displacementM),
                  ) / 1000
                ).toFixed(1)}{" "}
                km from the nearest road in the loaded map region. Those
                sections were left straight. Add the regions covering your route
                in Settings, then snap again.
              </p>
            )}
            {provenance.unmatchedLegs.length > 0 && (
              <p className="mt-1 text-[var(--color-danger)]">
                {provenance.unmatchedLegs.length} section
                {provenance.unmatchedLegs.length === 1 ? "" : "s"} had no road
                route and remain straight lines. They are drawn dashed in red on
                the map.
              </p>
            )}
          </div>
        )}

      {ownerType === "route" &&
        provenance !== undefined &&
        provenance.routingProvider === null && (
          <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">
            Hand-drawn: straight lines between the points you placed.
          </p>
        )}

      {/* --- posted limits */}
      <div className="mt-3">
        <h4 className="mb-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">
          Posted speed limits
        </h4>
        {posted == null ? (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {available
              ? "Not looked up yet."
              : "Needs a routing service to look up."}
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
      </div>

      {/* --- recorded speed, tracks only, never merged with the above */}
      {ownerType === "track" && (
        <div className="mt-3">
          <h4 className="mb-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">
            Recorded speed
          </h4>
          {recorded == null ? (
            <p className="text-[11px] text-[var(--color-text-muted)]">
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
        </div>
      )}

      {/*
        The two series are never combined. Said out loud, because a reader
        looking at two bars will otherwise wonder why they do not agree — they
        measure different things.
      */}
      {ownerType === "track" && posted != null && recorded != null && (
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
          These two are separate measurements and are never combined. The first
          is what the road data says the limit is; the second is how fast the
          recording actually moved.
        </p>
      )}
    </section>
  );
}
