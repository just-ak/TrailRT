import L from 'leaflet';
import { resolveSymbol } from '@shared/domain/symbols';

/**
 * Leaflet icon factories.
 *
 * DivIcons rather than image sprites: the symbol vocabulary is small, the
 * glyphs are text, and this keeps the markers themable by the same CSS
 * variables as the rest of the app with no asset pipeline.
 *
 * Imported text is never injected as markup. The glyph comes from our own
 * vocabulary, and `escapeHtml` guards the one place a value could originate
 * from a file — an unrecognised imported symbol id.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function waypointIcon(
  symbolId: string | null,
  selected: boolean,
): L.DivIcon {
  const symbol = resolveSymbol(symbolId);
  const size = selected ? 30 : 26;
  const ring = selected ? '#ffffff' : 'rgba(255,255,255,0.85)';

  return L.divIcon({
    className: 'trailrt-waypoint-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
        width:${size}px;height:${size}px;
        display:flex;align-items:center;justify-content:center;
        border-radius:50%;
        background:${symbol.colour};
        border:2.5px solid ${ring};
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
        color:#fff;font-size:${selected ? 15 : 13}px;line-height:1;
        font-weight:600;
      ">${escapeHtml(symbol.glyph)}</div>`,
  });
}

/** Draggable handle on a selected route's vertex. */
export function vertexIcon(isEndpoint: boolean): L.DivIcon {
  const size = isEndpoint ? 14 : 11;
  return L.divIcon({
    className: 'trailrt-vertex-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
        width:${size}px;height:${size}px;
        border-radius:50%;
        background:${isEndpoint ? '#0f172a' : '#ffffff'};
        border:2px solid ${isEndpoint ? '#ffffff' : '#0f172a'};
        box-shadow:0 1px 3px rgba(0,0,0,0.35);
      "></div>`,
  });
}

/** Start and finish badges on a route. */
export function endpointIcon(kind: 'start' | 'end'): L.DivIcon {
  const colour = kind === 'start' ? '#16a34a' : '#dc2626';
  return L.divIcon({
    className: 'trailrt-endpoint-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="
        width:18px;height:18px;
        display:flex;align-items:center;justify-content:center;
        border-radius:50%;
        background:${colour};
        border:2px solid #ffffff;
        box-shadow:0 1px 3px rgba(0,0,0,0.35);
        color:#fff;font-size:10px;font-weight:700;line-height:1;
      ">${kind === 'start' ? 'S' : 'F'}</div>`,
  });
}

/** Ghost marker for a point being placed but not yet committed. */
export function pendingPointIcon(): L.DivIcon {
  return L.divIcon({
    className: 'trailrt-pending-marker',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    html: `<div style="
        width:10px;height:10px;border-radius:50%;
        background:#f59e0b;border:2px solid #ffffff;
      "></div>`,
  });
}

/**
 * A numbered via point on a snapped route: a place the route visits.
 * Phase 6, Requirement 7.1.
 */
export function viaIcon(number: number, busy = false): L.DivIcon {
  return L.divIcon({
    className: 'trailrt-via-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="
        width:18px;height:18px;
        display:flex;align-items:center;justify-content:center;
        border-radius:50%;
        background:#ffffff;
        border:2px solid #0f172a;
        box-shadow:0 1px 3px rgba(0,0,0,0.35);
        color:#0f172a;font-size:10px;font-weight:700;line-height:1;
        opacity:${busy ? 0.5 : 1};
        cursor:${busy ? 'progress' : 'grab'};
      ">${Math.trunc(number)}</div>`,
  });
}

/**
 * A shaping point: only bends the route onto a road. Smaller, hollow and
 * unnumbered so it cannot be mistaken for a place the route visits.
 * `warning` rings it when the route turns back on itself there.
 * Phase 6, Requirement 7.2 and design §5.
 */
export function shapingIcon(colour: string, warning = false, busy = false): L.DivIcon {
  const size = warning ? 15 : 11;
  return L.divIcon({
    className: 'trailrt-shaping-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
        width:${size}px;height:${size}px;
        box-sizing:border-box;
        border-radius:50%;
        background:rgba(255,255,255,0.9);
        border:2.5px solid ${warning ? '#dc2626' : colour};
        box-shadow:0 1px 2px rgba(0,0,0,0.3);
        opacity:${busy ? 0.5 : 1};
        cursor:${busy ? 'progress' : 'grab'};
      "></div>`,
  });
}

/**
 * A point of interest from the place data. Square and dashed, so it is never
 * mistaken for one of the trip's own waypoints, which are round.
 */
export function poiIcon(symbolId: string, focused: boolean): L.DivIcon {
  const symbol = resolveSymbol(symbolId);
  const size = focused ? 28 : 22;
  return L.divIcon({
    className: 'trailrt-poi-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
        width:${size}px;height:${size}px;
        display:flex;align-items:center;justify-content:center;
        border-radius:5px;
        background:${symbol.colour};
        border:2px dashed ${focused ? '#ffffff' : 'rgba(255,255,255,0.9)'};
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
        color:#fff;font-size:${focused ? 14 : 12}px;line-height:1;
      ">${escapeHtml(symbol.glyph)}</div>`,
  });
}

/** Several points of interest that would overlap at this zoom. */
export function poiClusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 26 : count < 100 ? 32 : 38;
  return L.divIcon({
    className: 'trailrt-poi-cluster',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
        width:${size}px;height:${size}px;
        display:flex;align-items:center;justify-content:center;
        border-radius:6px;background:#475569;color:#fff;
        border:2px dashed rgba(255,255,255,0.9);
        font-size:12px;font-weight:600;
      ">${count}</div>`,
  });
}
