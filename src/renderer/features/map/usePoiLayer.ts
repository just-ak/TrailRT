import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { clusterPoints } from '@shared/geo/cluster';
import { symbolFor } from '@shared/poi/categories';
import type { PoiHit } from '@shared/poi/PoiProvider';
import { poiClusterIcon, poiIcon } from './markers';

/**
 * Points of interest found along a route, on their own layer. Phase 10
 * Requirement 6.6.
 *
 * Clustered by screen cell at the current zoom; clicking a cluster zooms into
 * it, clicking a POI focuses it in the panel. Redrawn from scratch on each
 * change: POIs are read-only and there are at most a few thousand, so there
 * is no drag to preserve and nothing to gain from diffing.
 */
export function usePoiLayer(
  map: L.Map | null,
  hits: readonly PoiHit[],
  focusedId: number | null,
  onFocus: (id: number) => void,
): void {
  const groupRef = useRef<L.LayerGroup | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  useEffect(() => {
    if (map === null) return;
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    const onZoom = (): void => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    onZoom();
    return () => {
      map.off('zoomend', onZoom);
      group.clearLayers();
      group.remove();
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (map === null || group === null || zoom === null) return;
    group.clearLayers();
    const points = hits.map((hit) => ({ lat: hit.poi.lat, lon: hit.poi.lon, hit }));
    for (const cluster of clusterPoints(points, zoom)) {
      const only = cluster.members.length === 1 ? cluster.members[0] : undefined;
      if (only !== undefined) {
        const { poi } = only.hit;
        const marker = L.marker([poi.lat, poi.lon], {
          icon: poiIcon(symbolFor({ category: poi.category, kind: poi.kind }), poi.id === focusedId),
          title: poi.name ?? poi.kind,
          keyboard: true,
          zIndexOffset: poi.id === focusedId ? 600 : 300,
        });
        marker.on('click', () => onFocusRef.current(poi.id));
        group.addLayer(marker);
        continue;
      }
      const marker = L.marker([cluster.lat, cluster.lon], {
        icon: poiClusterIcon(cluster.members.length),
        title: `${cluster.members.length} places`,
        zIndexOffset: 300,
      });
      marker.on('click', () => {
        const bounds = L.latLngBounds(cluster.members.map((m) => [m.lat, m.lon] as [number, number]));
        map.fitBounds(bounds.pad(0.3), { maxZoom: 18 });
      });
      group.addLayer(marker);
    }
  }, [map, hits, focusedId, zoom]);
}
