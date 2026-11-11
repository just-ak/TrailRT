import { useEffect, useRef } from 'react';
import type L from 'leaflet';
import type { LatLon } from '@shared/geo/distance';

/**
 * Extending a saved snapped route from its end. Phase 6, Requirement 6.5.
 *
 * Each map click appends a via point and routes the new leg; every click is
 * its own undo entry, because each is written as it happens rather than held
 * as a draft. Enter or Escape stops. Deliberately small: the routing, the
 * candidates and the write all live in `actions`, shared with every other
 * shaping edit.
 */
interface Options {
  active: boolean;
  onAppend: (point: LatLon) => void;
  onFinish: () => void;
}

export function useExtendRoute(map: L.Map | null, options: Options): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (map === null || !options.active) return;
    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = 'crosshair';

    const onClick = (event: L.LeafletMouseEvent): void => {
      optionsRef.current.onAppend({ lat: event.latlng.lat, lon: event.latlng.lng });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        optionsRef.current.onFinish();
      }
    };

    map.on('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      map.off('click', onClick);
      window.removeEventListener('keydown', onKey);
      container.style.cursor = previousCursor;
    };
  }, [map, options.active]);
}
