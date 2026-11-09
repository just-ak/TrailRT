import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { boundingBox } from '@shared/geo/distance';

/**
 * Draws the points the table has selected, in a layer of their own.
 *
 * A separate layer group rather than restyling the existing markers, and that
 * is forced by two facts about how the map is built:
 *
 * - Leaflet runs with `preferCanvas: true`, so a track's points are
 *   `circleMarker`s drawn into a **shared canvas renderer**. There is no DOM
 *   node per point to restyle, and `setStyle()` on one of them redraws the
 *   whole renderer pane.
 * - The route handle effect in `useRouteLayers` does a full `clearLayers()`
 *   and rebuilds every vertex. Folding highlighting into it would rebuild
 *   every handle on every table-row click.
 *
 * So a row click touches only this group, and nothing else on the map is
 * rebuilt.
 *
 * Above `maxPoints` the layer draws the **extent** of the selection instead of
 * every point (Requirement 5.4). A select-all on a 200,000-point track would
 * otherwise attempt 200,000 markers, which is precisely what the `showPoints`
 * guards elsewhere exist to prevent.
 *
 * Read-only throughout: this changes no data and creates no undo entry.
 */

interface Options {
  /** Where to find a point by its flat index. Null when none is loaded. */
  pointAt: (index: number) => { lat: number; lon: number } | null;
  /** Flat indices to highlight. */
  indices: readonly number[];
  maxPoints: number;
  /** A highlighted point was clicked. The table scrolls to its row. */
  onPointClick?: (index: number) => void;
}

/** Distinct from both the vertex handles and the whole-object selection colour. */
const HIGHLIGHT = '#db2777';

/**
 * The pane highlights are drawn into.
 *
 * Set on each **layer**, not on the group. With `preferCanvas` a `circleMarker`
 * is drawn by a renderer that Leaflet creates per pane from the layer's own
 * `pane` option — `LayerGroup` has no DOM container, so an option there is
 * silently ignored and the highlights end up in the overlay pane, underneath
 * the track line they are meant to mark.
 */
const PANE = 'markerPane';

export function useHighlightLayer(map: L.Map | null, options: Options): void {
  const groupRef = useRef<L.LayerGroup | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (map === null) return;
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    return () => {
      group.clearLayers();
      group.remove();
      groupRef.current = null;
    };
  }, [map]);

  const key = options.indices.join(',');

  useEffect(() => {
    const group = groupRef.current;
    if (map === null || group === null) return;

    group.clearLayers();

    const { indices, maxPoints, pointAt } = optionsRef.current;
    if (indices.length === 0) return;

    const points = indices
      .map((index) => {
        const point = pointAt(index);
        return point === null
          ? null
          : { index, lat: point.lat, lon: point.lon };
      })
      .filter((point): point is { index: number; lat: number; lon: number } =>
        // A window-paged table can select an index whose point is not loaded.
        // Skipping it beats drawing a marker at a guessed position.
        point !== null,
      );

    if (points.length === 0) return;

    if (points.length > maxPoints) {
      const box = boundingBox(points);
      if (box === null) return;
      L.rectangle(
        [
          [box.minLat, box.minLon],
          [box.maxLat, box.maxLon],
        ],
        {
          pane: PANE,
          color: HIGHLIGHT,
          weight: 2,
          dashArray: '6 4',
          fill: false,
          interactive: false,
        },
      ).addTo(group);
      return;
    }

    for (const point of points) {
      const marker = L.circleMarker([point.lat, point.lon], {
        pane: PANE,
        radius: 5,
        color: '#ffffff',
        weight: 2,
        fillColor: HIGHLIGHT,
        fillOpacity: 1,
        // Clickable so the highlight is bidirectional (Requirement 5.2). The
        // table remains the accessible surface — a canvas-drawn point cannot
        // take keyboard focus (5.5).
        interactive: optionsRef.current.onPointClick !== undefined,
      });

      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        optionsRef.current.onPointClick?.(point.index);
      });

      marker.addTo(group);
    }
    // `key` stands in for the indices array, whose identity changes on every
    // render; `pointAt` is read through the ref so a new closure does not
    // rebuild the layer.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [map, key, options.maxPoints]);
}

/**
 * Whether a point is outside the current view.
 *
 * Used to *offer* to bring it into view rather than panning on every row
 * change, which would fight the pointer during a drag-select (Requirement
 * 5.3).
 */
export function isOffScreen(
  map: L.Map | null,
  point: { lat: number; lon: number } | null,
): boolean {
  if (map === null || point === null) return false;
  return !map.getBounds().contains([point.lat, point.lon]);
}
