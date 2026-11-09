import L from 'leaflet';

/**
 * A custom map pane whose empty areas let clicks through. Phase 6.
 *
 * The map draws paths on canvas. A canvas renderer puts one full-map canvas in
 * each pane it serves, and that canvas takes every pointer event over the
 * whole map whether or not anything is drawn under the pointer — so a pane
 * above the others, once it has ever held a path, silently blocks clicks on
 * every route, track and marker beneath it. The end-to-end test found exactly
 * that: the candidate pane, empty after a choice, swallowed the next drag.
 *
 * So these panes use SVG and switch pointer events off on the pane itself.
 * Leaflet gives interactive paths and markers an explicit `pointer-events:
 * auto`, so they still receive events; everything else falls through to the
 * panes below.
 */
const renderers = new WeakMap<L.Map, Map<string, L.Renderer>>();

export function interactivePane(map: L.Map, name: string, zIndex: number): L.Renderer {
  if (map.getPane(name) === undefined) {
    const pane = map.createPane(name);
    pane.style.zIndex = String(zIndex);
    pane.style.pointerEvents = 'none';
  }
  let byName = renderers.get(map);
  if (byName === undefined) {
    byName = new Map();
    renderers.set(map, byName);
  }
  let renderer = byName.get(name);
  if (renderer === undefined) {
    renderer = L.svg({ pane: name });
    byName.set(name, renderer);
  }
  return renderer;
}
