import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { FolderState, PhotoMapPoints } from '@shared/domain/linkedFolders';
import { directionText, viewClusters, type Bounds } from '@shared/photos/mapLayer';
import { photoClusterIcon, photoIcon } from './markers';

/**
 * Photos on the map, on their own layer. Phase 11, design §9.2 to §9.5.
 *
 * Only what is in view (padded by half a screen) is clustered and drawn, on
 * every move and zoom, so the number of markers is bounded by the screen and
 * not by the library (Requirement 5.2). A cluster that zooming cannot split,
 * a burst, opens its first photo and the preview steps through the rest
 * (Requirement 5.3). The selected photo is drawn on its own, above the
 * clusters, with a wedge for the way the camera faced (Requirement 5.4).
 * Photos in a folder that is not there are drawn dashed and faded, or hidden
 * if the user prefers (Requirement 5.5).
 */

export interface PhotoLayerInput {
  points: PhotoMapPoints | null;
  folders: Readonly<Record<string, { name: string; state: FolderState | null }>>;
  visible: boolean;
  showUnavailable: boolean;
  anchorId: string | null;
  /** The anchor's direction and its reference, from its details. */
  anchorDirection: { degrees: number; ref: 'T' | 'M' | null } | null;
  onSelect: (ids: readonly string[]) => void;
}

function boundsOf(map: L.Map): Bounds {
  const b = map.getBounds();
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
}

function unavailableText(name: string, state: FolderState | null): string | null {
  if (state === 'missing') return `Unavailable — ${name} is not connected`;
  if (state === 'denied') return `Unavailable — TrailRT has no access to ${name}`;
  return null;
}

export function usePhotoLayer(map: L.Map | null, input: PhotoLayerInput): void {
  const groupRef = useRef<L.LayerGroup | null>(null);
  const [view, setView] = useState<{ bounds: Bounds; zoom: number; maxZoom: number } | null>(null);
  const onSelectRef = useRef(input.onSelect);
  useEffect(() => {
    onSelectRef.current = input.onSelect;
  }, [input.onSelect]);

  useEffect(() => {
    if (map === null) return undefined;
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    const redraw = (): void => setView({ bounds: boundsOf(map), zoom: map.getZoom(), maxZoom: map.getMaxZoom() });
    map.on('moveend zoomend', redraw);
    redraw();
    return () => {
      map.off('moveend zoomend', redraw);
      group.clearLayers();
      group.remove();
      groupRef.current = null;
    };
  }, [map]);

  const { points, folders, visible, showUnavailable, anchorId, anchorDirection } = input;

  useEffect(() => {
    const group = groupRef.current;
    if (map === null || group === null || view === null) return;
    group.clearLayers();
    if (!visible || points === null || points.ids.length === 0) return;

    const unavailableFolder = points.folders.map((id) => {
      const folder = folders[id];
      return folder === undefined ? null : unavailableText(folder.name, folder.state);
    });
    const unavailableAt = (i: number): string | null => unavailableFolder[points.folder[i] ?? 0] ?? null;

    // The anchor is drawn on its own, above everything, so a selected photo is
    // never lost inside a cluster.
    const anchor = anchorId === null ? -1 : points.ids.indexOf(anchorId);
    const { maxZoom } = view;
    const clusters = viewClusters(points, view.bounds, view.zoom, maxZoom);

    for (const cluster of clusters) {
      const members = cluster.members.filter((i) => i !== anchor && (showUnavailable || unavailableAt(i) === null));
      if (members.length === 0) continue;
      const allUnavailable = members.every((i) => unavailableAt(i) !== null);
      const first = members[0] ?? 0;

      if (members.length === 1) {
        const marker = L.marker([points.lat[first] ?? 0, points.lon[first] ?? 0], {
          icon: photoIcon({ selected: false, unavailable: allUnavailable, direction: null }),
          title: unavailableAt(first) ?? 'Photo',
          keyboard: true,
          zIndexOffset: 250,
        });
        marker.on('click', () => onSelectRef.current([points.ids[first] ?? '']));
        group.addLayer(marker);
        continue;
      }

      const burst = cluster.inseparable;
      const marker = L.marker([cluster.lat, cluster.lon], {
        icon: photoClusterIcon(members.length, { burst, unavailable: allUnavailable }),
        title: burst ? `${members.length} photos taken here` : `${members.length} photos`,
        keyboard: true,
        zIndexOffset: 250,
      });
      marker.on('click', () => {
        if (burst) {
          onSelectRef.current(members.map((i) => points.ids[i] ?? ''));
          return;
        }
        const bounds = L.latLngBounds(members.map((i) => [points.lat[i] ?? 0, points.lon[i] ?? 0] as [number, number]));
        map.fitBounds(bounds.pad(0.3), { maxZoom });
      });
      group.addLayer(marker);
    }

    if (anchor >= 0 && (showUnavailable || unavailableAt(anchor) === null)) {
      const unavailable = unavailableAt(anchor);
      const hint =
        unavailable ??
        (anchorDirection === null ? 'Selected photo' : `Selected photo, facing ${directionText(anchorDirection.degrees, anchorDirection.ref)}`);
      const marker = L.marker([points.lat[anchor] ?? 0, points.lon[anchor] ?? 0], {
        icon: photoIcon({ selected: true, unavailable: unavailable !== null, direction: anchorDirection?.degrees ?? null }),
        title: hint,
        keyboard: true,
        zIndexOffset: 900,
      });
      group.addLayer(marker);
    }
  }, [map, view, points, folders, visible, showUnavailable, anchorId, anchorDirection]);

  // A photo selected in the list that is off screen is brought into view
  // (design §8.3). Only when the selection changes: a rescan that reloads the
  // points must not pull the map back, so they are read through a ref.
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);
  useEffect(() => {
    const current = pointsRef.current;
    if (map === null || current === null || anchorId === null) return;
    const i = current.ids.indexOf(anchorId);
    if (i < 0) return;
    const at = L.latLng(current.lat[i] ?? 0, current.lon[i] ?? 0);
    if (!map.getBounds().pad(-0.1).contains(at)) map.panTo(at);
  }, [map, anchorId]);
}
