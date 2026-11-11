import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RoutePoint } from "@shared/domain/types";
import {
  ABSENT,
  formatDistance,
  formatSpeed,
  formatTimestamp,
} from "@shared/geo/units";
import { Button } from "../../components/Button";
import { api, call, callOr, describeError } from "../../lib/client";
import { useSelectionStore } from "../../stores/selectionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { useMapInstance } from "../map/mapInstance";
import { isOffScreen, useHighlightLayer } from "../map/useHighlightLayer";
import {
  describeIndices,
  displayIndex,
  remapAfterDelete,
  visibleWindow,
  type PointRow,
} from "./pointRows";
import { usePointRows } from "./usePointRows";

/**
 * The point table: one object's points, listed under its profile chart.
 *
 * Rendered inside the profile drawer, which owns opening and closing it, so a
 * point selected here is shaded on the chart and a click on the chart selects
 * a row here.
 *
 * One component for routes and tracks over a normalised row model, because the
 * interaction is the same even though the storage is not. What differs is
 * confined to three places, each for a reason:
 *
 * - **Columns.** A route has names and symbols per point and a cumulative
 *   distance; a track has timestamps and a step speed. Showing a route a
 *   "speed" column would be showing it a fact it does not have.
 * - **Writes.** A route edit rebuilds the array and goes through the existing
 *   `routes.setGeometry`, so it is one undo entry and inherits the 10,000
 *   point cap. No per-point route channel exists, deliberately (Requirement
 *   3.5). A track edit is targeted, because its array is far too large to
 *   resend.
 * - **Reloads.** `replacePoints` re-UUIDs every row, so there is no stable
 *   point identity and the table keys on **index**. An edit therefore
 *   invalidates every index after it, which is why the table reloads after
 *   any mutation and remaps a pending row selection rather than
 *   reinterpreting it against shifted indices.
 */

/** Fixed, so virtualisation is arithmetic rather than measurement. */
const ROW_HEIGHT = 26;

/**
 * How many points may be highlighted individually before the map shows the
 * selection's extent instead.
 *
 * Leaflet runs with `preferCanvas`, so every highlighted point is a draw into
 * a shared canvas. Requirement 5.4 asks for a bound and for it to be stated;
 * 2,000 is comfortably past any selection a person makes by hand and well
 * inside what the renderer draws without stuttering.
 */
export const MAX_HIGHLIGHTED_POINTS = 2_000;

function Cell({
  children = null,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={`truncate px-1.5 py-0.5 ${className}`}>{children}</div>
  );
}

/** A number input that treats empty as unknown rather than as zero. */
function NumberCell({
  value,
  label,
  step,
  onCommit,
}: {
  value: number | null;
  label: string;
  step: number;
  onCommit: (next: number | null) => void;
}): ReactNode {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value === null ? "" : String(value));

  return (
    <input
      type="number"
      step={step}
      value={text}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const trimmed = draft.trim();
        setDraft(null);
        // Empty means unknown. Requirement 3.2 and 6.3: it must not coerce to
        // 0, which would be a sea-level reading nobody recorded.
        if (trimmed.length === 0) {
          if (value !== null) onCommit(null);
          return;
        }
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed === value) return;
        onCommit(parsed);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0 text-right text-[12px] tabular-nums hover:border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] focus:outline-none"
    />
  );
}

function TextCell({
  value,
  label,
  onCommit,
}: {
  value: string | null;
  label: string;
  onCommit: (next: string | null) => void;
}): ReactNode {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="text"
      value={draft ?? value ?? ""}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const trimmed = draft.trim();
        setDraft(null);
        const next = trimmed.length === 0 ? null : trimmed;
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0 text-[12px] hover:border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] focus:outline-none"
    />
  );
}

interface Props {
  ownerType: "route" | "track";
  ownerId: string;
}

export function PointTable({ ownerType, ownerId }: Props): ReactNode {
  const showToast = useUiStore((s) => s.showToast);
  const setHighlightedPoints = useUiStore((s) => s.setHighlightedPoints);
  const highlighted = useUiStore((s) => s.highlightedPoints);
  const units = useSettingsStore((s) => s.settings.units);
  const track = useSelectionStore((s) => s.track);
  const route = useSelectionStore((s) => s.route);

  const data = usePointRows(ownerType, ownerId);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(260);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const map = useMapInstance();

  const selected = useMemo(() => new Set(highlighted), [highlighted]);

  /*
   * The map mirror.
   *
   * Owned here rather than in MapView because this component holds the only
   * copy of the loaded points a highlighted index refers to — for a track that
   * is a window, not the whole array. Handing MapView an index it cannot
   * resolve would mean either duplicating the window into another store or
   * drawing markers at guessed positions.
   */
  const pointAt = useCallback(
    (index: number) => {
      const row = data.rows.find((candidate) => candidate.index === index);
      return row === undefined ? null : { lat: row.lat, lon: row.lon };
    },
    [data.rows],
  );

  useHighlightLayer(map, {
    pointAt,
    indices: highlighted,
    maxPoints: MAX_HIGHLIGHTED_POINTS,
    // Clicking a highlighted point selects its row; the scroll effect below
    // brings it into view (Requirement 5.2).
    onPointClick: (index) => {
      setAnchor(index);
      setHighlightedPoints([index]);
    },
  });

  /*
   * Offers to bring an off-screen highlight into view rather than panning.
   *
   * Requirement 5.3: panning on every row change would fight the pointer
   * during a drag-select, so this is a button and not an effect.
   */
  const firstHighlight = highlighted[0];
  const offScreen =
    firstHighlight === undefined
      ? false
      : isOffScreen(map, pointAt(firstHighlight));

  const window = visibleWindow({
    total: data.total,
    rowHeight: ROW_HEIGHT,
    viewportHeight,
    scrollTop,
  });

  // Ask for the window the viewport has scrolled into. A no-op for a route,
  // whose points are all in hand already. `requestWindow` is destructured
  // because `data` is a fresh object each render and depending on it would run
  // this effect on every one.
  const { requestWindow } = data;
  useEffect(() => {
    requestWindow(window.first);
  }, [requestWindow, window.first]);

  useEffect(() => {
    const element = bodyRef.current;
    if (element === null) return;
    setViewportHeight(element.clientHeight);
    const observer = new ResizeObserver(() => {
      setViewportHeight(element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Highlighting is read-only: it changes no data and records no undo entry. */
  const selectRow = useCallback(
    (index: number, modifiers: { metaKey: boolean; shiftKey: boolean }) => {
      if (modifiers.shiftKey && anchor !== null) {
        const from = Math.min(anchor, index);
        const to = Math.max(anchor, index);
        const range: number[] = [];
        for (let i = from; i <= to; i += 1) range.push(i);
        setHighlightedPoints(range);
        return;
      }

      if (modifiers.metaKey) {
        const next = new Set(selected);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        setAnchor(index);
        setHighlightedPoints([...next].toSorted((a, b) => a - b));
        return;
      }

      setAnchor(index);
      setHighlightedPoints([index]);
    },
    [anchor, selected, setHighlightedPoints],
  );

  /**
   * Clicking a highlighted point on the map selects its row and scrolls to it.
   *
   * The map cannot own this: canvas-drawn points take no keyboard focus, so
   * the table is the accessible surface and the map mirrors it (Requirement
   * 5.5). This is the return leg of that mirror.
   */
  useEffect(() => {
    const first = highlighted[0];
    if (first === undefined || bodyRef.current === null) return;
    const top = first * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const view = bodyRef.current;
    if (top < view.scrollTop || bottom > view.scrollTop + view.clientHeight) {
      view.scrollTo({ top: Math.max(0, top - view.clientHeight / 2) });
    }
    // Only when the selection changes, not on every scroll — otherwise the
    // table would fight the user's own scrolling.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [highlighted]);

  // Highlighting is meaningless once the table closes.
  useEffect(() => {
    return () => setHighlightedPoints([]);
  }, [setHighlightedPoints]);

  // ------------------------------------------------------------- mutations

  const afterMutation = useCallback(
    async (deleted: readonly number[] | null) => {
      await data.reload();
      // Indices shifted. Remapping beats reinterpreting: a stale selection
      // read against new indices would highlight — and could delete — the
      // wrong points.
      setHighlightedPoints(
        deleted === null ? [] : remapAfterDelete(selected, deleted),
      );
      setAnchor(null);
    },
    [data, selected, setHighlightedPoints],
  );

  /** Route edits rebuild the array and go through the existing channel. */
  const writeRoutePoints = useCallback(
    async (points: RoutePoint[], deleted: readonly number[] | null) => {
      setBusy(true);
      try {
        await call(api().routes.setGeometry({ id: ownerId, points }));
        await afterMutation(deleted);
      } catch (cause) {
        showToast(describeError(cause), "error");
      } finally {
        setBusy(false);
      }
    },
    [afterMutation, ownerId, showToast],
  );

  const editRoutePoint = useCallback(
    (index: number, patch: Partial<RoutePoint>) => {
      if (route === null || route.id !== ownerId) return;
      const points = route.points.map((point, i) =>
        i === index ? { ...point, ...patch } : point,
      );
      void writeRoutePoints(points, null);
    },
    [ownerId, route, writeRoutePoints],
  );

  const editTrackPoint = useCallback(
    (
      row: PointRow,
      patch: {
        lat?: number;
        lon?: number;
        ele?: number | null;
        time?: number | null;
      },
    ) => {
      setBusy(true);
      void (async () => {
        try {
          await call(
            api().tracks.editPoint({
              id: ownerId,
              index: row.index,
              lat: patch.lat ?? row.lat,
              lon: patch.lon ?? row.lon,
              ele: patch.ele === undefined ? row.ele : patch.ele,
              time: patch.time === undefined ? row.time : patch.time,
            }),
          );
          await afterMutation(null);
        } catch (cause) {
          showToast(describeError(cause), "error");
        } finally {
          setBusy(false);
        }
      })();
    },
    [afterMutation, ownerId, showToast],
  );

  const deleteSelected = useCallback(() => {
    const indices = [...selected].toSorted((a, b) => a - b);
    if (indices.length === 0) return;

    if (data.total - indices.length < 1) {
      showToast(
        ownerType === "route"
          ? "A route needs at least one point. Delete the route instead."
          : "A track needs at least one point. Delete the track instead.",
        "error",
      );
      return;
    }

    if (ownerType === "route") {
      if (route === null || route.id !== ownerId) return;
      const gone = new Set(indices);
      void writeRoutePoints(
        route.points.filter((_, index) => !gone.has(index)),
        indices,
      );
      return;
    }

    setBusy(true);
    void (async () => {
      try {
        await call(api().tracks.deletePoints({ id: ownerId, indices }));
        await afterMutation(indices);
        showToast(
          `Removed ${indices.length} point${indices.length === 1 ? "" : "s"}.`,
        );
      } catch (cause) {
        showToast(describeError(cause), "error");
      } finally {
        setBusy(false);
      }
    })();
  }, [
    afterMutation,
    data.total,
    ownerId,
    ownerType,
    route,
    selected,
    showToast,
    writeRoutePoints,
  ]);

  /** Route only: insert a copy of a point beside it, ready to be moved. */
  const insertBeside = useCallback(
    (index: number, where: "before" | "after") => {
      if (ownerType !== "route" || route === null || route.id !== ownerId) {
        return;
      }
      const source = route.points[index];
      if (source === undefined) return;

      const at = where === "before" ? index : index + 1;
      const points = [
        ...route.points.slice(0, at),
        { ...source, name: null },
        ...route.points.slice(at),
      ];
      void writeRoutePoints(points, null);
    },
    [ownerId, ownerType, route, writeRoutePoints],
  );

  const movePoint = useCallback(
    (index: number, delta: number) => {
      if (ownerType !== "route" || route === null || route.id !== ownerId) {
        return;
      }
      const to = index + delta;
      if (to < 0 || to >= route.points.length) return;

      const points = [...route.points];
      const [moved] = points.splice(index, 1);
      if (moved === undefined) return;
      points.splice(to, 0, moved);
      void writeRoutePoints(points, null);
    },
    [ownerId, ownerType, route, writeRoutePoints],
  );

  const restoreOriginal = useCallback(() => {
    setBusy(true);
    void (async () => {
      const result = await callOr(
        api().tracks.restoreOriginal({ id: ownerId }),
        null,
      );
      setBusy(false);
      if (result === null) {
        showToast("That original could not be restored.", "error");
        return;
      }
      await afterMutation(null);
      showToast("The recording was restored from the imported file.");
    })();
  }, [afterMutation, ownerId, showToast]);

  // ---------------------------------------------------------------- render

  const isRoute = ownerType === "route";
  const columns = isRoute
    ? "3.5rem 6rem 6rem 5rem 8rem 6rem 1fr 6rem 7rem"
    : "3.5rem 6rem 6rem 5rem 11rem 5.5rem 6rem";

  const rowsInWindow = data.rows.filter(
    (row) =>
      row.index >= window.first && row.index < window.first + window.count,
  );

  const overBound = selected.size > MAX_HIGHLIGHTED_POINTS;

  return (
    <section
      aria-label={`${isRoute ? "Route" : "Track"} points`}
      className="flex h-[260px] shrink-0 flex-col border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-2 py-1.5">
        <h2 className="text-[12px] font-semibold text-[var(--color-text-primary)]">
          {isRoute ? "Route points" : "Track points"}
        </h2>
        <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
          {data.total.toLocaleString()} point
          {data.total === 1 ? "" : "s"}
          {selected.size > 0 && ` · ${describeIndices([...selected])} selected`}
        </span>

        {data.loading && (
          <span className="text-[11px] text-[var(--color-text-muted)]">
            Loading…
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {offScreen && (
            <Button
              onClick={() => {
                const point =
                  firstHighlight === undefined ? null : pointAt(firstHighlight);
                if (point !== null) {
                  map?.panTo([point.lat, point.lon], { animate: true });
                }
              }}
            >
              Show on map
            </Button>
          )}
          {isRoute && selected.size === 1 && (
            <>
              <Button
                onClick={() => movePoint([...selected][0] as number, -1)}
                disabled={busy}
              >
                ↑
              </Button>
              <Button
                onClick={() => movePoint([...selected][0] as number, 1)}
                disabled={busy}
              >
                ↓
              </Button>
              <Button
                onClick={() =>
                  insertBeside([...selected][0] as number, "after")
                }
                disabled={busy}
              >
                Insert
              </Button>
            </>
          )}
          <Button
            variant="danger"
            onClick={deleteSelected}
            disabled={busy || selected.size === 0}
          >
            {selected.size > 1
              ? `Delete ${selected.size} points`
              : "Delete point"}
          </Button>
        </div>
      </header>

      {/*
        Honesty about what is on screen.

        The table always reads exact points, so when the map is drawing the
        simplified cache the two genuinely disagree — and saying so beats
        leaving the user to wonder why a listed point has no vertex.
      */}
      {data.mapSimplified && (
        <p className="shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
          The map is drawing a simplified version of this track at this zoom.
          These are the exact recorded points; zoom in to see them all drawn.
        </p>
      )}

      {/* Requirement 4.6: editing a recording is labelled as such. */}
      {!isRoute && (
        <p className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
          <span>
            This is recorded data. Edits change the measurement.
            {track?.hasOriginal === true
              ? " The imported original is retained."
              : " No original file was retained for this track."}
          </span>
          {track?.hasOriginal === true && (
            <Button
              onClick={restoreOriginal}
              disabled={busy}
              // The way back, offered beside the warning rather than buried in
              // another panel.
            >
              Restore recording
            </Button>
          )}
        </p>
      )}

      {overBound && (
        <p className="shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
          {selected.size.toLocaleString()} points selected. The map is showing
          the extent of the selection rather than every point.
        </p>
      )}

      <div
        role="grid"
        aria-label={`${isRoute ? "Route" : "Track"} point list`}
        aria-rowcount={data.total}
        aria-multiselectable="true"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          role="row"
          style={{ gridTemplateColumns: columns }}
          className="grid shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] text-[11px] font-semibold text-[var(--color-text-secondary)]"
        >
          <Cell className="text-right">#</Cell>
          <Cell className="text-right">Latitude</Cell>
          <Cell className="text-right">Longitude</Cell>
          <Cell className="text-right">Elev</Cell>
          {isRoute ? (
            <>
              <Cell>Name</Cell>
              <Cell>Symbol</Cell>
              <Cell>Notes</Cell>
              <Cell className="text-right">From start</Cell>
              <Cell />
            </>
          ) : (
            <>
              <Cell>Time</Cell>
              <Cell className="text-right">Step</Cell>
              <Cell className="text-right">Speed</Cell>
            </>
          )}
        </div>

        <div
          ref={bodyRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {/*
            Virtualised by padding. A 200,000-row table is two spacer divs and
            about forty real rows, which is the whole of Requirement 4.2.
          */}
          <div style={{ height: window.padTop }} />

          {rowsInWindow.map((row) => {
            const isSelected = selected.has(row.index);
            return (
              <div
                key={row.index}
                role="row"
                aria-rowindex={displayIndex(row.index)}
                aria-selected={isSelected}
                style={{ gridTemplateColumns: columns, height: ROW_HEIGHT }}
                onMouseDown={(event) =>
                  selectRow(row.index, {
                    metaKey: event.metaKey,
                    shiftKey: event.shiftKey,
                  })
                }
                className={`grid items-center border-b text-[12px] ${
                  row.segmentEnd
                    ? "border-b-[var(--color-text-muted)]"
                    : "border-b-[var(--color-border-subtle)]/40"
                } ${
                  isSelected
                    ? "bg-[var(--color-accent)]/20"
                    : "hover:bg-[var(--color-surface-sunken)]"
                }`}
              >
                <Cell className="text-right tabular-nums text-[var(--color-text-muted)]">
                  {displayIndex(row.index)}
                </Cell>

                <NumberCell
                  value={row.lat}
                  step={0.00001}
                  label={`Latitude of point ${displayIndex(row.index)}`}
                  onCommit={(next) => {
                    if (next === null) return;
                    if (isRoute) editRoutePoint(row.index, { lat: next });
                    else editTrackPoint(row, { lat: next });
                  }}
                />
                <NumberCell
                  value={row.lon}
                  step={0.00001}
                  label={`Longitude of point ${displayIndex(row.index)}`}
                  onCommit={(next) => {
                    if (next === null) return;
                    if (isRoute) editRoutePoint(row.index, { lon: next });
                    else editTrackPoint(row, { lon: next });
                  }}
                />
                <NumberCell
                  value={row.ele}
                  step={1}
                  label={`Elevation of point ${displayIndex(row.index)}`}
                  onCommit={(next) => {
                    if (isRoute) editRoutePoint(row.index, { ele: next });
                    else editTrackPoint(row, { ele: next });
                  }}
                />

                {isRoute ? (
                  <>
                    <TextCell
                      value={row.name}
                      label={`Name of point ${displayIndex(row.index)}`}
                      onCommit={(next) =>
                        editRoutePoint(row.index, { name: next })
                      }
                    />
                    <TextCell
                      value={row.symbol}
                      label={`Symbol of point ${displayIndex(row.index)}`}
                      onCommit={(next) =>
                        editRoutePoint(row.index, { symbol: next })
                      }
                    />
                    <TextCell
                      value={row.notes}
                      label={`Notes for point ${displayIndex(row.index)}`}
                      onCommit={(next) =>
                        editRoutePoint(row.index, { notes: next })
                      }
                    />
                    <Cell className="text-right tabular-nums">
                      {formatDistance(row.cumulativeM, units)}
                    </Cell>
                    <Cell>
                      <button
                        type="button"
                        aria-label={`Insert a point after point ${displayIndex(row.index)}`}
                        onClick={() => insertBeside(row.index, "after")}
                        className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                      >
                        + after
                      </button>
                    </Cell>
                  </>
                ) : (
                  <>
                    <Cell className="tabular-nums">
                      {formatTimestamp(row.time)}
                    </Cell>
                    <Cell className="text-right tabular-nums">
                      {row.stepM === null
                        ? ABSENT
                        : formatDistance(row.stepM, units)}
                    </Cell>
                    <Cell className="text-right tabular-nums">
                      {formatSpeed(row.speedKmh, units)}
                    </Cell>
                  </>
                )}
              </div>
            );
          })}

          <div style={{ height: window.padBottom }} />

          {data.total === 0 && !data.loading && (
            <p className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
              This {isRoute ? "route" : "track"} has no points.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
