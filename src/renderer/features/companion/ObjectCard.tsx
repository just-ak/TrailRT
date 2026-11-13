import { Activity, Camera, Folder as FolderIcon, MapPin, Route as RouteIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ObjectRef, UnitSystem } from '@shared/domain/types';
import { formatCoordinates, formatDistance, formatDuration, formatElevation } from '@shared/geo/units';
import { folderDetail } from '@shared/photos/library';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Card, CardTitle, KIND_COLOUR } from './parts';

/**
 * The selected object's card (design §4.3), with the pencil to its editor.
 * Task 8 adds its day, photos and surroundings beneath; here it says what the
 * object is and which trip holds it. Missing values are left out, never
 * shown as zero.
 */

function climb(gain: number | null, loss: number | null, units: UnitSystem): string | null {
  if (gain === null || loss === null) return null;
  return `+${formatElevation(gain, units)} · −${formatElevation(loss, units)}`;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function useTripName(tripId: string | undefined): string | null {
  return useLibraryStore((s) => (tripId === undefined ? null : (s.overview.find((t) => t.id === tripId)?.name ?? null)));
}

export function ObjectCard({ refTo, onEdit }: { refTo: ObjectRef; onEdit: () => void }): ReactNode {
  const { route, track, waypoint, folder, linkedFolder } = useSelectionStore();
  const units = useSettingsStore((s) => s.settings.units);
  const owner = route?.tripId ?? track?.tripId ?? waypoint?.tripId ?? linkedFolder?.tripId;
  const tripName = useTripName(owner);
  const inTrip = tripName === null ? null : `In ${tripName}`;

  let body: ReactNode = <p className="text-[12px] text-[var(--color-text-muted)]">Loading…</p>;
  if (refTo.kind === 'route' && route?.id === refTo.id) {
    body = (
      <CardTitle
        icon={<RouteIcon size={18} aria-hidden="true" style={{ color: KIND_COLOUR.route }} />}
        title={route.name}
        lines={[
          [route.distanceM === null ? null : formatDistance(route.distanceM, units), route.source === 'import' ? 'imported' : 'drawn'].filter(Boolean).join(' · '),
          climb(route.elevGainM, route.elevLossM, units),
          inTrip,
        ]}
        onEdit={onEdit}
        editHint="Edit the route"
      />
    );
  } else if (refTo.kind === 'track' && track?.id === refTo.id) {
    const when =
      track.startedAt === null || track.endedAt === null
        ? 'No timestamps: it cannot be placed on a day'
        : `${clock(track.startedAt)} · ${formatDuration(track.durationS)}`;
    body = (
      <CardTitle
        icon={<Activity size={18} aria-hidden="true" style={{ color: KIND_COLOUR.track }} />}
        title={track.name}
        lines={[when, [track.distanceM === null ? null : formatDistance(track.distanceM, units), climb(track.elevGainM, track.elevLossM, units)].filter(Boolean).join(' · '), inTrip]}
        onEdit={onEdit}
        editHint="Edit the track"
      />
    );
  } else if (refTo.kind === 'waypoint' && waypoint?.id === refTo.id) {
    body = (
      <CardTitle
        icon={<MapPin size={18} aria-hidden="true" style={{ color: KIND_COLOUR.waypoint }} />}
        title={waypoint.name}
        lines={[formatCoordinates(waypoint.lat, waypoint.lon), waypoint.eleM === null ? null : formatElevation(waypoint.eleM, units), inTrip]}
        onEdit={onEdit}
        editHint="Edit the waypoint"
      />
    );
  } else if (refTo.kind === 'folder' && folder?.id === refTo.id) {
    body = (
      <CardTitle
        icon={<FolderIcon size={18} aria-hidden="true" style={{ color: KIND_COLOUR.folder }} />}
        title={folder.name}
        lines={['A folder of trips']}
        onEdit={onEdit}
        editHint="Edit the folder"
      />
    );
  } else if (refTo.kind === 'linkedFolder' && linkedFolder?.id === refTo.id) {
    body = (
      <CardTitle
        icon={<Camera size={18} aria-hidden="true" style={{ color: KIND_COLOUR.photo }} />}
        title={linkedFolder.name}
        lines={[folderDetail(linkedFolder.photos, linkedFolder.state), linkedFolder.displayPath, inTrip]}
        onEdit={onEdit}
        editHint="Edit the linked folder"
      />
    );
  }
  return <Card testId="object-card">{body}</Card>;
}
