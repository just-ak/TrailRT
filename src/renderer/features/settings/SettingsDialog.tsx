import { useEffect, useState, type ReactNode } from "react";
import { MAP_OVERLAYS, MAP_PROVIDERS } from "@shared/map/MapProvider";
import { checkRoutingOrigin } from "@shared/net/origin";
import {
  TRANSPORT_MODES,
  type TransportMode,
} from "@shared/routing/RoutingProvider";
import type { ConnectionTest, ConsentNotice } from "@shared/routing/results";
import type { ThemePreference, UnitSystem } from "@shared/domain/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import * as actions from "../../lib/actions";
import { api, callOr } from "../../lib/client";
import { useRoutingStore } from "../../stores/routingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { PlaceDataStatus, PostcodeSection } from "./PlaceDataSettings";

const TRANSPORT_LABELS: Record<TransportMode, string> = {
  auto: "Car",
  motorcycle: "Motorcycle",
  bicycle: "Bicycle",
  pedestrian: "Walking",
};

/** Settings apply immediately and persist on change. No restart, no OK button. */
/**
 * Map data for the built-in engine, in a section of its own.
 *
 * Separated from Road routing because it is a different kind of thing: road
 * routing is a handful of preferences, while this is a download measured in
 * hundreds of megabytes that the engine cannot work without. Burying it under
 * a routing heading made the one prerequisite look like an option.
 */
function MapRegionSection(): ReactNode {
  const region = useRoutingStore((s) => s.region);
  const regionImporting = useRoutingStore((s) => s.regionImporting);
  const regionProgress = useRoutingStore((s) => s.regionProgress);

  const labelClass = "text-[13px] text-[var(--color-text-primary)]";
  const hintClass = "text-[11px] text-[var(--color-text-muted)]";

  return (
    <section aria-labelledby="map-regions-heading" className="mb-3">
      <h3
        id="map-regions-heading"
        className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
      >
        Map regions
      </h3>
      <p className={`${hintClass} mb-2`}>
        The road data the built-in engine routes on. Without it, routes stay as
        the straight lines you draw.
      </p>
      {/* --- the built-in engine's map region */}
      <div className="mb-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-3">
        <p className={labelClass}>Map regions</p>
        {region === null ? (
          <p className={`${hintClass} mb-2`}>
            No regions loaded. Choose the counties you ride in on a map of the
            UK, or any region elsewhere. Several are combined into one map so
            routes can cross between them. A county is typically 20–60 MB and
            builds in under a minute.
          </p>
        ) : (
          <p className={`${hintClass} mb-2`}>
            <strong>{region.regionName}</strong> ·{" "}
            {region.tileCount.toLocaleString()} tiles ·{" "}
            {(region.graphBytes / 1024 ** 2).toFixed(0)} MB · built{" "}
            {new Date(region.builtAt).toLocaleDateString()}
          </p>
        )}

        {regionImporting ? (
          <p
            role="status"
            className="text-[12px] text-[var(--color-text-primary)]"
          >
            {regionProgress?.stage ?? "Starting…"}
            <span className={`${hintClass} ml-2`}>
              This can take a few minutes. You can keep using the rest of the
              app.
            </span>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={region === null ? "primary" : "default"}
              onClick={() => actions.openRegionPicker()}
            >
              {region === null ? "Choose map regions…" : "Change regions…"}
            </Button>
            {/* The manual path stays: Geofabrik granularity stops at published
                regions, so anyone wanting a custom extract still needs it. */}
            <Button onClick={() => void actions.importRoutingRegion()}>
              Import a .osm.pbf…
            </Button>
          </div>
        )}

        {region !== null && !regionImporting && (
          /* One map at a time, said out loud: a new selection rebuilds it,
             and importing a file replaces it. A user expecting an import to
             add to what is there would otherwise quietly lose it. ADR 0018. */
          <p className={`${hintClass} mt-1`}>
            Changing regions rebuilds the map from the new selection. Importing a
            file replaces it.
          </p>
        )}
        {!regionImporting && <PlaceDataStatus />}
      </div>
    </section>
  );
}

export function SettingsDialog(): ReactNode {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.set);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const setTheme = useUiStore((s) => s.setTheme);

  const rowClass = "flex items-center justify-between gap-4 py-2";
  const labelClass = "text-[13px] text-[var(--color-text-primary)]";
  const hintClass = "text-[11px] text-[var(--color-text-muted)]";
  const controlClass =
    "rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)]";

  return (
    <Dialog
      title="Settings"
      width={520}
      onClose={closeDialog}
      footer={
        <Button variant="primary" onClick={closeDialog}>
          Done
        </Button>
      }
    >
      <div className={rowClass}>
        <div>
          <p className={labelClass}>Appearance</p>
          <p className={hintClass}>Follow the system, or pick one.</p>
        </div>
        <select
          aria-label="Appearance"
          value={settings.theme}
          onChange={(event) => {
            const theme = event.target.value as ThemePreference;
            setTheme(theme);
            void update({ key: "theme", value: theme });
          }}
          className={controlClass}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Units</p>
          <p className={hintClass}>
            Display only — distances are always stored in metres.
          </p>
        </div>
        <select
          aria-label="Units"
          value={settings.units}
          onChange={(event) =>
            void update({
              key: "units",
              value: event.target.value as UnitSystem,
            })
          }
          className={controlClass}
        >
          <option value="metric">Metric (km, m)</option>
          <option value="imperial">Imperial (mi, ft)</option>
        </select>
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Base map</p>
          <p className={hintClass}>
            OpenTopoMap stops at zoom 17; the app will not request past it.
          </p>
        </div>
        <select
          aria-label="Base map"
          value={settings.mapProviderId}
          onChange={(event) =>
            void update({ key: "mapProviderId", value: event.target.value })
          }
          className={controlClass}
        >
          {MAP_PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Overlay</p>
          <p className={hintClass}>
            Chosen independently of the base map. Only a user-supplied overlay
            ships — no third-party overlay service has been vetted.
          </p>
        </div>
        <select
          aria-label="Overlay"
          value={settings.mapOverlayId}
          onChange={(event) =>
            void update({ key: "mapOverlayId", value: event.target.value })
          }
          className={controlClass}
        >
          <option value="">None</option>
          {MAP_OVERLAYS.map((overlay) => (
            <option key={overlay.id} value={overlay.id}>
              {overlay.name}
            </option>
          ))}
        </select>
      </div>

      <div className="py-2">
        <p className={labelClass}>Custom tile URL</p>
        <p className={`${hintClass} mb-1`}>
          A Leaflet template with <code>{"{z}/{x}/{y}"}</code> placeholders.
          Used when “Custom tile source” is the base map. A local tile server or
          a <code>file://</code> directory works here.
        </p>
        <input
          type="text"
          aria-label="Custom tile URL"
          spellCheck={false}
          placeholder="https://tiles.example.org/{z}/{x}/{y}.png"
          value={settings.customTileUrl}
          onChange={(event) =>
            void update({ key: "customTileUrl", value: event.target.value })
          }
          className={`${controlClass} w-full font-mono text-[12px]`}
        />
      </div>

      <div className="py-2">
        <p className={labelClass}>Custom overlay URL</p>
        <input
          type="text"
          aria-label="Custom overlay URL"
          spellCheck={false}
          placeholder="https://overlay.example.org/{z}/{x}/{y}.png"
          value={settings.customOverlayUrl}
          onChange={(event) =>
            void update({ key: "customOverlayUrl", value: event.target.value })
          }
          className={`${controlClass} w-full font-mono text-[12px]`}
        />
      </div>

      <div className="my-3 h-px bg-[var(--color-border-subtle)]" />

      {/*
        Above Road routing on purpose: the engine cannot do anything without
        map data, so the prerequisite comes before the preferences.
      */}
      <MapRegionSection />
      <PostcodeSection />
      <RoutingSettings />

      <div className="my-3 h-px bg-[var(--color-border-subtle)]" />

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Automatic backup</p>
          <p className={hintClass}>How often a snapshot is taken.</p>
        </div>
        <select
          aria-label="Backup interval"
          value={settings.backupIntervalHours}
          onChange={(event) =>
            void update({
              key: "backupIntervalHours",
              value: Number(event.target.value),
            })
          }
          className={controlClass}
        >
          <option value={6}>Every 6 hours</option>
          <option value={12}>Every 12 hours</option>
          <option value={24}>Daily</option>
          <option value={168}>Weekly</option>
        </select>
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Backups kept</p>
          <p className={hintClass}>Older snapshots are pruned automatically.</p>
        </div>
        <input
          type="number"
          aria-label="Backups kept"
          min={1}
          max={100}
          value={settings.backupRetention}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 1 && value <= 100) {
              void update({ key: "backupRetention", value });
            }
          }}
          className={`${controlClass} w-20`}
        />
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Planning speed</p>
          <p className={hintClass}>
            Used for route duration estimates, and labelled as an estimate.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            aria-label="Planning speed in km/h"
            min={0.5}
            max={100}
            step={0.5}
            value={settings.planningSpeedKmh}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0.5 && value <= 100) {
                void update({ key: "planningSpeedKmh", value });
              }
            }}
            className={`${controlClass} w-20`}
          />
          <span className={hintClass}>km/h</span>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Routing service configuration and consent.
 *
 * Three things this section has to do honestly, all of them Requirement 12:
 *
 * 1. **Default to nothing.** No endpoint ships. The application is complete
 *    without one, and the copy says so rather than presenting an empty field as
 *    a missing step.
 * 2. **Validate as you type, with the real reason.** The endpoint goes through
 *    the same `checkRoutingOrigin` the main process uses for the CSP and for
 *    every request, so the message here is the message that would be enforced.
 * 3. **Ask before transmitting, naming the host.** Consent is per host and is
 *    withdrawn automatically when the endpoint changes, so the checkbox below
 *    always refers to the host shown above it.
 */
function RoutingSettings(): ReactNode {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.set);
  const loadStatus = useRoutingStore((s) => s.loadStatus);
  const status = useRoutingStore((s) => s.status);
  // The map-region state moved to `MapRegionSection`; this section is now
  // only the remote-service configuration and the transport preference.

  /*
   * A local draft of the endpoint, committed on blur.
   *
   * Writing on every keystroke would persist half-typed URLs, each one
   * rebuilding the CSP, and would withdraw consent the moment the first
   * character of an edit landed.
   *
   * `null` means "no edit in progress, show the stored value". That sentinel
   * replaces what would otherwise be an effect copying settings into state,
   * which starts a second render for a value already available in the first.
   */
  const [edit, setEdit] = useState<string | null>(null);
  const [notice, setNotice] = useState<ConsentNotice | null>(null);
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [testing, setTesting] = useState(false);
  const draft = edit ?? settings.routingEndpoint;

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    let cancelled = false;
    const endpoint = settings.routingEndpoint;

    // The empty case resolves through the same async path rather than calling
    // setState synchronously, which would start another render inside the
    // effect for nothing.
    void (async () => {
      const result =
        endpoint.trim().length === 0
          ? null
          : await callOr(api().routing.consentNotice({ endpoint }), null);
      if (!cancelled) setNotice(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [settings.routingEndpoint]);

  const check = checkRoutingOrigin(draft);
  const draftEmpty = draft.trim().length === 0;
  const draftInvalid = !draftEmpty && !check.ok;

  /**
   * Persists a routing setting and refreshes the derived status.
   *
   * Re-read here rather than in an effect keyed on the settings, because the
   * status is a consequence of this write and nothing else changes it.
   */
  const applyRouting = async (
    request: Parameters<typeof update>[0],
  ): Promise<void> => {
    await update(request);
    await loadStatus();
  };

  /**
   * Tests the address in the field, saved or not.
   *
   * Uses `draft` rather than the stored value so a pasted endpoint can be
   * checked before committing it — which is the order a careful user works in.
   */
  const runTest = async (): Promise<void> => {
    setTesting(true);
    try {
      const result = await callOr(
        api().routing.test({ endpoint: draft.trim() }),
        null,
      );
      setTest(
        result ?? {
          ok: false,
          origin: null,
          elapsedMs: null,
          pointCount: null,
          message: "The test could not be run.",
        },
      );
    } finally {
      setTesting(false);
    }
  };

  const commit = (): void => {
    if (edit === null) return;
    const value = draft.trim();
    setEdit(null);
    // A result for the previous address would be misleading next to a new one.
    setTest(null);
    if (value === settings.routingEndpoint) return;
    // Refused locally rather than sent and rejected: the schema would reject it
    // too, and a round trip to be told the same thing is just slower.
    if (draftInvalid) return;
    void applyRouting({ key: "routingEndpoint", value });
  };

  const rowClass = "flex items-center justify-between gap-4 py-2";
  const labelClass = "text-[13px] text-[var(--color-text-primary)]";
  const hintClass = "text-[11px] text-[var(--color-text-muted)]";
  const controlClass =
    "rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)]";

  return (
    <section aria-labelledby="routing-heading">
      <h3
        id="routing-heading"
        className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
      >
        Road routing
      </h3>
      <p className={`${hintClass} mb-2`}>
        A routing engine is built into TrailRT and runs on this machine, and
        nothing is sent anywhere. It needs map data to work from, which lives in{" "}
        <strong>Map regions</strong> above. A remote service is optional, for
        anyone who already runs one.
      </p>

      <div className="py-2">
        <p className={labelClass}>Remote routing service (optional)</p>
        <p className={`${hintClass} mb-1`}>
          Leave empty to use the built-in engine. Setting an address here
          overrides it — a deliberate choice is respected rather than ignored.
          <strong> https</strong> anywhere; plain <strong>http</strong> only for
          a service on this machine.
        </p>
        <p className={`${hintClass} mb-1`}>
          To try it without running anything, use the public demo instance{" "}
          <code>https://valhalla1.openstreetmap.de</code>. Note the{" "}
          <strong>1</strong>: the address without it is the demo website, not
          the API, and returns an error. The demo is rate-limited to about one
          request a second and is not for routine use — self-host for that.
        </p>
        <input
          type="text"
          aria-label="Routing endpoint"
          aria-invalid={draftInvalid}
          spellCheck={false}
          placeholder="http://localhost:8002"
          value={draft}
          onChange={(event) => setEdit(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            // Abandons the edit and falls back to the stored value.
            if (event.key === "Escape") setEdit(null);
          }}
          className={`${controlClass} w-full font-mono text-[12px] ${
            draftInvalid ? "border-[var(--color-danger)]" : ""
          }`}
        />
        {draftInvalid && (
          <p
            role="alert"
            className="mt-1 text-[11px] text-[var(--color-danger)]"
          >
            {check.message}
          </p>
        )}
        {!draftInvalid && !draftEmpty && check.origin !== null && (
          <p className={`${hintClass} mt-1`}>
            Requests would go to <code>{check.origin}</code>, and that is the
            only outbound host the app is allowed to contact.
          </p>
        )}

        <div className="mt-2 flex items-start gap-2">
          <Button
            disabled={draftEmpty || draftInvalid || testing}
            onClick={() => void runTest()}
            title="Routes between two fixed sample points in Switzerland. Sends none of your routes."
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {/*
            Spelled out next to the button, because a control that makes a
            network request has to say what it sends before it is pressed, not
            after. This is the one routing call not gated on consent, and that
            is only defensible while it genuinely carries nothing of the user's.
          */}
          <p className={`${hintClass} flex-1`}>
            Routes two fixed sample points to check the address. Sends none of
            your routes, so you can check a host before trusting it with them.
          </p>
        </div>

        {test !== null && (
          <p
            role="status"
            className={`mt-1 text-[11px] ${
              test.ok
                ? "text-[var(--color-text-secondary)]"
                : "text-[var(--color-danger)]"
            }`}
          >
            {test.message}
          </p>
        )}
      </div>

      {notice !== null && (
        <div className="my-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={settings.routingConsentAccepted}
              onChange={(event) =>
                void applyRouting({
                  key: "routingConsentAccepted",
                  value: event.target.checked,
                })
              }
              className="mt-0.5"
            />
            <span className="text-[13px] text-[var(--color-text-primary)]">
              Send coordinates to <code>{notice.origin}</code> when I snap a
              route or look up road data.
            </span>
          </label>

          <p className={`${hintClass} mt-2 font-semibold`}>What is sent</p>
          <ul className={`${hintClass} list-disc pl-4`}>
            {notice.transmits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <p className={`${hintClass} mt-2 font-semibold`}>What is not sent</p>
          <ul className={`${hintClass} list-disc pl-4`}>
            {notice.withholds.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <p className={`${hintClass} mt-2`}>
            Changing the endpoint withdraws this automatically — agreeing to one
            host is not agreeing to the next.
          </p>
        </div>
      )}

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Transport mode</p>
          <p className={hintClass}>
            Which roads a snapped route is allowed to use.
          </p>
        </div>
        <select
          aria-label="Transport mode"
          value={settings.transportMode}
          onChange={(event) =>
            void applyRouting({
              key: "transportMode",
              value: event.target.value as TransportMode,
            })
          }
          className={controlClass}
        >
          {TRANSPORT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {TRANSPORT_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Show alternative routes while drawing</p>
          <p className={hintClass}>
            {status !== null && !status.capabilities.alternatives
              ? "The routing service in use cannot offer alternative routes."
              : "Each new section offers up to three routes to choose from."}
          </p>
        </div>
        <input
          type="checkbox"
          aria-label="Show alternative routes while drawing"
          checked={settings.routeAlternatives}
          disabled={status !== null && !status.capabilities.alternatives}
          onChange={(event) =>
            void applyRouting({
              key: "routeAlternatives",
              value: event.target.checked,
            })
          }
        />
      </div>

      {/* ADR 0018: assumed limits are on by default, and this is the way back
          to posted-only reporting. */}
      <div className={rowClass}>
        <div>
          <p className={labelClass}>Assume UK default speed limits</p>
          <p className={hintClass}>
            Where the map data has no posted limit, count UK roads at the national
            speed limit (30 mph on residential streets), shown hatched as
            assumed. Off counts them as Unknown.
          </p>
        </div>
        <input
          type="checkbox"
          aria-label="Assume UK default speed limits"
          checked={settings.ukDefaultSpeedLimits}
          onChange={(event) => {
            void update({
              key: "ukDefaultSpeedLimits",
              value: event.target.checked,
            }).then(() => {
              // Profiles and distributions were drawn under the old rule.
              useRoutingStore.getState().clear();
            });
          }}
        />
      </div>

      {status !== null && (
        <p className={hintClass}>
          {status.available
            ? `Ready. ${status.attribution ?? ""}`
            : (status.message ?? "")}
          {status.available && !status.endpointTested && (
            <>
              {" "}
              This address has not been tested yet in this session. Press Test
              connection to confirm it actually routes.
            </>
          )}
        </p>
      )}
    </section>
  );
}
