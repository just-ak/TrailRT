import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { LatLon } from '@shared/geo/distance';
import type { PreviewedLeg } from '@shared/routing/results';

/**
 * The interactive snap routing tool's map interaction and preview layer.
 *
 * Deliberately a sibling of `useDrawMode` rather than a flag on it. The two
 * gestures look the same and behave differently in ways that matter:
 * `useDrawMode` keeps every click as a route vertex, while here a click is a
 * **control point** and the vertices between them come from the provider. A
 * shared hook would need a branch at every step and the distinction is exactly
 * what a reader needs to see.
 *
 * ## What the user can tell apart on screen
 *
 * - A **routed leg** is a solid line in the accent colour: this follows roads.
 * - An **unmatched leg** is dashed red, matching `useSnapOverlay` so a straight
 *   section looks identical whether it appeared during routing or after a
 *   whole-route snap. Requirement 3.6.
 * - A **gap still being routed** is a faint dotted line straight to the next
 *   control point, so a slow provider shows as pending rather than as a route
 *   that quietly stops short.
 *
 * That third state is the one worth having. Without it, a leg in flight is
 * indistinguishable from a leg that failed, and the user's next action — click
 * again, or wait — depends on which it is.
 */

interface Options {
  active: boolean;
  controlPoints: readonly LatLon[];
  /** Null where a leg is still being routed. */
  legs: readonly (PreviewedLeg | null)[];
  routing: boolean;
  onAppend: (point: LatLon) => void;
  onUndoLast: () => void;
  /** ⌘Z: undo the last edit to the draft (Phase 6). */
  onUndo: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

export function useSnapRouting(map: L.Map | null, options: Options): void {
  const { active, controlPoints, legs, routing } = options;
  const groupRef = useRef<L.LayerGroup | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // --- interaction
  useEffect(() => {
    if (map === null || !active) return;

    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = 'crosshair';

    const onClick = (event: L.LeafletMouseEvent): void => {
      /*
       * The click is accepted even while a leg is in flight.
       *
       * Blocking clicks during a request would make the tool feel broken on a
       * slow provider. The legs are queued and routed in order by
       * `drainSnapLegs`, so clicking ahead is safe and the preview catches up.
       */
      optionsRef.current.onAppend({
        lat: event.latlng.lat,
        lon: event.latlng.lng,
      });
    };

    /*
     * Double-click finishes, wherever in the map it lands.
     *
     * A native listener on the container, in the capture phase, rather than
     * Leaflet's map `dblclick`. The first click of a double-click places a
     * point, and that point's draggable handle is then directly under the
     * pointer: the second click and the `dblclick` land on the handle, Leaflet
     * fires them on the marker, and the map never hears of it — so the route
     * silently failed to finish. Capturing at the container catches it before
     * any layer does, and stopping it there also keeps Leaflet from zooming.
     */
    const onDoubleClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      optionsRef.current.onFinish();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        optionsRef.current.onCancel();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        optionsRef.current.onFinish();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        optionsRef.current.onUndoLast();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z'
      ) {
        // Reached only when the Edit menu's Undo is disabled; when enabled,
        // its accelerator routes here through `actions.undo` instead.
        event.preventDefault();
        optionsRef.current.onUndo();
      }
    };

    map.on('click', onClick);
    container.addEventListener('dblclick', onDoubleClick, true);
    map.doubleClickZoom.disable();
    window.addEventListener('keydown', onKeyDown);

    return () => {
      map.off('click', onClick);
      container.removeEventListener('dblclick', onDoubleClick, true);
      map.doubleClickZoom.enable();
      window.removeEventListener('keydown', onKeyDown);
      container.style.cursor = previousCursor;
    };
  }, [map, active]);

  // --- preview layer
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

  useEffect(() => {
    const group = groupRef.current;
    if (map === null || group === null) return;

    group.clearLayers();
    if (!active || controlPoints.length === 0) return;

    for (const [index, leg] of legs.entries()) {
      if (leg === null) {
        /*
         * A leg still being routed: a faint dotted line straight between its
         * points, so a slow provider shows as pending rather than as a route
         * that quietly stops short. Drawn per hole now that a drag in the
         * middle of the draft can open one anywhere (Phase 6).
         */
        const from = controlPoints[index];
        const to = controlPoints[index + 1];
        if (from === undefined || to === undefined) continue;
        L.polyline(
          [
            [from.lat, from.lon],
            [to.lat, to.lon],
          ],
          {
            color: routing ? '#f59e0b' : '#94a3b8',
            weight: 2,
            dashArray: '2 5',
            opacity: 0.8,
            interactive: false,
          },
        ).addTo(group);
        continue;
      }
      const latlngs = leg.shape.map((p) => [p.lat, p.lon] as L.LatLngTuple);
      L.polyline(
        latlngs,
        leg.matched
          ? { color: '#f59e0b', weight: 4, interactive: false }
          : // Same styling as a snapped route's unmatched legs, so the meaning
            // is learned once.
            {
              color: '#dc2626',
              weight: 3,
              dashArray: '6 6',
              interactive: false,
            },
      ).addTo(group);
    }

    // The points themselves are drawn, numbered and draggable, by
    // `useRouteShaping` (Phase 6), which owns every edit to them.
  }, [map, active, controlPoints, legs, routing]);
}
