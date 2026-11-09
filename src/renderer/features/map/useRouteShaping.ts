import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { LatLon } from '@shared/geo/distance';
import { closestSegment } from '@shared/geo/routeEdit';
import {
  EditRefused,
  planEdit,
  type PlannedControl,
  type RouteEdit,
} from '@shared/routing/edit';
import type { SectionLocation } from '@shared/routing/RoutingProvider';
import type { PreviewedLeg } from '@shared/routing/results';
import { interactivePane } from './interactivePane';
import { endpointIcon, shapingIcon, viaIcon } from './markers';
import {
  IDLE,
  LatestWins,
  PreviewCancelled,
  step,
  type GestureEvent,
  type GestureOutput,
  type GestureState,
} from './shapingGesture';

/**
 * Drag-to-shape for a snapped route or the snap routing tool's draft.
 * Phase 6, design §4.
 *
 * Draws the control points as handles and gives every leg a wide invisible hit
 * area, then turns gestures into `RouteEdit`s:
 *
 * - drag the line → `insert` a shaping point where it was dropped
 * - click the line → `insertOnLine`, which changes no geometry
 * - drag a handle → `move`
 * - Alt-click a handle → `remove`
 *
 * While dragging it previews the result: road-following through the live
 * engine when it is in-process, straight lines otherwise. On release it hands
 * the edit and the previewed legs to `onCommit` — what is stored is what was
 * shown. It never writes anything itself, which is how the same hook serves a
 * saved route (commit goes through IPC) and the tool's draft (commit updates a
 * store).
 *
 * Everything lives in its own pane above the marker pane. Drawing modes switch
 * off pointer events on the ordinary object panes so every click reaches the
 * map; the snap routing tool still needs its own points to be draggable, and a
 * separate pane is how they stay reachable.
 */

export type ShapingTarget =
  | { type: 'handle'; index: number }
  | { type: 'line'; leg: number; at: LatLon };

export interface ShapingOptions {
  active: boolean;
  control: readonly PlannedControl[];
  /** Current shape of each leg; `control.length - 1` of them. */
  legs: readonly (readonly LatLon[])[];
  colour: string;
  /** Route while dragging. True for the in-process engine. */
  live: boolean;
  /** An edit is being applied: handles are inert until it lands. */
  busy: boolean;
  /** Control indices where the route turns back on itself. */
  reversals?: readonly number[];
  /** Whether to draw start and finish badges. */
  endpoints?: boolean;
  route: (section: SectionLocation[]) => Promise<PreviewedLeg[]>;
  onCommit: (edit: RouteEdit, legs: PreviewedLeg[] | null) => void | Promise<void>;
  onError?: (cause: unknown) => void;
  onContextMenu?: (target: ShapingTarget, x: number, y: number) => void;
}

const PANE = 'trailrt-shaping';
const HIT_WEIGHT = 16;
const PREVIEW_COLOUR = '#f59e0b';


const toTuple = (p: LatLon): L.LatLngTuple => [p.lat, p.lon];

function keyOf(options: ShapingOptions): string {
  const control = options.control
    .map((c) => `${c.point.lat},${c.point.lon},${c.role}`)
    .join('|');
  const legs = options.legs
    .map((leg) => `${leg.length}:${leg[0]?.lat},${leg[0]?.lon}:${leg.at(-1)?.lat},${leg.at(-1)?.lon}`)
    .join('|');
  return `${control}#${legs}#${options.colour}#${options.busy}#${(options.reversals ?? []).join(',')}#${options.endpoints === true}`;
}

export function useRouteShaping(map: L.Map | null, options: ShapingOptions): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const key = options.active ? keyOf(options) : 'inactive';

  useEffect(() => {
    if (map === null || !optionsRef.current.active) return;
    // A non-null alias: hoisted function declarations below cannot see the
    // narrowing of `map` above.
    const leaflet: L.Map = map;
    // Above markers (600) so handles win over the route's own vertex markers,
    // below tooltips (650) and popups.
    const renderer = interactivePane(leaflet, PANE, 640);

    const opts = (): ShapingOptions => optionsRef.current;
    const { control, legs, colour, busy } = opts();
    if (control.length === 0) return;

    const layers = L.layerGroup().addTo(map);
    const preview = L.layerGroup().addTo(map);
    // The ghost handle under the pointer, kept apart so preview redraws —
    // which clear `preview` — cannot remove it mid-drag.
    const ghost = L.layerGroup().addTo(map);
    // Mutable gesture state for this effect's lifetime, held in an object so
    // event handlers update it in place.
    const machine: { state: GestureState; handleDrag: boolean; handleCancelled: boolean } = {
      state: IDLE,
      handleDrag: false,
      handleCancelled: false,
    };
    // What the current drag has produced so far.
    const drag: {
      ghost: L.Marker | null;
      section: SectionLocation[] | null;
      edit: RouteEdit | null;
    } = { ghost: null, section: null, edit: null };

    // ----------------------------------------------------------- preview

    const drawStraight = (section: readonly SectionLocation[]): void => {
      preview.clearLayers();
      L.polyline(section.map((s) => toTuple(s.point)), {
        pane: PANE,
        renderer,
        color: PREVIEW_COLOUR,
        weight: 3,
        dashArray: '6 6',
        interactive: false,
      }).addTo(preview);
    };

    const drawRouted = (routed: readonly PreviewedLeg[]): void => {
      preview.clearLayers();
      for (const leg of routed) {
        L.polyline(
          leg.shape.map(toTuple),
          leg.matched
            ? { pane: PANE, renderer, color: PREVIEW_COLOUR, weight: 5, interactive: false }
            : { pane: PANE, renderer, color: '#dc2626', weight: 3, dashArray: '6 6', interactive: false },
        ).addTo(preview);
      }
    };

    const live = new LatestWins<SectionLocation[], PreviewedLeg[]>(
      (section) => opts().route(section),
      (_section, routed) => drawRouted(routed),
      // A failed preview is not reported mid-drag; the release routes again
      // and reports if that fails too.
      () => undefined,
    );

    const showPreview = (edit: RouteEdit): void => {
      drag.edit = edit;
      let plan;
      try {
        plan = planEdit(opts().control, opts().legs, edit);
      } catch {
        preview.clearLayers();
        drag.section = null;
        return;
      }
      if (plan.section === null) {
        preview.clearLayers();
        drag.section = null;
        return;
      }
      drag.section = plan.section;
      if (opts().live) {
        // Straight lines until the first routed reply lands, so the gesture
        // is never without feedback.
        if (preview.getLayers().length === 0) drawStraight(plan.section);
        live.request(plan.section);
      } else {
        drawStraight(plan.section);
      }
    };

    const reset = (): void => {
      live.cancel();
      preview.clearLayers();
      drag.ghost?.remove();
      drag.ghost = null;
      drag.section = null;
      drag.edit = null;
      map.dragging.enable();
    };

    const commit = async (edit: RouteEdit): Promise<void> => {
      const o = opts();
      try {
        const plan = planEdit(o.control, o.legs, edit);
        let routed: PreviewedLeg[] | null = null;
        if (plan.section !== null) {
          const section = drag.section ?? plan.section;
          routed = o.live ? await live.settle(section) : await o.route(section);
        }
        await o.onCommit(edit, routed);
      } catch (cause) {
        if (cause instanceof PreviewCancelled) return;
        o.onError?.(cause instanceof EditRefused ? new Error(cause.message) : cause);
      } finally {
        reset();
      }
    };

    // ------------------------------------------------- line press and drag

    const latLngAt = (event: MouseEvent): LatLon => {
      const ll = map.mouseEventToLatLng(event);
      return { lat: ll.lat, lon: ll.lng };
    };

    const handle = (event: GestureEvent, mouse?: MouseEvent): void => {
      const next = step(machine.state, event);
      machine.state = next.state;
      act(next.output, mouse);
    };

    const onMove = (event: MouseEvent): void => {
      const point = map.mouseEventToContainerPoint(event);
      handle({ type: 'move', x: point.x, y: point.y }, event);
    };
    const onUp = (event: MouseEvent): void => {
      detach();
      handle({ type: 'up' }, event);
    };
    const attach = (): void => {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    const detach = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    function act(output: GestureOutput, mouse?: MouseEvent): void {
      if (output === null || output.target.type !== 'line') return;
      const leg = output.target.leg;

      switch (output.type) {
        case 'click': {
          leaflet.dragging.enable();
          const shape = opts().legs[leg];
          if (shape === undefined || mouse === undefined) return;
          const hit = closestSegment(
            shape.map((p) => ({ ...p, ele: null, name: null, symbol: null, notes: null })),
            latLngAt(mouse),
          );
          if (hit === null) return;
          void commit({
            kind: 'insertOnLine',
            leg,
            segmentEnd: hit.insertIndex,
            at: { lat: hit.lat, lon: hit.lon },
          });
          return;
        }
        case 'dragStart':
        case 'dragMove': {
          if (mouse === undefined) return;
          const at = latLngAt(mouse);
          if (drag.ghost === null) {
            drag.ghost = L.marker(toTuple(at), {
              pane: PANE,
              icon: shapingIcon(opts().colour),
              interactive: false,
            }).addTo(ghost);
          } else {
            drag.ghost.setLatLng(toTuple(at));
          }
          showPreview({ kind: 'insert', leg, at });
          return;
        }
        case 'dragEnd': {
          const edit = drag.edit;
          if (edit === null) {
            reset();
            return;
          }
          void commit(edit);
          return;
        }
        case 'cancel':
          reset();
          return;
      }
    }

    // ---------------------------------------------------------- hit areas

    for (const [index, shape] of legs.entries()) {
      if (shape.length < 2) continue;
      const hit = L.polyline(shape.map(toTuple), {
        pane: PANE,
        renderer,
        color: colour,
        weight: HIT_WEIGHT,
        // Near-transparent rather than zero, so every engine treats the stroke
        // as painted and hit-testable.
        opacity: 0.01,
        interactive: !busy,
        className: 'trailrt-shaping-hit',
      });
      hit.on('mousedown', (event: L.LeafletMouseEvent) => {
        if (opts().busy || event.originalEvent.button !== 0) return;
        L.DomEvent.stop(event);
        map.dragging.disable();
        const point = map.mouseEventToContainerPoint(event.originalEvent);
        handle({ type: 'down', target: { type: 'line', leg: index }, x: point.x, y: point.y });
        attach();
      });
      // The click that follows mouseup must not reach the map: in the snap
      // routing tool a map click appends a point.
      hit.on('click', (event) => L.DomEvent.stopPropagation(event));
      hit.on('dblclick', (event) => L.DomEvent.stopPropagation(event));
      hit.on('contextmenu', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        opts().onContextMenu?.(
          { type: 'line', leg: index, at: { lat: event.latlng.lat, lon: event.latlng.lng } },
          event.originalEvent.clientX,
          event.originalEvent.clientY,
        );
      });
      hit.addTo(layers);
    }

    // ------------------------------------------------------------ handles

    const reversals = new Set(opts().reversals ?? []);
    let viaNumber = 0;

    for (const [index, c] of control.entries()) {
      const isFirst = index === 0;
      const isLast = index === control.length - 1;
      if (c.role === 'via') viaNumber += 1;

      if (opts().endpoints === true && (isFirst || isLast)) {
        L.marker(toTuple(c.point), {
          pane: PANE,
          icon: endpointIcon(isFirst ? 'start' : 'end'),
          interactive: false,
          zIndexOffset: 100,
        }).addTo(layers);
      }

      const marker = L.marker(toTuple(c.point), {
        pane: PANE,
        icon:
          c.role === 'shaping'
            ? shapingIcon(colour, reversals.has(index), busy)
            : viaIcon(viaNumber, busy),
        draggable: !busy,
        zIndexOffset: c.role === 'via' ? 300 : 200,
        title:
          c.role === 'shaping'
            ? 'Shaping point — drag to move, Alt-click to remove'
            : `Point ${viaNumber} — drag to move, Alt-click to remove`,
      });

      marker.on('dragstart', () => {
        machine.handleDrag = true;
        machine.handleCancelled = false;
      });
      marker.on('drag', (event) => {
        if (machine.handleCancelled) return;
        const ll = (event as L.LeafletMouseEvent).latlng ?? marker.getLatLng();
        showPreview({ kind: 'move', index, to: { lat: ll.lat, lon: ll.lng } });
      });
      marker.on('dragend', () => {
        machine.handleDrag = false;
        if (machine.handleCancelled) {
          marker.setLatLng(toTuple(c.point));
          reset();
          return;
        }
        const ll = marker.getLatLng();
        const edit: RouteEdit = { kind: 'move', index, to: { lat: ll.lat, lon: ll.lng } };
        // Make sure the preview's section is the final position's.
        showPreview(edit);
        void commit(edit);
      });
      marker.on('click', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event);
        if (event.originalEvent.altKey && !opts().busy) void commit({ kind: 'remove', index });
      });
      marker.on('dblclick', (event) => L.DomEvent.stopPropagation(event));
      marker.on('contextmenu', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        opts().onContextMenu?.(
          { type: 'handle', index },
          event.originalEvent.clientX,
          event.originalEvent.clientY,
        );
      });
      marker.addTo(layers);
    }

    /*
     * Escape during a drag (Requirement 4.4). A line drag is abandoned through
     * the gesture machine. Leaflet cannot abort its own marker drag, so for a
     * handle the drop is ignored and the handle snapped back on release.
     * Captured, so it wins over the snap routing tool's Escape-cancels-tool.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (machine.handleDrag) {
        event.preventDefault();
        event.stopPropagation();
        machine.handleCancelled = true;
        preview.clearLayers();
        live.cancel();
        return;
      }
      if (machine.state.kind === 'idle') return;
      event.preventDefault();
      event.stopPropagation();
      detach();
      handle({ type: 'escape' });
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      detach();
      live.cancel();
      map.dragging.enable();
      layers.clearLayers();
      layers.remove();
      preview.clearLayers();
      preview.remove();
      ghost.clearLayers();
      ghost.remove();
    };
    // `key` stands in for the options, whose identity changes every render.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [map, key]);
}
