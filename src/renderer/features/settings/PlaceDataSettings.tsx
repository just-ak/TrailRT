import { useEffect, useState, type ReactNode } from "react";
import type { PostcodeProgress, PostcodeRelease } from "@shared/ipc/api";
import { formatDate } from "@shared/itinerary/format";
import type { PlaceDataState } from "@shared/poi/PoiProvider";
import type { SearchStatus } from "@shared/search/PlaceSearchProvider";
import { Button } from "../../components/Button";
import { api, call, callOr, describeError } from "../../lib/client";
import { useRoutingStore } from "../../stores/routingStore";

/**
 * Settings for Phase 10's offline data: the place data built with the map
 * regions, and Code-Point Open postcodes. Requirements 5.4 and 11.9.
 */

const hint = "text-[11px] text-[var(--color-text-muted)]";
const box = "mb-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-3";

/** One line under Map regions: what place data the regions carry. */
export function PlaceDataStatus(): ReactNode {
  const region = useRoutingStore((s) => s.region);
  const [state, setState] = useState<PlaceDataState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void callOr(api().places.status(), null).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
    // `region` is a trigger, not an input: a rebuilt or replaced graph means
    // the place data changed with it, so the status is read again.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [region]);

  if (state === null || state.kind === "none") return null;
  if (state.kind === "ready") {
    return (
      <p className={`${hint} mt-2`} data-testid="places-status">
        Place data: {state.poiCount.toLocaleString("en-GB")} points of interest, with place and street names, from
        OpenStreetMap data of {formatDate(state.dataDate)}
        {state.dateIsDownload ? " (download date; the file carried none)" : ""}.
      </p>
    );
  }
  return (
    <div className="mt-2" data-testid="places-status">
      <p className="text-[12px] text-[var(--color-text-primary)]">
        Place data was not built with these regions, so place search and points of interest are unavailable until they
        are rebuilt.
      </p>
      {state.canRebuild ? (
        <Button
          className="mt-1"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void call(api().places.rebuild())
              .then(async () => {
                await useRoutingStore.getState().loadRegion();
                setState(await callOr(api().places.status(), null));
              })
              .catch((cause: unknown) => setError(describeError(cause)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Rebuilding… this downloads the regions again" : "Rebuild regions"}
        </Button>
      ) : (
        <p className={hint}>These regions came from a file. Import it again to build its place data.</p>
      )}
      {error !== null && <p className="mt-1 text-[12px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

/** Code-Point Open: fetched once, on request, after its size is shown. */
export function PostcodeSection(): ReactNode {
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [offer, setOffer] = useState<PostcodeRelease | null>(null);
  const [progress, setProgress] = useState<PostcodeProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void callOr(api().search.status(), null).then(setStatus);
    return api().events.onPostcodeProgress(setProgress);
  }, []);

  const installed = status?.postcodes.kind === "ready" ? status.postcodes : null;

  const check = (): void => {
    setError(null);
    setBusy(true);
    void call(api().postcodes.listing())
      .then(setOffer)
      .catch((cause: unknown) => setError(describeError(cause)))
      .finally(() => setBusy(false));
  };

  const download = (): void => {
    setError(null);
    setBusy(true);
    setProgress(null);
    void call(api().postcodes.update())
      .then(async () => {
        setOffer(null);
        setStatus(await callOr(api().search.status(), null));
      })
      .catch((cause: unknown) => setError(describeError(cause)))
      .finally(() => {
        setBusy(false);
        setProgress(null);
      });
  };

  return (
    <section aria-labelledby="postcodes-heading" className="mb-3">
      <h3 id="postcodes-heading" className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Postcodes
      </h3>
      <p className={`${hint} mb-2`}>
        For finding a postcode on the map. Every search is answered on this computer; fetching the data is the only time
        it goes online. Great Britain only: Northern Ireland, the Isle of Man and the Channel Islands are not included.
      </p>
      <div className={box} data-testid="postcode-settings">
        {installed === null ? (
          <p className="text-[13px] text-[var(--color-text-primary)]">No postcode data yet.</p>
        ) : (
          <p className="text-[13px] text-[var(--color-text-primary)]" data-testid="postcode-status">
            Code-Point Open {installed.release}, {formatDate(installed.date)} ·{" "}
            {installed.count.toLocaleString("en-GB")} postcodes
            {installed.withoutLocation > 0 &&
              ` (${installed.withoutLocation.toLocaleString("en-GB")} have no location in the data)`}
          </p>
        )}

        {busy && progress !== null ? (
          <p role="status" className="mt-2 text-[12px] text-[var(--color-text-primary)]">
            {progress.stage === "reading"
              ? "Reading postcodes…"
              : `Downloading ${(progress.receivedBytes / 1048576).toFixed(1)} of ${(progress.totalBytes / 1048576).toFixed(1)} MB`}
            <Button variant="ghost" className="ml-2" onClick={() => void callOr(api().postcodes.cancel(), null)}>
              Cancel
            </Button>
          </p>
        ) : offer === null ? (
          <Button className="mt-2" disabled={busy} onClick={check}>
            {installed === null ? "Get postcode data…" : "Check for a newer release…"}
          </Button>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
            {installed !== null && offer.release === installed.release ? (
              <span>You have the latest release, {offer.release}.</span>
            ) : (
              <>
                <span>
                  Release {offer.release}: {((offer.sizeBytes ?? 0) / 1048576).toFixed(1)} MB to download from Ordnance
                  Survey, about 50 MB once stored.
                </span>
                <Button variant="primary" disabled={busy} onClick={download}>
                  Download
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={() => setOffer(null)}>
              Not now
            </Button>
          </div>
        )}
        {error !== null && <p className="mt-2 text-[12px] text-[var(--color-danger)]">{error}</p>}
        <p className={`${hint} mt-2`}>
          Ordnance Survey Code-Point Open, Open Government Licence v3.0. Contains OS data © Crown copyright and database
          right. Contains Royal Mail data © Royal Mail copyright and database right. Contains National Statistics data ©
          Crown copyright and database right.
        </p>
      </div>
    </section>
  );
}
