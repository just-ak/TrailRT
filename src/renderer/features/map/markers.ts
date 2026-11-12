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

// ---------------------------------------------------------- Phase 11 photos

/** A colour of their own, so photos are never mistaken for waypoints or POIs (design §9.2). */
export const PHOTO_COLOUR = '#0d9488';

const CAMERA_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';

/**
 * Unavailable photos (a folder disconnected or denied) are drawn dashed and
 * faded, never like available ones (design §9.5).
 */
function photoFrame(unavailable: boolean): string {
  return unavailable
    ? `background:#94a3b8;border:2px dashed #ffffff;opacity:0.6;`
    : `background:${PHOTO_COLOUR};border:2px solid #ffffff;`;
}

/**
 * One photo. The selected photo is larger, and shows a wedge pointing the way
 * the camera faced when the photo records it (design §9.4). Other markers do
 * not, which keeps thousands of markers plain.
 */
export function photoIcon(options: { selected: boolean; unavailable: boolean; direction: number | null }): L.DivIcon {
  const size = options.selected ? 26 : 18;
  const box = options.direction === null ? size : size + 24;
  const wedge =
    options.direction === null
      ? ''
      : `<svg width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" style="position:absolute;left:0;top:0;transform:rotate(${options.direction}deg)" aria-hidden="true">
          <path d="M${box / 2} ${box / 2} L${box / 2 - 9} 1 A${box / 2} ${box / 2} 0 0 1 ${box / 2 + 9} 1 Z" fill="${PHOTO_COLOUR}" fill-opacity="0.45" stroke="${PHOTO_COLOUR}" stroke-width="1"/>
        </svg>`;
  return L.divIcon({
    className: 'trailrt-photo-marker',
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    html: `<div style="position:relative;width:${box}px;height:${box}px;">${wedge}<div style="
        position:absolute;left:${(box - size) / 2}px;top:${(box - size) / 2}px;
        width:${size}px;height:${size}px;box-sizing:border-box;
        display:flex;align-items:center;justify-content:center;
        border-radius:50%;${photoFrame(options.unavailable)}
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
        ${options.selected ? 'outline:3px solid rgba(13,148,136,0.35);' : ''}
      ">${CAMERA_SVG}</div></div>`,
  });
}

/**
 * Several photos in one screen cell. A burst, which zooming cannot separate,
 * is marked with a stack so it reads as "these were taken here" (design §9.3).
 */
export function photoClusterIcon(count: number, options: { burst: boolean; unavailable: boolean }): L.DivIcon {
  const size = count < 10 ? 26 : count < 100 ? 32 : count < 1000 ? 38 : 44;
  const label = count < 10_000 ? String(count) : `${Math.floor(count / 1000)}k`;
  const stack = options.burst ? `box-shadow:3px -3px 0 -1px #ffffff,3px -3px 0 1px ${PHOTO_COLOUR},0 1px 4px rgba(0,0,0,0.4);` : 'box-shadow:0 1px 4px rgba(0,0,0,0.4);';
  return L.divIcon({
    className: 'trailrt-photo-cluster',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
        width:${size}px;height:${size}px;box-sizing:border-box;
        display:flex;align-items:center;justify-content:center;
        border-radius:50%;${photoFrame(options.unavailable)}${stack}
        color:#fff;font-size:12px;font-weight:600;
      ">${label}</div>`,
  });
}
