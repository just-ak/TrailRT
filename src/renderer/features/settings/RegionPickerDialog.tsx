import { useEffect, useState, type ReactNode } from "react";
import type { RegionCandidate } from "@shared/routing/results";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import * as actions from "../../lib/actions";
import { api, callOr, describeError } from "../../lib/client";
import { getMapInstance } from "../map/mapInstance";
import { useRoutingStore } from "../../stores/routingStore";

/**
 * Picks a downloadable map region based on what is currently on screen.
 *
 * The alternative this replaces is asking the user to understand OpenStreetMap
 * distribution: find Geofabrik, work out which of 554 nested extracts covers
 * where they want to ride, download it by hand, then find the file again. Here
 * they look at the map and choose from a short list with real sizes.
 *
 * ## Ranked by the centre of the view, and why that is shown
 *
 * The list is ordered most specific first, judged by what is at the centre of
 * the viewport. A region that does not cover the whole visible area is still
 * offered, labelled as such — because for a view spanning a border the honest
 * choice is between "the country you are looking at" and "the bundle covering
 * both", and only the user knows which they meant.
 */

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "size unknown";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function RegionPickerDialog({
  onClose,
}: {
  onClose: () => void;
}): ReactNode {
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
       *
       * Coverage alone is the wrong default: the region that covers a
       * zoomed-out view is often a multi-gigabyte continent bundle, and
       * pre-selecting it would invite a download nobody wanted.
       */
      const usable = result.filter((c) => !c.tooLarge);
      setChosen(
        (usable.find((c) => c.coversViewport) ?? usable[0])?.id ?? null,
      );
    })().catch((cause: unknown) => {
      if (!cancelled) setFailed(describeError(cause));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const progressLine = ((): string | null => {
    if (job === null) return null;
    if (job.phase === "downloading") {
      const received = formatBytes(job.receivedBytes);
      return job.totalBytes === null
        ? `Downloading… ${received}`
        : `Downloading… ${received} of ${formatBytes(job.totalBytes)}`;
    }
    return `Building the routing graph… ${job.stage ?? ""}`.trim();
  })();

  return (
    <Dialog
      title="Add a map region"
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={chosen === null || importing}
            onClick={() => {
              if (chosen === null) return;
              void actions.downloadRoutingRegion(chosen, onClose);
            }}
          >
            {importing ? "Working…" : "Download and build"}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12px] text-[var(--color-text-secondary)]">
        These extracts cover the area you are looking at, most specific first.
        The download happens once; after that routing works offline.
      </p>

      {failed !== null && (
        <div className="mb-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-2">
          <p className="text-[12px] text-[var(--color-danger)]">{failed}</p>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            You can still import a <code>.osm.pbf</code> you downloaded
            yourself.
          </p>
          <div className="mt-2">
            <Button onClick={() => void actions.importRoutingRegion()}>
              Import a file instead…
            </Button>
          </div>
        </div>
      )}

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
                  candidate.tooLarge
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer"
                } ${
                  chosen === candidate.id
                    ? "bg-[var(--color-surface-sunken)]"
                    : ""
                }`}
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
                    {/*
                      A large extract is not refused, but the cost is stated
                      before the user commits rather than discovered as a
                      progress bar that will not finish.
                    */}
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

      {progressLine !== null && (
        <p
          role="status"
          className="mt-2 text-[12px] text-[var(--color-text-primary)]"
        >
          {progressLine}
          <span className="ml-2 text-[11px] text-[var(--color-text-muted)]">
            You can keep using the rest of the app.
          </span>
        </p>
      )}
    </Dialog>
  );
}
