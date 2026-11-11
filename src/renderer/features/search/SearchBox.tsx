import { ListPlus, MapPinPlus, Route, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import L from "leaflet";
import type { SearchOutcome, SearchResult } from "@shared/search/PlaceSearchProvider";
import { formatDate } from "@shared/itinerary/format";
import { api, call, callOr, describeError } from "../../lib/client";
import * as actions from "../../lib/actions";
import { useGeometryStore } from "../../stores/geometryStore";
import { useItineraryStore } from "../../stores/itineraryStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { useUiStore } from "../../stores/uiStore";
import { useMapInstance } from "../map/mapInstance";
import { createLatest, nextIndex, SEARCH_DEBOUNCE_MS } from "./searchModel";

/**
 * Postcode and place search, on the map. Phase 10 Requirement 11.
 *
 * Every answer comes from data on this machine; typing sends nothing
 * anywhere. Choosing a result only moves the map and marks the place. Adding
 * it to the trip is a separate, explicit choice (11.2).
 */

const latest = createLatest();

export function SearchBox(): ReactNode {
  const map = useMapInstance();
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [active, setActive] = useState(-1);
  const [chosen, setChosen] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const marker = useRef<L.LayerGroup | null>(null);

  const ask = (value: string): void => {
    clearTimeout(timer.current);
    if (value.trim().length === 0) {
      latest.take();
      setOutcome(null);
      return;
    }
    timer.current = setTimeout(() => {
      const ticket = latest.take();
      const centre = map?.getCenter() ?? { lat: 53.26, lng: -1.91 };
      void callOr(api().search.query({ text: value, lat: centre.lat, lon: centre.lng }), null).then((answer) => {
        if (!latest.isLatest(ticket)) return;
        setOutcome(answer);
        setActive(answer !== null && answer.results.length > 0 ? 0 : -1);
      });
    }, SEARCH_DEBOUNCE_MS);
  };

  // The chosen place is marked, and an area shows its extent.
  useEffect(() => {
    marker.current?.remove();
    marker.current = null;
    if (map === null || chosen === null) return;
    const group = L.layerGroup().addTo(map);
    if (chosen.bounds !== null) {
      L.rectangle(
        [
          [chosen.bounds.minLat, chosen.bounds.minLon],
          [chosen.bounds.maxLat, chosen.bounds.maxLon],
        ],
        { color: "#2563eb", weight: 2, dashArray: "6 4", fill: false, interactive: false },
      ).addTo(group);
    }
    L.circleMarker([chosen.lat, chosen.lon], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#2563eb",
      fillOpacity: 1,
      interactive: false,
    }).addTo(group);
    marker.current = group;
    return () => {
      group.remove();
    };
  }, [map, chosen]);

  const choose = (result: SearchResult): void => {
    setChosen(result);
    setOpen(false);
    if (map === null) return;
    if (result.bounds !== null) {
      map.fitBounds(
        [
          [result.bounds.minLat, result.bounds.minLon],
          [result.bounds.maxLat, result.bounds.maxLon],
        ],
        { padding: [40, 40], maxZoom: 16 },
      );
    } else {
      map.setView([result.lat, result.lon], result.kind === "place" ? 14 : 17);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const results = outcome?.results ?? [];
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter") {
      const result = results[active];
      if (result !== undefined) {
        event.preventDefault();
        choose(result);
      }
      return;
    }
    const next = nextIndex(active, event.key, results.length);
    if (next !== active) {
      event.preventDefault();
      setActive(next);
      setOpen(true);
    }
  };

  const results = outcome?.results ?? [];
  const showList = open && outcome !== null && text.trim().length > 0;
  const listId = "place-search-results";

  return (
    <div className="absolute top-3 left-3 z-[650] w-[min(22rem,calc(100%-6rem))]" data-testid="search-box">
      <input
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label="Search for a postcode or place"
        placeholder="Postcode, town or street"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          ask(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] shadow-md outline-none focus:border-[var(--color-accent)]"
      />

      {showList && (
        <div className="mt-1 max-h-[50vh] overflow-y-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-xl">
          {outcome.message !== null && (
            <p className="px-3 py-2 text-[12px] text-[var(--color-text-secondary)]" data-testid="search-message">
              {outcome.message}
            </p>
          )}
          <ul id={listId} role="listbox" aria-label="Places found">
            {results.map((result, index) => (
              <li
                key={result.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(result);
                }}
                className={`cursor-pointer px-3 py-1.5 text-[13px] ${index === active ? "bg-[var(--color-surface-sunken)]" : ""}`}
              >
                <span className="text-[var(--color-text-primary)]">{result.label}</span>
                {result.detail !== null && <span className="ml-1.5 text-[var(--color-text-muted)]">{result.detail}</span>}
                {result.approximate && <span className="ml-1.5 text-[11px] text-[var(--color-text-muted)]">approximate</span>}
                {result.note !== null && <span className="block text-[11px] text-[var(--color-text-muted)]">{result.note}</span>}
              </li>
            ))}
          </ul>
          <Attribution outcome={outcome} />
        </div>
      )}

      {chosen !== null && !showList && <ChosenActions result={chosen} onDone={() => setChosen(null)} />}
    </div>
  );
}

function Attribution({ outcome }: { outcome: SearchOutcome }): ReactNode {
  const used = new Set(outcome.results.map((r) => r.source));
  const datasets = outcome.datasets.filter((d) => used.has(d.id) && d.date !== null);
  if (datasets.length === 0) return null;
  return (
    <div className="border-t border-[var(--color-border-subtle)] px-3 py-1.5 text-[10px] leading-snug text-[var(--color-text-muted)]">
      {datasets.map((d) => (
        <p key={d.id}>
          {d.label}, {formatDate(d.date ?? "")}. {d.attribution.join(". ")}.
        </p>
      ))}
      <p>Searched on this computer. Nothing was sent anywhere.</p>
    </div>
  );
}

async function reload(): Promise<void> {
  await Promise.all([
    useGeometryStore.getState().reload(),
    useItineraryStore.getState().reload(),
    useLibraryStore.getState().refresh(),
  ]);
}

/** The explicit choices after picking a result: nothing happens without one. */
function ChosenActions({ result, onDone }: { result: SearchResult; onDone: () => void }): ReactNode {
  const tripId = useGeometryStore((s) => s.tripId);
  const view = useItineraryStore((s) => (s.tripId === tripId ? s.view : null));

  const addWaypoint = async (asStop: boolean): Promise<void> => {
    if (tripId === null) return;
    try {
      if (result.poiId !== undefined) {
        if (asStop) await call(api().itinerary.addPoiStop({ poiId: result.poiId, tripId }));
        else await call(api().places.addWaypoint({ poiId: result.poiId, tripId }));
      } else {
        const waypoint = await call(
          api().waypoints.create({
            tripId,
            name: result.detail === null || result.kind === "postcode" ? result.label : `${result.label}, ${result.detail}`,
            lat: result.lat,
            lon: result.lon,
            eleM: null,
            description: result.note,
            symbol: "pin",
            notes: null,
            groupId: null,
          }),
        );
        if (asStop) await call(api().itinerary.addStop({ tripId, waypointId: waypoint.id }));
      }
      await reload();
      useUiStore.getState().showToast(asStop ? `${result.label} added as a stop.` : `${result.label} added as a waypoint.`);
      onDone();
    } catch (cause) {
      useUiStore.getState().showToast(describeError(cause), "error");
    }
  };

  return (
    <div className="mt-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2 text-[12px] shadow-md" data-testid="search-chosen">
      <p className="mb-1 text-[var(--color-text-primary)]">
        {result.label}
        {result.approximate && <span className="ml-1 text-[var(--color-text-muted)]">(approximate)</span>}
      </p>
      {tripId === null ? (
        <div className="flex items-center gap-2">
          <p className="text-[var(--color-text-muted)]">Select a trip to add this place to it.</p>
          <IconButton variant="ghost" hint="Clear" onClick={onDone}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <IconButton hint="Add as a waypoint" onClick={() => void addWaypoint(false)}>
            <MapPinPlus size={16} aria-hidden="true" />
          </IconButton>
          <IconButton hint="Start a new route here" onClick={() => void actions.startRouteAt(result).then(onDone)}>
            <Route size={16} aria-hidden="true" />
          </IconButton>
          {view !== null && (
            <IconButton hint="Add as a stop" onClick={() => void addWaypoint(true)}>
              <ListPlus size={16} aria-hidden="true" />
            </IconButton>
          )}
          <IconButton variant="ghost" hint="Clear" onClick={onDone}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
