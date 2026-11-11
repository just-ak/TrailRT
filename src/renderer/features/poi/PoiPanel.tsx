import { Crosshair, ExternalLink, ListPlus, MapPinPlus, Milestone, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { UnitSystem } from "@shared/domain/types";
import { formatDistance } from "@shared/geo/units";
import { categoryById, POI_CATEGORIES } from "@shared/poi/categories";
import type { PoiHit } from "@shared/poi/PoiProvider";
import { Button } from "../../components/Button";
import { api, call, describeError } from "../../lib/client";
import { getMapInstance } from "../map/mapInstance";
import { useGeometryStore } from "../../stores/geometryStore";
import { useItineraryStore } from "../../stores/itineraryStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { CORRIDOR_WIDTHS_M, usePoiStore, type SectionChoice } from "../../stores/poiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore, type PoiScope } from "../../stores/uiStore";
import { inputAt } from "../properties/fields";
import { dayText, whenText } from "../itinerary/viewModel";
import { dataDateText, emptyText, openText, rangeGapText, safeWebsite } from "./poiText";

/**
 * Along the route: points of interest within a corridor, in the order you
 * reach them. Phase 10 Requirements 6–9, design §11.3.
 *
 * Everything comes from the place data on this machine. The only thing that
 * can leave it is a road-detour estimate, and only through the routing
 * service the user already set up.
 */

const SMALL = inputAt('w-auto');

export function PoiPanel({ scope, onClose }: { scope: PoiScope; onClose: () => void }): ReactNode {
  const store = usePoiStore();
  const units = useSettingsStore((s) => s.settings.units);
  const geometry = useGeometryStore((s) => s.geometry);
  const view = useItineraryStore((s) => s.view);
  const list = useRef<HTMLOListElement | null>(null);
  const scopeKey = JSON.stringify(scope);

  useEffect(() => {
    void usePoiStore.getState().open(JSON.parse(scopeKey) as PoiScope);
  }, [scopeKey]);

  // A POI clicked on the map scrolls into view here.
  useEffect(() => {
    if (store.focusedId === null) return;
    list.current?.querySelector(`[data-poi="${store.focusedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [store.focusedId]);

  const tripId =
    scope.kind === "itinerary" ? scope.tripId : (geometry?.routes.find((r) => r.id === scope.routeId)?.tripId ?? null);
  const scheduled = view !== null && view.itinerary.tripId === tripId ? view : null;
  const title =
    scope.kind === "itinerary"
      ? "Along the whole trip"
      : `Along ${geometry?.routes.find((r) => r.id === scope.routeId)?.name ?? "the route"}`;

  const close = (): void => {
    usePoiStore.getState().close();
    onClose();
  };

  return (
    <section
      aria-label="Along the route"
      data-testid="poi-panel"
      className="h-full overflow-y-auto bg-[var(--color-surface)]"
    >
      <div className="sticky top-0 z-10 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">{title}</h2>
          <IconButton variant="ghost" className="ml-auto" hint="Close" onClick={close}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
        <Controls scope={scope} units={units} scheduled={scheduled} />
      </div>

      <div className="p-2 text-[12px]">
        <DataState />
        {store.error !== null && <p className="text-[var(--color-danger)]">{store.error}</p>}
        {store.loading && (
          <p className="text-[var(--color-text-muted)]">
            Searching…
            <Button variant="ghost" className="ml-2" onClick={() => usePoiStore.getState().cancel()}>
              Stop
            </Button>
          </p>
        )}
        {store.result !== null && !store.loading && (
          <Results units={units} tripId={tripId} scheduledTripId={scheduled?.itinerary.tripId ?? null} listRef={list} />
        )}
        <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">
          Places © OpenStreetMap contributors, ODbL · {dataDateText(store.result?.dataDate ?? null)}. Opening hours, ratings
          and prices change: check before you rely on them.
        </p>
      </div>
    </section>
  );
}

/** Changes the question and asks it again. */
function update(patch: Parameters<ReturnType<typeof usePoiStore.getState>["set"]>[0]): void {
  usePoiStore.getState().set(patch);
  void usePoiStore.getState().search();
}

function Controls({
  scope,
  units,
  scheduled,
}: {
  scope: PoiScope;
  units: UnitSystem;
  scheduled: ReturnType<typeof useItineraryStore.getState>["view"];
}): ReactNode {
  const { categories, widthM, section } = usePoiStore();
  const [from, setFrom] = useState("0");
  const [to, setTo] = useState("50");

  const sectionValue = section.kind === "day" ? `day:${section.date}` : section.kind === "near" ? `near:${section.label}` : section.kind;
  const stops = scheduled?.stops ?? [];
  const days = scheduled?.timeline.days ?? [];

  const chooseSection = (value: string): void => {
    let next: SectionChoice = { kind: "all" };
    if (value === "range") next = { kind: "range", fromKm: Number(from) || 0, toKm: Number(to) || 0 };
    if (value.startsWith("day:")) next = { kind: "day", date: value.slice(4) };
    if (value.startsWith("near:")) {
      const stop = stops.find((s) => s.id === value.slice(5));
      if (stop?.place) next = { kind: "near", lat: stop.place.lat, lon: stop.place.lon, radiusKm: 10, label: stop.id };
    }
    update({ section: next });
  };

  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="sr-only">Find</legend>
        {POI_CATEGORIES.map((category) => (
          <label key={category.id} className="flex items-center gap-1 text-[var(--color-text-primary)]">
            <input
              type="checkbox"
              checked={categories.includes(category.id)}
              onChange={(e) =>
                update({
                  categories: e.target.checked
                    ? [...categories, category.id]
                    : categories.filter((c) => c !== category.id),
                })
              }
            />
            {category.label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 text-[var(--color-text-secondary)]">
        <label className="flex items-center gap-1">
          Within
          <select aria-label="Corridor width" value={widthM} onChange={(e) => update({ widthM: Number(e.target.value) })} className={SMALL}>
            {CORRIDOR_WIDTHS_M.map((w) => (
              <option key={w} value={w}>
                {formatDistance(w, units)}
              </option>
            ))}
          </select>
          of the route
        </label>
        <label className="flex items-center gap-1">
          on
          <select aria-label="Part of the route" value={sectionValue} onChange={(e) => chooseSection(e.target.value)} className={SMALL}>
            <option value="all">the whole way</option>
            <option value="range">a stretch…</option>
            {scope.kind === "itinerary" &&
              days.map((day) => (
                <option key={day.date} value={`day:${day.date}`}>
                  {dayText(day.date)}
                </option>
              ))}
            {scope.kind === "itinerary" &&
              stops
                .filter((s) => s.place !== null)
                .map((s) => (
                  <option key={s.id} value={`near:${s.id}`}>
                    near {s.place?.name}
                  </option>
                ))}
          </select>
        </label>
        {section.kind === "range" && (
          <span className="flex items-center gap-1">
            from
            <input aria-label="From km" inputMode="decimal" value={from} onChange={(e) => setFrom(e.target.value)} className={inputAt('w-14')} />
            to
            <input aria-label="To km" inputMode="decimal" value={to} onChange={(e) => setTo(e.target.value)} className={inputAt('w-14')} />
            km
            <Button variant="ghost" onClick={() => update({ section: { kind: "range", fromKm: Number(from) || 0, toKm: Number(to) || 0 } })}>
              Apply
            </Button>
          </span>
        )}
        {section.kind === "near" && (
          <label className="flex items-center gap-1">
            radius
            <select
              aria-label="Radius"
              value={section.radiusKm}
              onChange={(e) => update({ section: { ...section, radiusKm: Number(e.target.value) } })}
              className={SMALL}
            >
              {[2, 5, 10, 20].map((km) => (
                <option key={km} value={km}>
                  {formatDistance(km * 1000, units)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

/** What place data there is, and what to do when there is none. */
function DataState(): ReactNode {
  const data = usePoiStore((s) => s.data);
  if (data === null || data.kind === "ready") return null;
  if (data.kind === "none") {
    return (
      <p className="text-[var(--color-text-secondary)]">
        Finding places needs map regions, which also carry the place data. Download them in Settings → Map regions.
      </p>
    );
  }
  return (
    <div className="text-[var(--color-text-secondary)]">
      <p>
        Place data was not built with {data.regionName}, so places cannot be found yet. This is not the same as there being
        none.
      </p>
      {data.canRebuild ? (
        <Button
          className="mt-1"
          onClick={() =>
            void call(api().places.rebuild())
              .then(() => usePoiStore.getState().open(usePoiStore.getState().scope ?? { kind: "itinerary", tripId: "" }))
              .catch((cause: unknown) => useUiStore.getState().showToast(describeError(cause), "error"))
          }
        >
          Rebuild map regions
        </Button>
      ) : (
        <p>Import the .osm.pbf file again to build its place data.</p>
      )}
    </div>
  );
}

function Results({
  units,
  tripId,
  scheduledTripId,
  listRef,
}: {
  units: UnitSystem;
  tripId: string | null;
  scheduledTripId: string | null;
  listRef: RefObject<HTMLOListElement | null>;
}): ReactNode {
  const { result, categories, widthM } = usePoiStore();
  const view = useItineraryStore((s) => s.view);
  if (result === null) return null;
  const electric = view?.itinerary.energy === "electric";
  const uncoveredM = result.uncovered.reduce((sum, s) => sum + (s.toM - s.fromM), 0);

  return (
    <>
      {result.range !== null && result.range.checked && result.range.gaps.length > 0 && (
        <div className="mb-2 rounded border border-[var(--color-danger)] p-2" data-testid="range-warnings">
          <p className="font-medium text-[var(--color-danger)]">
            Range check, assuming a full {electric ? "battery" : "tank"} at the start:
          </p>
          {result.range.gaps.map((gap) => (
            <p key={`${gap.fromM}`} className="text-[var(--color-text-primary)]">
              {rangeGapText(gap, widthM, units, electric)}
            </p>
          ))}
        </div>
      )}
      {result.range !== null && !result.range.checked && scheduledTripId !== null && (
        <p className="mb-2 text-[var(--color-text-muted)]">No vehicle range is set, so no range check ran. Set one in the itinerary’s trip settings.</p>
      )}
      {uncoveredM > 0 && (
        <p className="mb-2 text-[var(--color-text-secondary)]">
          {formatDistance(uncoveredM, units)} of this route is outside your map regions and was not searched.
        </p>
      )}
      {result.otherTransport > 0 && (
        <p className="mb-2 text-[var(--color-text-secondary)]">
          {result.otherTransport} leg{result.otherTransport === 1 ? " is" : "s are"} by other transport, so nothing along{" "}
          {result.otherTransport === 1 ? "it" : "them"} was searched.
        </p>
      )}
      {result.unplanned > 0 && (
        <p className="mb-2 text-[var(--color-text-secondary)]">
          {result.unplanned} drive{result.unplanned === 1 ? " has" : "s have"} no route yet, so nothing along {result.unplanned === 1 ? "it" : "them"} was searched.
        </p>
      )}
      {result.hits.length === 0 ? (
        <p className="text-[var(--color-text-secondary)]" data-testid="poi-empty">
          {emptyText(categories, widthM, result.dataDate, units)}
        </p>
      ) : (
        <ol ref={listRef} className="flex flex-col gap-1" aria-label="Places along the route">
          {result.hits.map((hit) => (
            <HitRow key={hit.poi.id} hit={hit} units={units} tripId={tripId} scheduledTripId={scheduledTripId} />
          ))}
        </ol>
      )}
    </>
  );
}

function HitRow({
  hit,
  units,
  tripId,
  scheduledTripId,
}: {
  hit: PoiHit;
  units: UnitSystem;
  tripId: string | null;
  scheduledTripId: string | null;
}): ReactNode {
  const focusedId = usePoiStore((s) => s.focusedId);
  const detour = usePoiStore((s) => s.detours[hit.poi.id]);
  const { poi } = hit;
  const category = categoryById(poi.category);
  const website = safeWebsite(poi.attributes.website);
  const open = openText(hit.open);
  const [added, setAdded] = useState<string | null>(null);

  const add = async (asStop: boolean): Promise<void> => {
    if (tripId === null) return;
    try {
      if (asStop && scheduledTripId !== null) {
        await call(
          api().itinerary.addPoiStop({
            poiId: poi.id,
            tripId: scheduledTripId,
            ...(hit.stopIndex === null ? {} : { index: hit.stopIndex }),
          }),
        );
        setAdded("Added as a stop. The itinerary plans the drives either side by road.");
      } else {
        await call(api().places.addWaypoint({ poiId: poi.id, tripId }));
        setAdded("Added as a waypoint.");
      }
      await Promise.all([
        useGeometryStore.getState().reload(),
        useItineraryStore.getState().reload(),
        useLibraryStore.getState().refresh(),
      ]);
    } catch (cause) {
      useUiStore.getState().showToast(describeError(cause), "error");
    }
  };

  return (
    <li
      data-poi={poi.id}
      data-testid="poi-row"
      className={`rounded border p-2 ${focusedId === poi.id ? "border-[var(--color-accent)]" : "border-[var(--color-border-subtle)]"}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-[var(--color-text-primary)]">{poi.name ?? category.label}</span>
        <span className="text-[var(--color-text-muted)]">{poi.name === null ? "" : category.label}</span>
      </div>
      <p className="text-[var(--color-text-secondary)]">
        {formatDistance(hit.alongM, units)} from the start · {formatDistance(hit.offM, units)} off the route (straight line)
        {hit.passLocal !== null && ` · about ${whenText(hit.passLocal)} (estimate)`}
        {open !== null && ` · ${open}`}
      </p>
      {poi.attributes.address !== null && <p className="text-[var(--color-text-secondary)]">{poi.attributes.address}</p>}
      {poi.attributes.openingHours !== null && open === null && (
        <p className="text-[var(--color-text-muted)]">Opening hours, as mapped: {poi.attributes.openingHours}</p>
      )}
      {(poi.attributes.fuels.length > 0 || poi.attributes.sockets.length > 0) && (
        <p className="text-[var(--color-text-muted)]">{[...poi.attributes.fuels, ...poi.attributes.sockets].join(", ")}</p>
      )}
      {poi.attributes.phone !== null && <p className="text-[var(--color-text-muted)]">Phone: {poi.attributes.phone}</p>}
      {detour !== undefined && (
        <p className="text-[var(--color-text-secondary)]">
          {detour === "loading"
            ? "Working out the detour…"
            : "error" in detour
              ? detour.error
              : `Estimated detour by road: ${formatDistance(detour.extraM, units)} extra${detour.matched ? "" : " (some of it could not follow roads)"}.`}
        </p>
      )}
      {added !== null && <p className="text-[var(--color-text-secondary)]">{added}</p>}
      <div className="mt-1 flex flex-wrap gap-1">
        <IconButton
          variant="ghost"
          hint="Show on the map"
          onClick={() => {
            usePoiStore.getState().focus(poi.id);
            getMapInstance()?.setView([poi.lat, poi.lon], Math.max(getMapInstance()?.getZoom() ?? 15, 15));
          }}
        >
          <Crosshair size={16} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" hint="Add as a waypoint" disabled={tripId === null} onClick={() => void add(false)}>
          <MapPinPlus size={16} aria-hidden="true" />
        </IconButton>
        {scheduledTripId !== null && (
          <IconButton variant="ghost" hint="Add as a stop" onClick={() => void add(true)}>
            <ListPlus size={16} aria-hidden="true" />
          </IconButton>
        )}
        <IconButton variant="ghost" hint="Estimate the detour by road" onClick={() => void usePoiStore.getState().detour(poi.id)}>
          <Milestone size={16} aria-hidden="true" />
        </IconButton>
        {website !== null && (
          <IconButton variant="ghost" hint="Open its website" onClick={() => void call(api().app.openExternal({ url: website })).catch(() => undefined)}>
            <ExternalLink size={16} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </li>
  );
}
