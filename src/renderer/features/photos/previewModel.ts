import type { FolderState, PhotoDetails } from '@shared/domain/linkedFolders';
import type { UnitSystem } from '@shared/domain/types';
import { formatCoordinates, formatElevation } from '@shared/geo/units';
import { fileName, photoStateText, takenText } from '@shared/photos/library';

/**
 * What the preview box says about one photo (design §10, Requirement 6.3).
 * Pure, so every state is tested without a window. Absent values produce no
 * line at all: never a dash, never a zero.
 */

export const CAMERA_TIME_PREVIEW_HINT =
  'No time zone was recorded with this photo, so this is the time its camera’s clock showed.';

export interface PreviewModel {
  name: string;
  /** The path inside the linked folder, for the name's hint. */
  pathHint: string;
  taken: string;
  takenHint: string | null;
  location: string | null;
  altitude: string | null;
  accuracy: string | null;
  /** For a photo not on the map: "No location" and why, or why it could not be read. */
  noLocation: string | null;
  /** The photo cannot be reached: the folder is not there, or it is in iCloud. */
  status: string | null;
  /** "3 of 29", or "2 of 7 here" within a burst. `null` when there is only one. */
  position: string | null;
  canStepBack: boolean;
  canStepForward: boolean;
  canZoom: boolean;
  zoomHint: string;
  canOpen: boolean;
  openHint: string;
  canReveal: boolean;
  revealHint: string;
}

export interface PreviewInput {
  details: PhotoDetails;
  folderState: FolderState | null;
  units: UnitSystem;
  /** The photos the arrows step through, in taken-time order. */
  sequence: readonly string[];
  /** True when the sequence is a burst opened from the map (design §9.3). */
  inBurst: boolean;
}

export function previewModel(input: PreviewInput): PreviewModel {
  const { photo, folderName } = input.details;
  const unavailable = input.folderState === 'missing' || input.folderState === 'denied';
  const notDownloaded = photo.state === 'not-downloaded';
  const located = photo.lat !== null && photo.lon !== null && photo.state === 'located';

  const taken = takenText(photo);
  const cameraTime = photo.takenLocal !== null && photo.takenOffsetMin === null;

  const status = unavailable
    ? input.folderState === 'missing'
      ? `Unavailable — ${folderName} is not connected`
      : `Unavailable — TrailRT has no access to ${folderName}`
    : notDownloaded
      ? 'Not downloaded from iCloud — open it in Finder to download'
      : null;

  const index = input.sequence.indexOf(photo.id);
  const total = input.sequence.length;
  const position = total > 1 && index >= 0 ? `${index + 1} of ${total}${input.inBurst ? ' here' : ''}` : null;

  return {
    name: fileName(photo.relativePath),
    pathHint: `${folderName}/${photo.relativePath}`,
    taken: cameraTime ? taken.replace(' (camera time)', ' · camera time') : taken,
    takenHint: cameraTime ? CAMERA_TIME_PREVIEW_HINT : null,
    location: located ? formatCoordinates(photo.lat ?? 0, photo.lon ?? 0) : null,
    altitude: located && photo.altitudeM !== null ? formatElevation(photo.altitudeM, input.units) : null,
    accuracy: located && photo.accuracyM !== null ? `±${formatElevation(photo.accuracyM, input.units)}` : null,
    noLocation: located || notDownloaded ? null : photoStateText(photo),
    status,
    position,
    canStepBack: index > 0,
    canStepForward: index >= 0 && index < total - 1,
    canZoom: located,
    zoomHint: located ? 'Zoom the map to this photo' : 'This photo has no location to zoom to',
    canOpen: !unavailable && !notDownloaded,
    openHint: unavailable
      ? 'Unavailable: its folder is not there'
      : notDownloaded
        ? 'Not downloaded: show it in Finder to download it first'
        : 'Open in the default app',
    canReveal: !unavailable,
    revealHint: unavailable ? 'Unavailable: its folder is not there' : 'Show in Finder',
  };
}
