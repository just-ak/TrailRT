import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { LatLon } from '@shared/geo/distance';
import { farthestFrom } from '@shared/geo/divergence';
import type { Candidate } from '@shared/routing/results';
import { CANDIDATE_COLOURS, type CandidateSummary } from './candidates';
import { interactivePane } from './interactivePane';

/**
 * Draws the routes on offer for one leg and lets the user pick one.
 * Phase 6, Requirement 1.3–1.5 and 2.2.
 *
 * The selected candidate is drawn as the route; the others underneath in
 * distinct colours, thinner and translucent, so none of them can be mistaken
 * for it. Each carries a label at the point where it departs furthest from
 * candidate A — the place a reader needs to look to see how they differ.
 *
 * Its own pane, above the shaping handles, because while candidates are shown
 * the choice between them is the thing being done.
 */

export interface CandidateLayerOptions {
  active: boolean;
  candidates: readonly Candidate[];
  summaries: readonly CandidateSummary[];
  selected: number;
  hovered: number | null;
  /** The leg as it is now, drawn dashed for comparison on a saved route. */
  current: readonly LatLon[] | null;
  selectedColour: string;
  /** Escape dismisses. Off in the snap routing tool, where Escape cancels the tool. */
  escapeDismisses: boolean;
  onSelect: (index: number) => void;
  onHover: (index: number | null) => void;
  onDismiss: () => void;
}

const PANE = 'trailrt-candidates';
const toTuple = (p: LatLon): L.LatLngTuple => [p.lat, p.lon];


function labelIcon(text: string, colour: string, emphasised: boolean): L.DivIcon {
  const safe = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return L.divIcon({
    className: 'trailrt-candidate-label',
    iconSize: undefined,
    iconAnchor: [0, 12],
    html: `<div style="
        display:inline-block;white-space:nowrap;
        padding:2px 6px;border-radius:4px;
        background:#ffffff;color:#0f172a;
        border:2px solid ${colour};
        font-size:11px;font-weight:${emphasised ? 700 : 600};line-height:1.3;
        box-shadow:0 1px 3px rgba(0,0,0,0.3);
      ">${safe}</div>`,
  });
}

export function useCandidateLayers(map: L.Map | null, options: CandidateLayerOptions): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const { active, candidates, selected, hovered, current, selectedColour, summaries } = options;

  // --- drawing
  useEffect(() => {
    if (map === null || !active || candidates.length === 0) return;
    const renderer = interactivePane(map, PANE, 645);
    const group = L.layerGroup().addTo(map);
    const first = candidates[0] as Candidate;

    if (current !== null && current.length > 1) {
      L.polyline(current.map(toTuple), {
        pane: PANE,
        renderer,
        color: selectedColour,
        weight: 3,
        dashArray: '4 6',
        opacity: 0.9,
        interactive: false,
      }).addTo(group);
    }

    // Unselected first, so the selected one is drawn on top.
    const order = candidates.map((_, i) => i).toSorted((a, b) => Number(a === selected) - Number(b === selected));
    for (const i of order) {
      const c = candidates[i] as Candidate;
      const isSelected = i === selected;
      const isHovered = i === hovered;
      const colour = isSelected ? selectedColour : (CANDIDATE_COLOURS[i] ?? '#64748b');
      const latlngs = c.shape.map(toTuple);

      L.polyline(latlngs, {
        pane: PANE,
        renderer,
        color: colour,
        weight: isSelected ? 6 : isHovered ? 6 : 4,
        opacity: isSelected || isHovered ? 1 : 0.6,
        interactive: false,
      }).addTo(group);

      // A wide invisible hit area, so a 4 px line can actually be clicked.
      const hit = L.polyline(latlngs, { pane: PANE, renderer, color: colour, weight: 16, opacity: 0.01 });
      hit.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        optionsRef.current.onSelect(i);
      });
      hit.on('dblclick', (event) => L.DomEvent.stopPropagation(event));
      hit.on('mouseover', () => optionsRef.current.onHover(i));
      hit.on('mouseout', () => optionsRef.current.onHover(null));
      hit.addTo(group);

      const anchor =
        i === 0
          ? c.shape[Math.floor(c.shape.length / 2)]
          : (farthestFrom(c.shape, first.shape)?.midpoint ?? c.shape[Math.floor(c.shape.length / 2)]);
      const summary = summaries[i];
      if (anchor !== undefined && summary !== undefined) {
        L.marker(toTuple(anchor), {
          pane: PANE,
          icon: labelIcon(summary.mapLabel, colour, isSelected),
          interactive: false,
        }).addTo(group);
      }
    }

    return () => {
      group.clearLayers();
      group.remove();
    };
  }, [map, active, candidates, selected, hovered, current, selectedColour, summaries]);

  // --- keyboard: 1, 2, 3 choose; Escape dismisses where that is allowed
  useEffect(() => {
    if (!active || candidates.length === 0) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const index = ['1', '2', '3'].indexOf(event.key);
      if (index >= 0 && index < optionsRef.current.candidates.length) {
        event.preventDefault();
        optionsRef.current.onSelect(index);
        return;
      }
      if (event.key === 'Escape' && optionsRef.current.escapeDismisses) {
        event.preventDefault();
        event.stopPropagation();
        optionsRef.current.onDismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, candidates.length]);
}
