import { useCallback, useEffect, useState } from 'react';
import type { TrackPoint } from '@shared/domain/types';
import { api, callOr } from '../../lib/client';
import { useSelectionStore } from '../../stores/selectionStore';
import { getMapInstance } from '../map/mapInstance';
import { routeRows, trackRows, type PointRow } from './pointRows';

/**
 * Loads point rows for one route or track.
 *
 * The two paths diverge completely, which is the whole reason this is a hook
 * rather than inline state:
 *
 * - A **route** is already in hand. `selectionStore.route` holds the canonical
 *   array — the same data the map draws — so the table reads it directly and
 *   Requirement 3.6 falls out for free: dragging a vertex on the map updates
 *   the route, which updates the table.
 * - A **track** is paged. A 200,000-point array cannot cross the IPC boundary
 *   for a table showing forty rows, so a window is fetched per scroll
 *   position, always from `tracks:points` and therefore always exact.
 */

/** Rows fetched either side of the viewport, so a scroll is not blank. */
const PAGE = 400;

export interface PointData {
  rows: PointRow[];
  total: number;
  /** Flat index of `rows[0]`. Always 0 for a route. */
  offset: number;
  loading: boolean;
  /** True when the map is drawing the simplified cache for this track. */
  mapSimplified: boolean;
  /** Asks for the window containing this index. No-op for a route. */
  requestWindow(firstVisible: number): void;
  reload(): Promise<void>;
}

const NO_ROWS: PointRow[] = [];

export function usePointRows(
  ownerType: 'route' | 'track',
  ownerId: string,
): PointData {
  const route = useSelectionStore((s) => s.route);
  const trackPointCount = useSelectionStore((s) => s.track?.pointCount ?? null);

  const [offset, setOffset] = useState(0);
  /**
   * Bumped to force a refetch after a mutation.
   *
   * A token rather than an imperative fetch function: all the state writes
   * then happen inside the effect, which is what keeps this off the
   * cascading-render path. The same pattern the track layer hook uses.
   */
  const [reloadToken, setReloadToken] = useState(0);

  const [page, setPage] = useState<{
    rows: PointRow[];
    total: number;
    offset: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapSimplified, setMapSimplified] = useState(false);

  // --- route: read the canonical array the map is already drawing
  const routeRowsFor =
    ownerType === 'route' && route?.id === ownerId
      ? routeRows(route.points)
      : NO_ROWS;

  // --- track: fetch the window
  useEffect(() => {
    if (ownerType !== 'track') return;

    let cancelled = false;

    void (async () => {
      /*
       * One extra point before the window.
       *
       * The first row of a window still has a step distance and a speed, which
       * it could not have from the window alone. Asking for the preceding
       * point costs one row and avoids an unexplained blank cell.
       */
      const leadingOffset = Math.max(0, offset - 1);

      // Yielded before the first write, so nothing sets state synchronously in
      // the effect body — that starts a second render before the first has
      // committed.
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);

      const result = await callOr(
        api().tracks.points({
          id: ownerId,
          offset: leadingOffset,
          limit: PAGE + 1,
        }),
        null,
      );
      if (cancelled) return;

      if (result === null) {
        setLoading(false);
        return;
      }

      const hasLeading = leadingOffset < offset;
      const leading: TrackPoint | null = hasLeading
        ? (result.points[0] ?? null)
        : null;
      const points = hasLeading ? result.points.slice(1) : result.points;
      const firstIndex = hasLeading ? result.offset + 1 : result.offset;

      setPage({
        total: result.total,
        offset: firstIndex,
        rows: trackRows({
          points,
          offset: firstIndex,
          segmentBreaks: result.segmentBreaks,
          leading,
        }),
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `reloadToken` is a dependency but not read in the body: bumping it is
    // how a mutation asks for the same window again. The alternative — an
    // imperative fetch function called from the mutation handler — writes
    // state outside an effect and cascades.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [offset, ownerId, ownerType, reloadToken]);

  /*
   * Whether the map is drawing simplified geometry for this track.
   *
   * Requirement 4.3: the table always shows exact points, so where the map is
   * showing a thinned line the two disagree by design — and the table has to
   * say so rather than leave the user wondering why a point they can see in
   * the list is not drawn.
   */
  useEffect(() => {
    // No write on the route branch: the initial state is already false, and
    // the component is keyed on its owner so it remounts rather than switching
    // kind underneath this.
    if (ownerType !== 'track') return;

    let cancelled = false;
    void (async () => {
      // Asked of the main process at the map's current zoom rather than
      // derived from the cache threshold here: the threshold is the main
      // process's business, and duplicating it is how the two drift apart.
      const zoom = Math.round(getMapInstance()?.getZoom() ?? 13);
      const result = await callOr(
        api().tracks.geometry({ id: ownerId, zoom }),
        null,
      );
      if (!cancelled && result !== null) setMapSimplified(result.simplified);
    })();
    return () => {
      cancelled = true;
    };
    // Not re-asked after an edit: whether the map is drawing the cache depends
    // on the zoom, which an edit does not change.
  }, [ownerId, ownerType]);

  const requestWindow = useCallback(
    (firstVisible: number) => {
      if (ownerType !== 'track') return;
      setOffset((current) => {
        // Only refetch once the viewport has left the loaded window, with a
        // margin — a scroll fires continuously, and a request per frame would
        // queue hundreds of reads for windows already passed.
        const margin = PAGE / 4;
        if (
          firstVisible >= current + margin &&
          firstVisible <= current + PAGE - margin
        ) {
          return current;
        }
        return Math.max(0, firstVisible - margin);
      });
    },
    [ownerType],
  );

  const reload = useCallback(async () => {
    if (ownerType === 'track') {
      setReloadToken((token) => token + 1);
      return;
    }
    // A route's canonical array lives in the selection store, so reloading it
    // is reloading the selection — which the map reads too, keeping the two
    // views of the same geometry in step.
    await useSelectionStore.getState().reload();
  }, [ownerType]);

  if (ownerType === 'route') {
    return {
      rows: routeRowsFor,
      total: routeRowsFor.length,
      offset: 0,
      loading: false,
      mapSimplified: false,
      requestWindow,
      reload,
    };
  }

  return {
    rows: page?.rows ?? NO_ROWS,
    // The cached count until the first window lands, so the scrollbar is the
    // right size on the first paint rather than snapping once.
    total: page?.total ?? trackPointCount ?? 0,
    offset: page?.offset ?? 0,
    loading,
    mapSimplified,
    requestWindow,
    reload,
  };
}
