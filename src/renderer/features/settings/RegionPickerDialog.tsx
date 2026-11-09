import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  RegionCandidate,
  RegionJobProgress,
  RegionMapEntry,
} from "@shared/routing/results";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import * as actions from "../../lib/actions";
import { api, callOr, describeError } from "../../lib/client";
import { getMapInstance } from "../map/mapInstance";
import { useRoutingStore } from "../../stores/routingStore";
import { RegionMap } from "./RegionMap";

/**
 * Picks the map regions the routing engine is built from.
 *
 * Two tabs. **United Kingdom** is a county map where any number of regions can
 * be selected; they are merged into one graph (ADR 0018). **Elsewhere** is the
 * view-based list from Phase 4, for places the map does not cover.
 *
 * The alternative either replaces is asking the user to understand
 * OpenStreetMap distribution: find Geofabrik, work out which of 554 nested
 * extracts covers where they want to ride, download it by hand, then find the
 * file again. Here they click on counties and see real sizes.
 */

/** Matches `MAX_REGION_BYTES` in the main process, so the limit is stated before asking. */
const MAX_SELECTION_BYTES = 2 * 1024 ** 3;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "size unknown";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function progressLine(job: RegionJobProgress | null): string | null {
  if (job === null) return null;
  switch (job.phase) {
    case "downloading": {
      const which =
        job.regionCount !== null &&
        job.regionCount !== undefined &&
        job.regionCount > 1
          ? ` ${job.regionName ?? "region"} (${job.regionIndex ?? 1} of ${job.regionCount})`
          : job.regionName === null || job.regionName === undefined
            ? ""
            : ` ${job.regionName}`;
      const received = formatBytes(job.receivedBytes);
      return job.totalBytes === null
        ? `Downloading${which}… ${received}`
        : `Downloading${which}… ${received} of ${formatBytes(job.totalBytes)}`;
    }
    case "merging":
      return "Combining the regions into one map…";
    case "building":
      return `Building the routing graph… ${job.stage ?? ""}`.trim();
    case "terrain":
      return `Downloading terrain heights… ${job.tilesDone ?? 0} of ${job.tileCount ?? 0} tiles`;
    default:
      return null;
  }
}

export function RegionPickerDialog({
  onClose,
}: {
  onClose: () => void;
}): ReactNode {
  const [tab, setTab] = useState<"uk" | "elsewhere">("uk");
  const importing = useRoutingStore((s) => s.regionImporting);
  const job = useRoutingStore((s) => s.regionJob);

  // The UK tab's state lives here so switching tabs does not lose a selection.
  const [regions, setRegions] = useState<RegionMapEntry[] | null>(null);
  const [mapFailed, setMapFailed] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sizes, setSizes] = useState<ReadonlyMap<string, number | null>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void callOr(api().routing.regionMap(), null)
      .then((result) => {
        if (cancelled) return;
        if (result === null) {
          setMapFailed(
            "The list of downloadable regions could not be fetched. Check your connection, or import a .osm.pbf file instead.",
          );
          return;
        }
        setRegions(result);
        // What is loaded now starts selected, so adding a county is one click.
        setSelected(new Set(result.filter((r) => r.loaded).map((r) => r.id)));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setMapFailed(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sizes for whatever is selected and not yet sized. The main process caches
  // them, so re-asking after a deselect costs nothing.
  const unsized = useMemo(
    () => [...selected].filter((id) => !sizes.has(id)),
    [selected, sizes],
  );
  useEffect(() => {
    if (unsized.length === 0) return;
    let cancelled = false;
    void callOr(api().routing.regionSizes({ regionIds: unsized }), null).then(
      (result) => {
        if (cancelled || result === null) return;
        setSizes((current) => {
          const next = new Map(current);
          for (const entry of result) next.set(entry.id, entry.sizeBytes);
          return next;
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [unsized]);

  const chosen = useMemo(
    () => (regions ?? []).filter((region) => selected.has(region.id)),
    [regions, selected],
  );
  const totalBytes = chosen.reduce((sum, r) => sum + (sizes.get(r.id) ?? 0), 0);
  const anyUnknown = chosen.some((r) => !sizes.has(r.id) || sizes.get(r.id) === null);
  const tooLarge = totalBytes > MAX_SELECTION_BYTES;
  const unchanged =
    chosen.length > 0 &&
    chosen.every((r) => r.loaded) &&
    chosen.length === (regions ?? []).filter((r) => r.loaded).length;

  const toggle = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const line = progressLine(job);

  return (
    <Dialog
      title="Map regions for road routing"
      width={tab === "uk" ? 820 : 560}
      onClose={onClose}
      footer={
        tab === "uk" ? (
          <>
            <Button onClick={onClose} disabled={importing}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={chosen.length === 0 || importing || tooLarge || unchanged}
              onClick={() =>
                void actions.downloadRoutingRegions(
                  chosen.map((r) => r.id),
                  onClose,
                )
              }
            >
              {importing
                ? "Working…"
                : chosen.length > 1
                  ? `Download and build ${chosen.length} regions`
                  : "Download and build"}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="mb-3 flex gap-1" role="tablist" aria-label="Where">
        {(
          [
            ["uk", "United Kingdom"],
            ["elsewhere", "Elsewhere"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1 text-[12px] ${
              tab === id
                ? "bg-[var(--color-surface-sunken)] font-semibold text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "uk" && (
        <>
          {mapFailed !== null && <FetchFailed message={mapFailed} />}
          {mapFailed === null && regions === null && (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Loading the regions…
            </p>
          )}
          {regions !== null && (
            <div className="flex gap-4">
              <div className="w-[440px] shrink-0">
                <RegionMap
                  regions={regions}
                  selected={selected}
                  disabled={importing}
                  onToggle={toggle}
                />
              </div>

              <div className="min-w-0 flex-1 text-[12px]">
                <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
                  Selected
                </h3>
                {chosen.length === 0 ? (
                  <p className="text-[var(--color-text-secondary)]">
                    Nothing yet. Click the counties you ride in; neighbouring
                    ones are combined into one map so routes can cross between
                    them.
                  </p>
                ) : (
                  <ul aria-label="Selected regions" className="mb-2 max-h-[260px] overflow-y-auto">
                    {chosen.map((region) => (
                      <li
                        key={region.id}
                        className="flex items-baseline justify-between gap-2 py-0.5"
                      >
                        <span className="min-w-0 text-[var(--color-text-primary)]">
                          {region.name}
                          {region.loaded && (
                            <span className="ml-1 text-[11px] text-[var(--color-text-muted)]">
                              loaded
                            </span>
                          )}
                          {region.note !== null && (
                            <span className="block text-[11px] text-[var(--color-text-secondary)]">
                              {region.note}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-[var(--color-text-secondary)]">
                          {sizes.has(region.id)
                            ? formatBytes(sizes.get(region.id) ?? null)
                            : "…"}
                          <button
                            type="button"
                            aria-label={`Remove ${region.name}`}
                            disabled={importing}
                            onClick={() => toggle(region.id)}
                            className="rounded px-1 text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)]"
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {chosen.length > 0 && (
                  <p
                    role="status"
                    className={`mb-2 font-medium ${
                      tooLarge
                        ? "text-[var(--color-danger)]"
                        : "text-[var(--color-text-primary)]"
                    }`}
                  >
                    {chosen.length} region{chosen.length === 1 ? "" : "s"} ·{" "}
                    {anyUnknown && totalBytes === 0
                      ? "size unknown"
                      : `${anyUnknown ? "at least " : ""}${formatBytes(totalBytes)} to download`}
                    {tooLarge &&
                      " — over the 2 GB TrailRT can build at once. Choose fewer regions."}
                  </p>
                )}

                {/* Requirement 1.11: what pressing the button actually does. */}
                <p className="mb-1 text-[11px] text-[var(--color-text-secondary)]">
                  The selection replaces the map that is loaded now. Every
                  selected region is downloaded again, because downloads are not
                  kept once the map is built.
                </p>
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  Terrain heights for route profiles are downloaded with it. After
                  that, routing works offline.
                </p>

                {line !== null && (
                  <p role="status" className="mt-3 text-[12px] text-[var(--color-text-primary)]">
                    {line}
                    <span className="ml-2 text-[11px] text-[var(--color-text-muted)]">
                      You can keep using the rest of the app.
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "elsewhere" && <ElsewhereList onClose={onClose} />}
    </Dialog>
  );
}

function FetchFailed({ message }: { message: string }): ReactNode {
  return (
    <div className="mb-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-2">
      <p className="text-[12px] text-[var(--color-danger)]">{message}</p>
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
        You can still import a <code>.osm.pbf</code> you downloaded yourself.
      </p>
      <div className="mt-2">
        <Button onClick={() => void actions.importRoutingRegion()}>
          Import a file instead…
        </Button>
      </div>
    </div>
  );
}

/**
 * The Phase 4 picker: extracts covering the visible map, most specific first.
 *
 * Ranked by the centre of the view. A region that does not cover the whole
 * visible area is still offered, labelled as such — for a view spanning a
 * border the honest choice is between "the country you are looking at" and
 * "the bundle covering both", and only the user knows which they meant.
 */
function ElsewhereList({ onClose }: { onClose: () => void }): ReactNode {
  const [candidates, setCandidates] = useState<RegionCandidate[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  const importing = useRoutingStore((s) => s.regionImporting);
  const job = useRoutingStore((s) => s.regionJob);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const map = getMapInstance();
      if (map === null) {
        if (!cancelled) setFailed("The map is not ready yet.");
        return;
      }

      // Leaflet already has the bounds; re-deriving them in the main process
      // from a zoom level would need the viewport's pixel size too.
      const bounds = map.getBounds();
      const result = await callOr(
        api().routing.suggestRegions({
          minLat: bounds.getSouth(),
          minLon: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLon: bounds.getEast(),
        }),
        null,
      );

      if (cancelled) return;
      if (result === null) {
        setFailed(
          "The list of downloadable regions could not be fetched. Check your connection, or import a .osm.pbf file instead.",
        );
        return;
      }

      setCandidates(result);
      /*
       * Pre-select the most specific region that covers everything visible and
       * is small enough to build; failing that, the most specific usable one.
       * Coverage alone is the wrong default: the region covering a zoomed-out
       * view is often a multi-gigabyte continent bundle.
       */
      const usable = result.filter((c) => !c.tooLarge);
      setChosen((usable.find((c) => c.coversViewport) ?? usable[0])?.id ?? null);
    })().catch((cause: unknown) => {
      if (!cancelled) setFailed(describeError(cause));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const line = progressLine(job);

  return (
    <div>
      <p className="mb-3 text-[12px] text-[var(--color-text-secondary)]">
        For places outside the UK: these extracts cover the area you are looking
        at on the map, most specific first.
      </p>

      {failed !== null && <FetchFailed message={failed} />}

      {failed === null && candidates === null && (
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Looking up regions for the visible area…
        </p>
      )}

      {candidates !== null && (
        <ul className="mb-2">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <label
                className={`flex items-start gap-2 rounded-md px-2 py-2 ${
                  candidate.tooLarge ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                } ${chosen === candidate.id ? "bg-[var(--color-surface-sunken)]" : ""}`}
              >
                <input
                  type="radio"
                  name="region"
                  className="mt-1"
                  checked={chosen === candidate.id}
                  disabled={importing || candidate.tooLarge}
                  onChange={() => setChosen(candidate.id)}
                />
                <span className="flex-1">
                  <span className="text-[13px] text-[var(--color-text-primary)]">
                    {candidate.name}
                  </span>
                  <span className="ml-2 text-[12px] text-[var(--color-text-secondary)]">
                    {formatBytes(candidate.sizeBytes)}
                  </span>
                  <span className="block text-[11px] text-[var(--color-text-muted)]">
                    {candidate.tooLarge
                      ? "Too large to build — zoom in and choose a smaller region"
                      : candidate.coversViewport
                        ? "Covers everything you can see"
                        : "Smaller than your current view — routing stops at its edge"}
                    {candidate.sizeBytes !== null &&
                      candidate.sizeBytes > 400 * 1024 ** 2 &&
                      " · large, expect several minutes to build"}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onClose} disabled={importing}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={chosen === null || importing}
          onClick={() => {
            if (chosen === null) return;
            void actions.downloadRoutingRegions([chosen], onClose);
          }}
        >
          {importing ? "Working…" : "Download and build"}
        </Button>
      </div>

      {line !== null && (
        <p role="status" className="mt-2 text-[12px] text-[var(--color-text-primary)]">
          {line}
          <span className="ml-2 text-[11px] text-[var(--color-text-muted)]">
            You can keep using the rest of the app.
          </span>
        </p>
      )}
    </div>
  );
}
