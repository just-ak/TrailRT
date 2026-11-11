/**
 * Projecting region outlines onto the picker's map. ADR 0018.
 *
 * Equirectangular with longitude scaled by the cosine of the view's middle
 * latitude. Over a view the size of the UK that keeps shapes recognisable to
 * within a few per cent, and it is simple enough to be checked by eye — which
 * matters for a map whose only job is to let someone click on Derbyshire.
 *
 * Pure: shapes in, SVG path strings out, no DOM.
 */

export interface MapView {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/**
 * The views the picker offers.
 *
 * Fixed to land rather than fitted to the polygons: Geofabrik buffers its
 * boundaries far out to sea (Scotland's reaches 14.9°W for St Kilda and
 * Rockall), and fitting to that would shrink every English county to a few
 * pixels for the sake of open water.
 */
export const UK_VIEW: MapView = { minLon: -8.3, maxLon: 1.9, minLat: 49.85, maxLat: 60.95 };
export const ENGLAND_WALES_VIEW: MapView = {
  minLon: -5.9,
  maxLon: 1.9,
  minLat: 49.85,
  maxLat: 55.85,
};

export interface ProjectedRegion {
  id: string;
  /** SVG path data in pixel space. */
  d: string;
  /** Where to place a label: the centre of the largest ring's box. */
  labelX: number;
  labelY: number;
}

export function projection(
  view: MapView,
  width: number,
  height: number,
): (lon: number, lat: number) => [number, number] {
  const midLat = (view.minLat + view.maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = (view.maxLon - view.minLon) * kx;
  const spanY = view.maxLat - view.minLat;
  const scale = Math.min(width / spanX, height / spanY);
  // Centred, so a view narrower than the box does not hug the left edge.
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return (lon, lat) => [
    offsetX + (lon - view.minLon) * kx * scale,
    offsetY + (view.maxLat - lat) * scale,
  ];
}

export function projectRegions(
  regions: readonly { id: string; rings: readonly (readonly (readonly [number, number])[])[] }[],
  view: MapView,
  width: number,
  height: number,
): ProjectedRegion[] {
  const project = projection(view, width, height);

  return regions.map((region) => {
    let d = '';
    let best: { area: number; x: number; y: number } | null = null;

    for (const ring of region.rings) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      ring.forEach(([lon, lat], index) => {
        const [x, y] = project(lon, lat);
        d += `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });
      if (ring.length > 0) d += 'Z';
      const area = (maxX - minX) * (maxY - minY);
      if (best === null || area > best.area) {
        best = { area, x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      }
    }

    return { id: region.id, d, labelX: best?.x ?? 0, labelY: best?.y ?? 0 };
  });
}
