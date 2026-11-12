import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { app, dialog, shell } from 'electron';
import { CHANNELS } from '@shared/ipc/channels';
import type { AppInfo, LicenceEntry } from '@shared/ipc/api';
import type { TrackSegment, UndoState } from '@shared/domain/types';
import { IMPORT_FORMATS } from '@shared/io/types';
import * as S from '@shared/ipc/schemas';
import { EVENTS } from '@shared/ipc/channels';
import { ctx, reopenDatabase } from '../context';
import * as historyRepo from '../db/repositories/importHistory';
import * as exportService from '../io/exportService';
import * as importService from '../io/importService';
import * as importSession from '../io/importSession';
import { readGpx } from '../io/gpx/read';
import { readKml } from '../io/kml/read';
import { readTcx } from '../io/tcx/read';
import { readCsv } from '../io/csv/read';
import { ServiceError } from '../services/errors';
import * as trackService from '../services/trackService';
import * as backupService from '../services/backupService';
import * as batchService from '../services/batchService';
import * as folderService from '../services/folderService';
import * as itineraryService from '../services/itineraryService';
import * as poiTripService from '../services/poiTripService';
import * as autoPlanService from '../services/autoPlanService';
import { batch } from '../services/compose';
import * as itineraryRepo from '../db/repositories/itineraries';
import { icsFromItinerary } from '../io/ics/fromItinerary';
import { writeIcs } from '../io/ics/write';
import type { Mutation } from '../services/folderService';
import * as geometryService from '../services/geometryService';
import * as libraryService from '../services/libraryService';
import * as profileService from '../services/profileService';
import * as providerService from '../services/providerService';
import * as roadAttributeService from '../services/roadAttributeService';
import * as routeService from '../services/routeService';
import * as routingService from '../services/routingService';
import * as shapingService from '../services/shapingService';
import * as settingsService from '../services/settingsService';
import * as tripService from '../services/tripService';
import { folderScanner, reconcileFolders } from '../linkedFolders/runtime';
import { resolveFilePath } from '../linkedFolders/resolve';
import { thumbnailCache } from '../photoCache/runtime';
import * as linkedFolderService from '../services/linkedFolderService';
import * as photoService from '../services/photoService';
import type { LinkedFolder, LinkedFolderSummary, PhotoMapScope } from '@shared/domain/linkedFolders';
import { assertNotInLinkedFolder } from '../linkedFolders/writeGuard';
import * as undoService from '../services/undoService';
import * as waypointService from '../services/waypointService';
import { readLoadedRegion, writeLoadedRegion } from '../routing/embedded';
import { currentEmbeddedPaths } from '../routing/embeddedLocation';
import { importRegion } from '../routing/regionImport';
import { buildPlacesOrWarn } from '../places/build';
import { fetchListing, updatePostcodes } from '../places/postcodes';
import { createSearchService } from '../places/searchService';
import {
  createPoiProvider,
  estimateDetour,
  itineraryLine,
  routeLine,
  searchAlong,
} from '../places/poiService';
import { placesState } from '../places/store';
import { isValidDate } from '@shared/time/zoned';
import type { AlongSection, Poi } from '@shared/poi/PoiProvider';
import type { ItineraryStop } from '@shared/domain/itinerary';
import type { RoutingProvider, TransportMode } from '@shared/routing/RoutingProvider';
import {
  downloadAndBuild,
  regionMap,
  regionSizes,
  suggestRegions,
} from '../routing/regionCatalogue';
import { createTerrainStore, type TerrainStore } from '../terrain/terrainStore';
import { openExternal } from '../security/navigation';
import { installApplicationMenu } from '../menu/appMenu';
import { sendToRenderer } from '../window';
import { handle, handleNoArgs } from './handler';
import { RUNTIME_NOTICES, THIRD_PARTY_LICENCES } from '../licences';

const REPOSITORY_URL = 'https://github.com/trailrt/trailrt';

/**
 * Re-reads the retained original bytes of a track to recover its geometry.
 *
 * Only the synchronous text formats are handled. KMZ and FIT are async, and
 * threading a promise through `restoreOriginal` would make the whole mutation
 * path async for one recovery case — so those are refused with an explanation
 * rather than half-supported. Re-importing the file is the alternative, and it
 * works today.
 */
function reparseTrackSegments(
  format: string,
  bytes: Uint8Array,
): readonly TrackSegment[] {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const source = `original.${format}`;

  const parsed = (() => {
    switch (format) {
      case 'gpx':
        return readGpx(text, source);
      case 'kml':
        return readKml(text, source);
      case 'tcx':
        return readTcx(text, source);
      case 'csv':
        return readCsv(text, source);
      default:
        throw new ServiceError(
          'INVALID_REQUEST',
          `Restoring from a retained ${format.toUpperCase()} file is not supported yet. Import the file again instead.`,
        );
    }
  })();

  return parsed.tracks.flatMap((track) =>
    track.segments.map((segment) => ({
      points: segment.points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        ele: point.ele,
        time: point.time,
      })),
    })),
  );
}

/**
 * Records a mutation's inverse on the undo stack, tells the renderer the
 * library changed, and pushes the new undo state so the Edit menu can update.
 *
 * Every mutating handler goes through this, which is what guarantees the stack
 * and the menu cannot fall out of step with the database.
 */
/**
 * A POI looked up again in the main process, so the renderer never supplies
 * the coordinates or tags a waypoint is made from.
 */
function poiFor(poiId: number): { poi: Poi; dataDate: string | null } {
  const paths = currentEmbeddedPaths();
  const poi = createPoiProvider(paths).get(poiId);
  if (poi === null) throw new ServiceError('NOT_FOUND', 'That place is no longer in the place data.');
  const state = placesState(paths);
  return { poi, dataDate: state.kind === 'ready' ? state.dataDate : null };
}

/** Along-the-route searches in flight, by the renderer's request id. */
const alongJobs = new Map<string, AbortController>();

/** The line a POI search runs along: one route, or a whole itinerary. */
function lineFor(scope: { kind: 'route'; routeId: string } | { kind: 'itinerary'; tripId: string }) {
  const db = ctx().handle.db;
  if (scope.kind === 'route') return routeLine(db, scope.routeId);
  const view = itineraryService.get(db, scope.tripId, planning());
  if (view === null) throw new ServiceError('NOT_FOUND', 'That trip has no itinerary.');
  return itineraryLine(db, view);
}

/** The routing provider if one is usable, or why not. Never throws. */
function optionalProvider(): { provider: RoutingProvider | null; mode: TransportMode; unavailable: string } {
  const db = ctx().handle.db;
  const mode = settingsService.all(db).transportMode;
  const resolution = providerService.resolve(db);
  return resolution.available
    ? { provider: resolution.provider, mode, unavailable: '' }
    : {
        provider: null,
        mode,
        unavailable:
          resolution.status.message ?? 'Drives are planned by road once routing is available. Add map regions in Settings.',
      };
}

/** Why a by-road leg has no route, for the itinerary view. */
function planIssue(): (stop: ItineraryStop) => string | null {
  const { provider, unavailable } = optionalProvider();
  return () =>
    provider === null
      ? unavailable
      : 'This drive could not be planned by road. Try “Plan the drives by road” again, choose a route, or mark it as other transport.';
}

/**
 * Applies a change, plans the drives it leaves without a route in each trip
 * named, and records all of it as one undo step (design §15.2).
 */
async function withPlanning<T>(tripIds: readonly string[], mutation: Mutation<T>, label?: string): Promise<T> {
  const db = ctx().handle.db;
  const { provider, mode, unavailable } = optionalProvider();
  const planned: Mutation<unknown>[] = [];
  for (const tripId of tripIds) {
    // oxlint-disable-next-line no-await-in-loop
    const result = await autoPlanService.autoPlan(db, provider, mode, tripId, unavailable);
    planned.push(...result.mutations);
  }
  if (planned.length === 0) {
    if (mutation.inverse.kind === 'none') {
      ctx().notifyLibraryChanged();
      return mutation.result;
    }
    return commit(mutation, label);
  }
  return commit(batch(mutation.result, mutation, ...planned), label ?? 'plan drives');
}

/** The postcode download in flight, so it can be cancelled. One at a time. */
let postcodeJob: AbortController | null = null;

/** The settings an itinerary's timeline is computed with. Phase 10. */
function planning(): itineraryService.PlanningSettings {
  const settings = settingsService.all(ctx().handle.db);
  return { walkingSpeedKmh: settings.planningSpeedKmh, transportMode: settings.transportMode };
}

function commit<T>(mutation: Mutation<T>, label?: string): T {
  // `label` names a batch by its count and composition — "delete 3 routes and
  // 1 track" — which a flat record keyed by command kind cannot express. Every
  // other caller leaves it out and gets the per-kind label.
  undoService.record(mutation.inverse, label);
  ctx().notifyLibraryChanged();
  publishUndoState(undoService.state());
  return mutation.result;
}

/**
 * Tells the renderer and rebuilds the native menu.
 *
 * The Edit menu labels itself with what it will reverse, and Electron menus are
 * immutable once built, so a change in the stack means rebuilding. Doing both
 * from one function is what keeps the menu from drifting out of step.
 */
function publishUndoState(state: UndoState): void {
  sendToRenderer(EVENTS.undoStateChanged, state);
  installApplicationMenu(state);
}

/**
 * Wires every channel. Handlers validate then delegate; they contain no
 * business logic of their own.
 *
 * `ctx().handle.db` is read at call time rather than captured, because
 * restoring a backup replaces the database handle.
 */

/**
 * One terrain store per directory, so its in-memory tile cache survives
 * between profiles. Keyed by directory because tests and the packaged app use
 * different user-data roots.
 */
let terrainStore: { dir: string; store: TerrainStore } | null = null;
function terrainFor(paths: { terrainDir: string }): TerrainStore {
  if (terrainStore === null || terrainStore.dir !== paths.terrainDir) {
    terrainStore = { dir: paths.terrainDir, store: createTerrainStore(paths.terrainDir) };
  }
  return terrainStore.store;
}

// ------------------------------------------------- Phase 11: linked folders

/** One folder as the renderer sees it, with its counts and runtime state. */
function summaryOf(folder: LinkedFolder): LinkedFolderSummary {
  const summary = photoService
    .folderSummaries(ctx().handle.db, folder.tripId, (id) => folderScanner()?.runtime(id) ?? null)
    .find((s) => s.id === folder.id);
  if (summary === undefined) throw new ServiceError('NOT_FOUND', 'That linked folder could not be found.');
  return summary;
}

/** The Photos view filter without the keys zod leaves `undefined`. */
function photoFilter(raw: { year?: number | 'none' | undefined; tripId?: string | undefined }): libraryService.PhotoViewFilter {
  const filter: libraryService.PhotoViewFilter = {};
  if (raw.year !== undefined) filter.year = raw.year;
  if (raw.tripId !== undefined) filter.tripId = raw.tripId;
  return filter;
}

/** The native folder chooser. Its path goes to the service, never to the renderer. */
async function chooseDirectory(title: string, buttonLabel: string): Promise<string | null> {
  const chosen = await dialog.showOpenDialog({
    title,
    buttonLabel,
    properties: ['openDirectory', 'createDirectory'],
  });
  return chosen.canceled || chosen.filePaths[0] === undefined ? null : chosen.filePaths[0];
}

/** The path guard of design §7.2, with the scanner's view of whether the folder is there. */
function resolvePhoto(photoId: string) {
  return resolveFilePath(ctx().handle.db, photoId, (id) => folderScanner()?.runtime(id)?.state ?? null);
}

function thumbnails() {
  return thumbnailCache(ctx().paths.photoThumbnailsDir);
}

/**
 * After anything that may have added or removed folder rows without going
 * through the link handlers (undo, redo, restoring a backup): the scanner
 * catches up, and thumbnails of folders no longer linked go.
 */
function afterFolderRowsChanged(): void {
  reconcileFolders();
  void thumbnails()
    .removeOrphanFolders(ctx().handle.db)
    .catch((cause: unknown) => console.error('[photos] could not remove old thumbnails:', cause));
}

export function registerIpcHandlers(): void {
  // ------------------------------------------------------------- library
  handle(CHANNELS.library.tree, S.libraryTreeRequest, (req) =>
    libraryService.tree(ctx().handle.db, {
      includeArchived: req.includeArchived,
      sortKey: req.sortKey,
      ...(req.photos === undefined ? {} : { photos: photoFilter(req.photos) }),
      folderState: (id) => folderScanner()?.runtime(id)?.state ?? null,
    }),
  );

  // --------------------------------------------------------------- trips
  handle(CHANNELS.trips.list, S.tripListRequest, (req) =>
    tripService.list(ctx().handle.db, {
      folderId: req.folderId,
      includeArchived: req.includeArchived,
      sortKey: req.sortKey,
      sortDirection: req.sortDirection,
    }),
  );

  handle(CHANNELS.trips.get, S.tripGetRequest, (req) =>
    tripService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.trips.create, S.tripCreateRequest, (req) =>
    commit(tripService.create(ctx().handle.db, req)));

  handle(CHANNELS.trips.update, S.tripUpdateRequest, (req) =>
    commit(tripService.update(ctx().handle.db, req)));

  handle(CHANNELS.trips.duplicate, S.tripDuplicateRequest, (req) =>
    commit(tripService.duplicate(ctx().handle.db, req.id)));

  handle(CHANNELS.trips.move, S.tripMoveRequest, (req) =>
    commit(tripService.move(ctx().handle.db, req)));

  handle(CHANNELS.trips.setStatus, S.tripSetStatusRequest, (req) =>
    commit(tripService.setStatus(ctx().handle.db, req)));

  handle(CHANNELS.trips.delete, S.tripDeleteRequest, (req) =>
    commit(tripService.remove(ctx().handle.db, req.id)));

  handle(CHANNELS.trips.search, S.tripSearchRequest, (req) =>
    tripService.search(ctx().handle.db, req.query),
  );

  // ------------------------------------------------------------- folders
  handleNoArgs(CHANNELS.folders.list, () => folderService.list(ctx().handle.db));

  handle(CHANNELS.folders.get, S.folderGetRequest, (req) =>
    folderService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.folders.create, S.folderCreateRequest, (req) =>
    commit(folderService.create(ctx().handle.db, req)));

  handle(CHANNELS.folders.rename, S.folderRenameRequest, (req) =>
    commit(folderService.rename(ctx().handle.db, req)));

  handle(CHANNELS.folders.move, S.folderMoveRequest, (req) =>
    commit(folderService.move(ctx().handle.db, req)));

  handle(CHANNELS.folders.delete, S.folderDeleteRequest, (req) =>
    commit(folderService.remove(ctx().handle.db, req.id)));

  // ------------------------------------------------------------ settings
  handleNoArgs(CHANNELS.settings.all, () => settingsService.all(ctx().handle.db));

  handle(CHANNELS.settings.set, S.settingsSetRequest, (req) =>
    settingsService.set(ctx().handle.db, req.key, req.value),
  );

  // -------------------------------------------------------------- backup
  handleNoArgs(CHANNELS.backup.list, () =>
    backupService.listBackups(ctx().paths.backupsDir),
  );

  handleNoArgs(CHANNELS.backup.create, async () => {
    const current = ctx();
    const retention = settingsService.all(current.handle.db).backupRetention;
    return backupService.createBackup(
      current.handle,
      current.paths.backupsDir,
      retention,
    );
  });

  handleNoArgs(CHANNELS.backup.createTo, async () => {
    const current = ctx();
    const stamp = new Date().toISOString().slice(0, 10);
    const chosen = await dialog.showSaveDialog({
      title: 'Save a Copy',
      defaultPath: `TrailRT-${stamp}.db`,
      filters: [{ name: 'TrailRT database', extensions: ['db'] }],
    });
    if (chosen.canceled || chosen.filePath === undefined) {
      return { cancelled: true, path: null };
    }
    await assertNotInLinkedFolder(current.handle.db, chosen.filePath);
    await backupService.createBackupAt(current.handle, chosen.filePath);
    return { cancelled: false, path: chosen.filePath };
  });

  handle(CHANNELS.backup.restore, S.backupRestoreRequest, async (req) => {
    const current = ctx();
    const retention = settingsService.all(current.handle.db).backupRetention;
    await backupService.restoreBackup({
      handle: current.handle,
      databaseFile: current.paths.databaseFile,
      backupsDir: current.paths.backupsDir,
      fileName: req.fileName,
      retention,
    });
    reopenDatabase();
    // The restored database has its own folder rows (Phase 11 Requirement 10.2).
    afterFolderRowsChanged();
    // The undo stack describes a database that no longer exists. Applying any
    // of it would corrupt the restored data, so it is discarded.
    const undoState = undoService.clear();
    ctx().notifyLibraryChanged();
    publishUndoState(undoState);
    return true as const;
  });

  // -------------------------------------------------------------- routes
  handle(CHANNELS.routes.listForTrip, S.routeListForTripRequest, (req) =>
    routeService.listForTrip(ctx().handle.db, req.tripId),
  );

  handleNoArgs(CHANNELS.routes.listAll, () =>
    routeService.listAll(ctx().handle.db),
  );

  handle(CHANNELS.routes.get, S.routeGetRequest, (req) =>
    routeService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.routes.create, S.routeCreateRequest, (req) =>
    commit(routeService.create(ctx().handle.db, req)),
  );

  handle(CHANNELS.routes.update, S.routeUpdateRequest, (req) =>
    commit(routeService.update(ctx().handle.db, req)),
  );

  handle(CHANNELS.routes.setGeometry, S.routeSetGeometryRequest, (req) =>
    commit(routeService.setGeometry(ctx().handle.db, req)),
  );

  handle(CHANNELS.routes.reverse, S.routeReverseRequest, (req) =>
    commit(routeService.reverse(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.routes.duplicate, S.routeDuplicateRequest, (req) =>
    commit(routeService.duplicate(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.routes.move, S.routeMoveRequest, (req) =>
    commit(routeService.moveToTrip(ctx().handle.db, req)),
  );

  handle(CHANNELS.routes.delete, S.routeDeleteRequest, (req) =>
    commit(routeService.remove(ctx().handle.db, req.id)),
  );

  // ---------------------------------------------------------------- places
  // Phase 10. Points of interest from `places.sqlite`, never a network
  // service. Only `detour` can reach a provider, the user's own routing one.

  handleNoArgs(CHANNELS.places.status, () => placesState(currentEmbeddedPaths()));

  handleNoArgs(CHANNELS.places.rebuild, async () => {
    const paths = currentEmbeddedPaths();
    const loaded = readLoadedRegion(paths);
    if (loaded === null || loaded.regionIds.length === 0) {
      throw new ServiceError(
        'INVALID_REQUEST',
        'These map regions came from a file, so they cannot be downloaded again. Import the file again to build its place data.',
      );
    }
    const result = await downloadAndBuild(paths, loaded.regionIds, {
      terrain: terrainFor(paths),
      onProgress: (progress) => sendToRenderer(EVENTS.regionJobProgress, progress),
    });
    writeLoadedRegion(paths, result);
    return result;
  });

  handle(CHANNELS.places.along, S.placesAlongRequest, async (req) => {
    const line = lineFor(req.scope);
    let section: AlongSection;
    if (req.section.kind === 'near') {
      section = { kind: 'near', point: { lat: req.section.lat, lon: req.section.lon }, radiusM: req.section.radiusM };
    } else if (req.section.kind === 'day') {
      if (!isValidDate(req.section.date)) throw new ServiceError('INVALID_REQUEST', 'That is not a real date.');
      section = { kind: 'day', date: req.section.date };
    } else {
      section = req.section;
    }
    const job = new AbortController();
    alongJobs.get(req.requestId)?.abort();
    alongJobs.set(req.requestId, job);
    try {
      return await searchAlong(createPoiProvider(currentEmbeddedPaths()), {
        line,
        categories: req.categories,
        widthM: req.widthM,
        section,
        signal: job.signal,
      });
    } finally {
      if (alongJobs.get(req.requestId) === job) alongJobs.delete(req.requestId);
    }
  });

  handle(CHANNELS.places.cancel, S.placesCancelRequest, (req) => {
    alongJobs.get(req.requestId)?.abort();
    return null;
  });

  handle(CHANNELS.places.detour, S.placesDetourRequest, async (req) => {
    const poi = createPoiProvider(currentEmbeddedPaths()).get(req.poiId);
    if (poi === null) throw new ServiceError('NOT_FOUND', 'That place is no longer in the place data.');
    const { provider, mode } = providerService.requireProvider(ctx().handle.db);
    return estimateDetour(provider, mode, lineFor(req.scope).index, poi);
  });

  handle(CHANNELS.places.get, S.placesGetRequest, (req) =>
    createPoiProvider(currentEmbeddedPaths()).get(req.poiId),
  );

  handle(CHANNELS.places.addWaypoint, S.placesAddWaypointRequest, (req) => {
    const { poi, dataDate } = poiFor(req.poiId);
    return commit(poiTripService.addPoiWaypoint(ctx().handle.db, poi, req.tripId, dataDate));
  });

  handle(CHANNELS.itinerary.addPoiStop, S.itineraryAddPoiStopRequest, async (req) => {
    const { poi, dataDate } = poiFor(req.poiId);
    const mutation = poiTripService.addPoiStop(ctx().handle.db, poi, { tripId: req.tripId, index: req.index, dataDate });
    return withPlanning([req.tripId], mutation, 'add stop');
  });

  handle(CHANNELS.itinerary.exportIcs, S.itineraryExportIcsRequest, async (req) => {
    const db = ctx().handle.db;
    const view = itineraryService.get(db, req.tripId, planning());
    if (view === null) throw new ServiceError('NOT_FOUND', 'That trip has no itinerary to export.');
    const trip = tripService.get(db, req.tripId);
    const output = writeIcs(icsFromItinerary(view, trip.name, { includeLegs: req.includeLegs, now: Date.now() }));
    const chosen = await dialog.showSaveDialog({
      title: 'Export to Calendar',
      defaultPath: `${trip.name.replaceAll(/[\\/:*?"<>|]+/g, ' ').trim() || 'Trip'}.ics`,
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (chosen.canceled || chosen.filePath === undefined) return { cancelled: true as const, fileName: null };
    await assertNotInLinkedFolder(db, chosen.filePath);
    await writeFile(chosen.filePath, output.text, 'utf8');
    return {
      cancelled: false as const,
      fileName: basename(chosen.filePath),
      eventCount: output.eventCount,
      omitted: output.omitted,
    };
  });

  handle(CHANNELS.itinerary.planLeg, S.itineraryStopRequest, async (req) => {
    const db = ctx().handle.db;
    const { provider, mode } = providerService.requireProvider(db);
    return commit(await poiTripService.planLeg(db, provider, mode, req.id), 'plan leg');
  });

  handle(CHANNELS.itinerary.planAround, S.itineraryStopRequest, async (req) => {
    const db = ctx().handle.db;
    const { provider, mode } = providerService.requireProvider(db);
    return commit(await poiTripService.planAround(db, provider, mode, req.id), 'route through stop');
  });

  // ---------------------------------------------------------------- search
  // Phase 10. Answered from local files only; no handler here reaches the
  // network except `postcodes.listing` and `postcodes.update`, which the user
  // starts from Settings.

  handle(CHANNELS.search.query, S.searchQueryRequest, (req) =>
    createSearchService({ paths: currentEmbeddedPaths() }).search(
      req.text,
      { lat: req.lat, lon: req.lon },
      req.limit ?? 20,
    ),
  );

  handleNoArgs(CHANNELS.search.status, () =>
    createSearchService({ paths: currentEmbeddedPaths() }).status(),
  );

  handleNoArgs(CHANNELS.postcodes.listing, async () => {
    const listing = await fetchListing();
    return { release: listing.release, sizeBytes: listing.sizeBytes, date: null, count: null };
  });

  handleNoArgs(CHANNELS.postcodes.update, async () => {
    if (postcodeJob !== null) {
      throw new ServiceError('CONFLICT', 'The postcode data is already being downloaded.');
    }
    const job = new AbortController();
    postcodeJob = job;
    try {
      const meta = await updatePostcodes(currentEmbeddedPaths().gazetteerDir, {
        signal: job.signal,
        onProgress: (receivedBytes, totalBytes) =>
          sendToRenderer(EVENTS.postcodeProgress, {
            stage: receivedBytes >= totalBytes ? 'reading' : 'downloading',
            receivedBytes,
            totalBytes,
          }),
      });
      return { release: meta.release, sizeBytes: null, date: meta.date, count: meta.count };
    } finally {
      postcodeJob = null;
    }
  });

  handleNoArgs(CHANNELS.postcodes.cancel, () => {
    postcodeJob?.abort();
    return null;
  });

  // ------------------------------------------------------------ itinerary
  // Phase 10. The view is computed here, where the routes' lengths and modes
  // are, and sent whole; the renderer never does timeline arithmetic.

  handle(CHANNELS.itinerary.get, S.itineraryGetRequest, (req) =>
    itineraryService.get(ctx().handle.db, req.tripId, planning(), planIssue()),
  );

  // Plans every by-road leg that needs it: the retry after adding map
  // regions, or for a plan made before automatic planning existed.
  handle(CHANNELS.itinerary.planAll, S.itineraryGetRequest, async (req) =>
    withPlanning([req.tripId], { result: null, inverse: { kind: 'none', payload: {} } }, 'plan drives'),
  );

  handle(CHANNELS.itinerary.create, S.itineraryCreateRequest, (req) =>
    commit(itineraryService.create(ctx().handle.db, req)),
  );

  handle(CHANNELS.itinerary.remove, S.itineraryRemoveRequest, (req) =>
    commit(itineraryService.remove(ctx().handle.db, req.tripId)),
  );

  handle(CHANNELS.itinerary.update, S.itineraryUpdateRequest, (req) => {
    const { tripId, ...patch } = req;
    return commit(itineraryService.update(ctx().handle.db, tripId, patch));
  });

  // Phase 10 feedback: every change to the plan's shape plans the drives it
  // leaves without a route, and records both as one undo step (§15.2).
  handle(CHANNELS.itinerary.addStop, S.itineraryAddStopRequest, async (req) =>
    withPlanning([req.tripId], itineraryService.addStop(ctx().handle.db, req), 'add stop'),
  );

  handle(CHANNELS.itinerary.removeStop, S.itineraryStopRequest, async (req) => {
    const tripId = itineraryRepo.findStop(ctx().handle.db, req.id)?.tripId;
    const mutation = itineraryService.removeStop(ctx().handle.db, { id: req.id });
    return withPlanning(tripId === undefined ? [] : [tripId], mutation, 'remove stop');
  });

  handle(CHANNELS.itinerary.moveStop, S.itineraryMoveStopRequest, async (req) => {
    const mutation = itineraryService.moveStop(ctx().handle.db, req);
    return withPlanning([mutation.result.tripId], mutation, 'stop move');
  });

  handle(CHANNELS.itinerary.updateStop, S.itineraryUpdateStopRequest, (req) => {
    const { id, ...patch } = req;
    return commit(itineraryService.updateStop(ctx().handle.db, id, patch));
  });

  handle(CHANNELS.itinerary.linkLeg, S.itineraryLinkLegRequest, async (req) => {
    const mutation = itineraryService.linkLeg(ctx().handle.db, req);
    return withPlanning([mutation.result.tripId], mutation, 'leg route');
  });

  handle(CHANNELS.itinerary.setLegMode, S.itinerarySetLegModeRequest, async (req) => {
    const mutation = itineraryService.setLegMode(ctx().handle.db, req);
    return withPlanning([mutation.result.tripId], mutation, 'leg travel');
  });

  // ------------------------------------------------------------ waypoints
  handle(CHANNELS.waypoints.listForTrip, S.waypointListForTripRequest, (req) =>
    waypointService.listForTrip(ctx().handle.db, req.tripId),
  );

  handleNoArgs(CHANNELS.waypoints.listAll, () =>
    waypointService.listAll(ctx().handle.db),
  );

  handle(CHANNELS.waypoints.get, S.waypointGetRequest, (req) =>
    waypointService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.waypoints.create, S.waypointCreateRequest, (req) =>
    commit(waypointService.create(ctx().handle.db, req)),
  );

  // A waypoint that is a stop takes its drives with it when it moves.
  handle(CHANNELS.waypoints.update, S.waypointUpdateRequest, async (req) => {
    const mutation = waypointService.update(ctx().handle.db, req);
    const moved = req.lat !== undefined || req.lon !== undefined;
    const trips = moved ? itineraryRepo.tripIdsForWaypoint(ctx().handle.db, req.id) : [];
    return withPlanning(trips, mutation);
  });

  handle(CHANNELS.waypoints.move, S.waypointMoveRequest, async (req) => {
    const mutation = waypointService.move(ctx().handle.db, req);
    return withPlanning(itineraryRepo.tripIdsForWaypoint(ctx().handle.db, req.id), mutation);
  });

  handle(CHANNELS.waypoints.duplicate, S.waypointDuplicateRequest, (req) =>
    commit(waypointService.duplicate(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.waypoints.moveToTrip, S.waypointMoveToTripRequest, (req) =>
    commit(waypointService.moveToTrip(ctx().handle.db, req)),
  );

  handle(CHANNELS.waypoints.delete, S.waypointDeleteRequest, (req) =>
    commit(waypointService.remove(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.waypoints.search, S.waypointSearchRequest, (req) =>
    waypointService.search(ctx().handle.db, req.query),
  );

  handle(CHANNELS.waypoints.groups, S.waypointGroupsRequest, (req) =>
    waypointService.groups(ctx().handle.db, req.tripId),
  );

  handle(CHANNELS.waypoints.createGroup, S.waypointCreateGroupRequest, (req) =>
    commit(waypointService.createGroup(ctx().handle.db, req)),
  );

  // --------------------------------------------------------------- tracks
  handle(CHANNELS.tracks.listForTrip, S.trackListForTripRequest, (req) =>
    trackService.listForTrip(ctx().handle.db, req.tripId),
  );

  handleNoArgs(CHANNELS.tracks.listAll, () =>
    trackService.listAll(ctx().handle.db),
  );

  handle(CHANNELS.tracks.get, S.trackGetRequest, (req) =>
    trackService.get(ctx().handle.db, req.id),
  );

  handle(CHANNELS.tracks.geometry, S.trackGeometryRequest, (req) =>
    trackService.geometryFor(ctx().handle.db, req.id, req.zoom),
  );

  handle(CHANNELS.tracks.update, S.trackUpdateRequest, (req) =>
    commit(trackService.update(ctx().handle.db, req)),
  );

  handle(CHANNELS.tracks.move, S.trackMoveRequest, (req) =>
    commit(trackService.moveToTrip(ctx().handle.db, req)),
  );

  handle(CHANNELS.tracks.reverse, S.trackReverseRequest, (req) =>
    commit(trackService.reverse(ctx().handle.db, req.id)),
  );

  // Read-only: the preview exists so the user sees the cost before agreeing to
  // it, so it must not record anything on the undo stack.
  handle(CHANNELS.tracks.previewSimplify, S.trackPreviewSimplifyRequest, (req) =>
    trackService.previewSimplify(ctx().handle.db, req.id, req.toleranceM),
  );

  handle(CHANNELS.tracks.simplify, S.trackSimplifyRequest, (req) =>
    commit(trackService.simplifyTrack(ctx().handle.db, req.id, req.toleranceM)),
  );

  handle(CHANNELS.tracks.split, S.trackSplitRequest, (req) =>
    commit(trackService.split(ctx().handle.db, req.id, req.pointIndex)),
  );

  handle(CHANNELS.tracks.join, S.trackJoinRequest, (req) =>
    commit(trackService.join(ctx().handle.db, req)),
  );

  handle(CHANNELS.tracks.deleteRange, S.trackDeleteRangeRequest, (req) =>
    commit(
      trackService.deletePointRange(ctx().handle.db, req.id, req.from, req.to),
    ),
  );

  handle(CHANNELS.tracks.delete, S.trackDeleteRequest, (req) =>
    commit(trackService.remove(ctx().handle.db, req.id)),
  );

  handle(CHANNELS.tracks.hasOriginal, S.trackHasOriginalRequest, (req) => {
    const original = trackService.originalBytes(ctx().handle.db, req.id);
    return original === null
      ? { hasOriginal: false, format: null }
      : { hasOriginal: true, format: original.format };
  });

  handle(
    CHANNELS.tracks.restoreOriginal,
    S.trackRestoreOriginalRequest,
    (req) =>
      commit(
        trackService.restoreOriginal(
          ctx().handle.db,
          req.id,
          reparseTrackSegments,
        ),
      ),
  );

  // Read-only: the point table's paging. Records nothing.
  handle(CHANNELS.tracks.points, S.trackPointsPageRequest, (req) =>
    trackService.pointsPage(ctx().handle.db, req),
  );

  handle(CHANNELS.tracks.editPoint, S.trackEditPointRequest, (req) =>
    commit(trackService.editPointAt(ctx().handle.db, req)),
  );

  handle(CHANNELS.tracks.deletePoints, S.trackDeletePointsRequest, (req) =>
    commit(trackService.deletePointsAt(ctx().handle.db, req.id, req.indices)),
  );

  // --------------------------------------------------------------- batch
  /*
   * One handler per batch operation, plus a dry run.
   *
   * `assess` deliberately records nothing and mutates nothing: it exists so
   * the confirmation dialog can name what will not be reversible *before* the
   * user agrees to it, rather than reporting it afterwards.
   */
  handle(CHANNELS.batch.assess, S.batchAssessRequest, (req) =>
    batchService.assess(ctx().handle.db, req.members, req.operation),
  );

  handle(CHANNELS.batch.delete, S.batchDeleteRequest, (req) => {
    const mutation = batchService.remove(ctx().handle.db, req.members);
    // One commit for the whole batch: one undo entry, one library-changed
    // event, one native-menu rebuild — Requirement 2.7.
    return commit(
      mutation,
      batchService.labelFor('delete', mutation.result.counts),
    );
  });

  handle(CHANNELS.batch.move, S.batchMoveRequest, (req) => {
    const mutation = batchService.moveToTrip(
      ctx().handle.db,
      req.members,
      req.tripId,
    );
    return commit(
      mutation,
      batchService.labelFor('move', mutation.result.counts),
    );
  });

  // --------------------------------------------------------------- import
  handleNoArgs(CHANNELS.importing.choose, async () => {
    const chosen = await dialog.showOpenDialog({
      title: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'All supported',
          extensions: [...IMPORT_FORMATS],
        },
        { name: 'GPX', extensions: ['gpx'] },
        { name: 'KML / KMZ', extensions: ['kml', 'kmz'] },
        { name: 'TCX', extensions: ['tcx'] },
        { name: 'FIT', extensions: ['fit'] },
        { name: 'CSV', extensions: ['csv'] },
        { name: 'TrailRT collection', extensions: ['json'] },
      ],
    });
    if (chosen.canceled) return [];
    return importSession.stageFiles(chosen.filePaths);
  });

  // Paths here come from `webUtils.getPathForFile` in the preload bridge, so
  // they originate from a real drag-and-drop rather than renderer-side string
  // construction.
  handle(CHANNELS.importing.addPaths, S.importAddPathsRequest, (req) =>
    importSession.stageFiles(req.paths),
  );

  handle(CHANNELS.importing.commit, S.importCommitRequest, async (req) => {
    const reports = await importSession.commitStaged(
      ctx().handle.db,
      req.files,
      (progress) => sendToRenderer(EVENTS.importProgress, progress),
    );
    // An import is not undoable — it can write hundreds of thousands of rows —
    // so the stack is left alone and the library is simply refreshed. Deleting
    // the imported trip is the documented way back.
    ctx().notifyLibraryChanged();
    return reports;
  });

  handle(CHANNELS.importing.discard, S.importDiscardRequest, (req) => {
    importSession.discard(req.tokens);
    return true as const;
  });

  handle(CHANNELS.importing.history, S.importHistoryRequest, (req) =>
    importService.listHistory(ctx().handle.db, req.limit),
  );

  handleNoArgs(CHANNELS.importing.clearHistory, () => ({
    removed: historyRepo.clear(ctx().handle.db),
  }));

  // --------------------------------------------------------------- export
  handle(CHANNELS.exporting.options, S.exportOptionsRequest, (req) =>
    exportService.formatOptions(ctx().handle.db, req.scope),
  );

  handle(CHANNELS.exporting.run, S.exportRunRequest, async (req) => {
    const db = ctx().handle.db;
    // Built before the dialog opens so an unwritable combination is refused
    // before the user has picked a filename.
    const result = await exportService.exportScope(db, req.scope, req.format);

    if (result.plan.empty) {
      throw new ServiceError(
        'INVALID_REQUEST',
        `There is nothing ${req.format.toUpperCase()} can carry in this selection.`,
      );
    }

    const chosen = await dialog.showSaveDialog({
      title: 'Export',
      defaultPath: `${result.plan.suggestedName}.${result.plan.extension}`,
      filters: [
        { name: req.format.toUpperCase(), extensions: [result.plan.extension] },
      ],
    });

    if (chosen.canceled || chosen.filePath === undefined) {
      return {
        cancelled: true,
        fileName: null,
        byteSize: null,
        losses: result.plan.losses,
      };
    }

    await assertNotInLinkedFolder(ctx().handle.db, chosen.filePath);
    const payload =
      result.bytes ?? Buffer.from(result.text ?? '', 'utf8');
    await writeFile(chosen.filePath, payload);

    return {
      cancelled: false,
      // Basename only: the renderer gets a label to display, not a location.
      fileName: basename(chosen.filePath),
      byteSize: payload.byteLength,
      losses: result.plan.losses,
    };
  });

  // ------------------------------------------------------------- geometry
  handle(CHANNELS.geometry.forTrip, S.geometryForTripRequest, (req) =>
    geometryService.forTrip(ctx().handle.db, req.tripId),
  );

  // -------------------------------------------------------------- routing
  /*
   * The only handlers in the application that can cause an outbound request.
   *
   * `providerService.requireProvider` is the gate: it resolves the endpoint,
   * re-validates the origin and refuses until consent has been given. Every
   * network-touching handler below calls it first, so the consent check cannot
   * be bypassed by reaching a service directly.
   */
  handleNoArgs(CHANNELS.routing.status, () =>
    providerService.status(ctx().handle.db),
  );

  handle(
    CHANNELS.routing.consentNotice,
    S.routingConsentNoticeRequest,
    (req) => providerService.consentNotice(req.endpoint),
  );

  /*
   * The only routing handler that does not call `requireProvider`.
   *
   * Deliberate, and narrow: it sends two hard-coded coordinates and nothing of
   * the user's, so there is no consent to obtain, and it exists precisely so an
   * endpoint can be verified *before* the user agrees to send it real routes.
   * See `providerService.testConnection`.
   */
  handle(CHANNELS.routing.test, S.routingTestRequest, async (req) => {
    const mode = req.mode ?? settingsService.all(ctx().handle.db).transportMode;
    return providerService.testConnection(req.endpoint, mode);
  });

  handle(CHANNELS.routing.snap, S.routingSnapRequest, async (req) => {
    const db = ctx().handle.db;
    const { provider, mode } = providerService.requireProvider(db);

    const mutation = await routingService.snapRoute(db, {
      routeId: req.routeId,
      provider,
      // An explicit mode in the request wins over the stored preference, so
      // the snap button can offer a one-off mode without writing a setting.
      mode: req.mode ?? mode,
      controlPoints: req.controlPoints,
    });

    /*
     * The road-attribute cache is dropped rather than left to go stale.
     *
     * A snap replaces the geometry, so the cached edges now describe a line
     * that no longer exists. `geometry_hash` would catch that on the next read
     * and report it stale, but a stale cache for geometry that was *just*
     * replaced is noise: the honest state is "not matched yet".
     */
    roadAttributeService.clear(db, 'route', req.routeId);

    return commit(mutation);
  });

  handle(CHANNELS.routing.routeLeg, S.routingRouteLegRequest, async (req) => {
    const { provider, mode } = providerService.requireProvider(
      ctx().handle.db,
    );
    return routingService.routeLeg(
      provider,
      req.from,
      req.to,
      req.mode ?? mode,
    );
  });

  // ------------------------------------------- Phase 6: alternatives, shaping

  handle(CHANNELS.routing.routeSection, S.routingRouteSectionRequest, async (req) => {
    const { provider, mode } = providerService.requireProvider(ctx().handle.db);
    return shapingService.routeSection(provider, req.locations, req.mode ?? mode);
  });

  handle(CHANNELS.routing.alternatives, S.routingAlternativesRequest, async (req) => {
    const { provider, mode } = providerService.requireProvider(ctx().handle.db);
    return shapingService.alternatives(provider, req.from, req.to, req.mode ?? mode, req.count);
  });

  handle(CHANNELS.routing.applyEdit, S.routingApplyEditRequest, (req) => {
    const db = ctx().handle.db;
    const mutation = shapingService.applyEdit(db, {
      routeId: req.routeId,
      expected: req.expected,
      edit: req.edit,
      legs: req.legs,
    });
    // As for a snap: the cached edges describe a line that no longer exists,
    // and "not matched yet" is the honest state, not "stale".
    roadAttributeService.clear(db, 'route', req.routeId);
    return commit(mutation);
  });

  handle(
    CHANNELS.routing.createSnapped,
    S.routingCreateSnappedRequest,
    (req) => {
      const db = ctx().handle.db;

      /*
       * Resolved rather than taken from the request, so the provenance names
       * the provider that is actually configured. A renderer-supplied provider
       * id would be an unverifiable claim written into the database.
       */
      const { mode } = providerService.requireProvider(db);
      const status = providerService.status(db);

      return commit(
        routingService.createSnappedRoute(db, {
          tripId: req.tripId,
          name: req.name,
          colour: req.colour,
          controlPoints: req.controlPoints,
          legs: req.legs,
          roles: req.roles,
          mode: req.mode ?? mode,
          provider: status.providerId ?? 'unknown',
        }),
      );
    },
  );

  /*
   * Building a routing graph. The only handler that spawns a child process.
   *
   * No zod schema: it takes no arguments at all. The extract path comes from a
   * native file dialog opened here, so the renderer never supplies or learns a
   * filesystem path — the same rule the import pipeline follows.
   */
  handleNoArgs(CHANNELS.routing.importRegion, async () => {
    const paths = currentEmbeddedPaths();

    const chosen = await dialog.showOpenDialog({
      title: 'Import a map region',
      message:
        'Choose an OpenStreetMap extract (.osm.pbf) for the area you want to route in.',
      properties: ['openFile'],
      filters: [{ name: 'OpenStreetMap extract', extensions: ['pbf'] }],
    });
    const picked = chosen.filePaths[0];
    if (chosen.canceled || picked === undefined) return null;

    const result = await importRegion({
      paths,
      extractPath: picked,
      onProgress: (progress) =>
        sendToRenderer(EVENTS.regionProgress, progress),
    });

    // Phase 10: place data from the same file, before anything else touches
    // it. A file the user picked names no regions, so it has no counties.
    sendToRenderer(EVENTS.regionProgress, { stage: 'Reading places', percent: null });
    const placesWarning = await buildPlacesOrWarn({
      paths,
      sources: [picked],
      extract: picked,
      regions: [],
      regionName: result.regionName,
    });
    // A file the user picked names no index regions, so none are recorded.
    const loaded = { ...result, regionIds: [], placesWarning };
    writeLoadedRegion(paths, loaded);
    return loaded;
  });

  handle(
    CHANNELS.routing.suggestRegions,
    S.routingSuggestRegionsRequest,
    (req) =>
      suggestRegions(currentEmbeddedPaths(), {
        minLat: req.minLat,
        minLon: req.minLon,
        maxLat: req.maxLat,
        maxLon: req.maxLon,
      }),
  );

  handle(
    CHANNELS.routing.downloadRegion,
    S.routingDownloadRegionRequest,
    async (req) => {
      const paths = currentEmbeddedPaths();
      const result = await downloadAndBuild(paths, req.regionIds, {
        terrain: terrainFor(paths),
        onProgress: (progress) =>
          sendToRenderer(EVENTS.regionJobProgress, progress),
      });
      writeLoadedRegion(paths, result);
      return result;
    },
  );

  handleNoArgs(CHANNELS.routing.regionMap, () =>
    regionMap(currentEmbeddedPaths()),
  );

  handle(CHANNELS.routing.regionSizes, S.routingRegionSizesRequest, (req) =>
    regionSizes(currentEmbeddedPaths(), req.regionIds),
  );

  handle(
    CHANNELS.routing.downloadTerrain,
    S.routingDownloadTerrainRequest,
    async (req) => {
      const names = profileService.terrainTilesFor(
        ctx().handle.db,
        req.ownerType,
        req.ownerId,
      );
      const outcome = await terrainFor(currentEmbeddedPaths()).download(names);
      return {
        downloaded: outcome.downloaded.length,
        sea: outcome.sea.length,
        failed: outcome.failed.length,
      };
    },
  );

  handleNoArgs(CHANNELS.routing.region, () =>
    readLoadedRegion(currentEmbeddedPaths()),
  );

  handle(CHANNELS.routing.provenance, S.routingProvenanceRequest, (req) =>
    routingService.provenance(ctx().handle.db, req.routeId),
  );

  handle(CHANNELS.routing.match, S.routingMatchRequest, async (req) => {
    const db = ctx().handle.db;
    const { provider, mode } = providerService.requireProvider(db);

    return roadAttributeService.match(db, {
      ownerType: req.ownerType,
      ownerId: req.ownerId,
      provider,
      mode: req.mode ?? mode,
      force: req.force,
    });
  });

  handle(CHANNELS.routing.attributes, S.routingAttributesRequest, (req) =>
    roadAttributeService.cached(ctx().handle.db, req.ownerType, req.ownerId),
  );

  handle(
    CHANNELS.routing.clearAttributes,
    S.routingClearAttributesRequest,
    (req) => {
      roadAttributeService.clear(ctx().handle.db, req.ownerType, req.ownerId);
      return true as const;
    },
  );

  handle(CHANNELS.routing.profile, S.routingProfileRequest, (req) =>
    profileService.profileFor(ctx().handle.db, {
      ownerType: req.ownerType,
      ownerId: req.ownerId,
      maxSamples: req.maxSamples,
      ukDefaults: settingsService.all(ctx().handle.db).ukDefaultSpeedLimits,
      terrain: terrainFor(currentEmbeddedPaths()),
    }),
  );

  handle(
    CHANNELS.routing.speedDistribution,
    S.routingSpeedDistributionRequest,
    (req) => {
      const db = ctx().handle.db;
      const units = settingsService.all(db).units;

      if (req.source === 'posted') {
        return roadAttributeService.postedDistribution(
          db,
          req.ownerType,
          req.ownerId,
          units,
          { ukDefaults: settingsService.all(db).ukDefaultSpeedLimits },
        );
      }

      // Recorded speed is a property of a recording. A route is a plan and has
      // none, which is refused rather than answered with an empty chart.
      if (req.ownerType !== 'track') {
        throw new ServiceError(
          'INVALID_REQUEST',
          'A route has no recorded speed. It is a plan, not a recording.',
        );
      }

      const distribution = roadAttributeService.recordedDistribution(
        db,
        req.ownerId,
        units,
      );
      return distribution === null ? null : { distribution, status: null };
    },
  );

  // ---------------------------------------------- Phase 11: linked folders
  handle(CHANNELS.linkedFolders.chooseFolder, S.linkedFolderChooseRequest, async (req) => {
    const db = ctx().handle.db;
    // The trip is checked before the chooser opens, not after the user has picked.
    tripService.get(db, req.tripId);
    const path = await chooseDirectory('Link Folder to Trip', 'Choose');
    if (path === null) return null;
    return linkedFolderService.chooseFolder(db, {
      tripId: req.tripId,
      path,
      appDataDir: ctx().paths.userData,
    });
  });

  handle(CHANNELS.linkedFolders.link, S.linkedFolderLinkRequest, (req) => {
    const folder = commit(linkedFolderService.link(ctx().handle.db, req));
    reconcileFolders();
    return summaryOf(folder);
  });

  handle(CHANNELS.linkedFolders.unlink, S.linkedFolderIdRequest, async (req) => {
    const result = commit(linkedFolderService.unlink(ctx().handle.db, req.folderId));
    reconcileFolders();
    // The files on disk are untouched; only TrailRT's own thumbnails go (§4.4).
    await thumbnails().removeFolder(req.folderId);
    return result;
  });

  handle(CHANNELS.linkedFolders.relink, S.linkedFolderIdRequest, async (req) => {
    const db = ctx().handle.db;
    const folder = linkedFolderService.get(db, req.folderId);
    const path = await chooseDirectory(`Relink ${folder.name}`, 'Relink');
    if (path === null) return null;
    const mutation = await linkedFolderService.relink(db, {
      folderId: req.folderId,
      path,
      appDataDir: ctx().paths.userData,
    });
    const relinked = commit(mutation);
    reconcileFolders();
    return summaryOf(relinked);
  });

  handle(CHANNELS.linkedFolders.setIncludeSubfolders, S.linkedFolderSetIncludeSubfoldersRequest, (req) => {
    const folder = commit(linkedFolderService.setIncludeSubfolders(ctx().handle.db, req.folderId, req.include));
    reconcileFolders();
    return summaryOf(folder);
  });

  handle(CHANNELS.linkedFolders.rescan, S.linkedFolderIdRequest, (req) => {
    linkedFolderService.get(ctx().handle.db, req.folderId);
    folderScanner()?.rescan(req.folderId);
    return true as const;
  });

  handle(CHANNELS.linkedFolders.cancelScan, S.linkedFolderIdRequest, (req) => {
    folderScanner()?.cancel(req.folderId);
    return true as const;
  });

  handle(CHANNELS.linkedFolders.get, S.linkedFolderIdRequest, (req) =>
    summaryOf(linkedFolderService.get(ctx().handle.db, req.folderId)),
  );

  handle(CHANNELS.linkedFolders.list, S.linkedFolderListRequest, (req) =>
    photoService.folderSummaries(ctx().handle.db, req.tripId, (id) => folderScanner()?.runtime(id) ?? null),
  );

  // ------------------------------------------------------ Phase 11: photos
  handle(CHANNELS.photos.list, S.photoListRequest, (req) =>
    photoService.listPhotos(ctx().handle.db, req.folderId),
  );

  handle(CHANNELS.photos.mapPoints, S.photoMapPointsRequest, (req) => {
    let scope: PhotoMapScope;
    if ('all' in req) {
      scope = { all: true, includeArchived: req.includeArchived };
      if (req.year !== undefined) scope.year = req.year;
      if (req.tripId !== undefined) scope.tripId = req.tripId;
    } else {
      scope = { tripId: req.tripId };
    }
    return photoService.mapPoints(ctx().handle.db, scope);
  });

  handle(CHANNELS.photos.years, S.photoYearsRequest, (req) =>
    photoService.years(ctx().handle.db, req.includeArchived),
  );

  handle(CHANNELS.photos.get, S.photoIdRequest, (req) =>
    photoService.details(ctx().handle.db, req.photoId),
  );

  handle(CHANNELS.photos.thumbnail, S.photoIdRequest, (req) =>
    thumbnails().get(ctx().handle.db, req.photoId, resolvePhoto),
  );

  // "Open" and "Show in Finder" act only on a path the main process resolved
  // from the photo's id (Requirement 8.4).
  handle(CHANNELS.photos.open, S.photoIdRequest, async (req) => {
    const { path } = await resolvePhoto(req.photoId);
    const failure = await shell.openPath(path);
    if (failure !== '') throw new ServiceError('IO_ERROR', 'That photo could not be opened.', failure);
    return true as const;
  });

  handle(CHANNELS.photos.reveal, S.photoIdRequest, async (req) => {
    const { path } = await resolvePhoto(req.photoId);
    shell.showItemInFolder(path);
    return true as const;
  });

  // ----------------------------------------------------------------- undo
  handleNoArgs(CHANNELS.undo.state, () => undoService.state());

  handleNoArgs(CHANNELS.undo.undo, () => {
    const next = undoService.undo(ctx().handle.db);
    // An undo may have linked, unlinked or relinked a folder (Phase 11 §4.4).
    afterFolderRowsChanged();
    ctx().notifyLibraryChanged();
    publishUndoState(next);
    return next;
  });

  handleNoArgs(CHANNELS.undo.redo, () => {
    const next = undoService.redo(ctx().handle.db);
    afterFolderRowsChanged();
    ctx().notifyLibraryChanged();
    publishUndoState(next);
    return next;
  });

  handleNoArgs(CHANNELS.undo.clear, () => {
    const next = undoService.clear();
    publishUndoState(next);
    return next;
  });

  // ----------------------------------------------------------------- app
  handleNoArgs(CHANNELS.app.info, (): AppInfo => ({
    name: 'TrailRT',
    version: app.getVersion(),
    licence: 'GPL-3.0-or-later',
    repositoryUrl: REPOSITORY_URL,
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
  }));

  handleNoArgs(CHANNELS.app.licences, (): LicenceEntry[] => [
    ...THIRD_PARTY_LICENCES,
    ...RUNTIME_NOTICES,
  ]);

  handle(CHANNELS.app.openExternal, S.openExternalRequest, async (req) => {
    await openExternal(req.url);
    return true as const;
  });

  handle(CHANNELS.app.savePng, S.savePngRequest, async (req) => {
    /*
     * Validated as base64 before it is decoded.
     *
     * `Buffer.from(x, 'base64')` silently skips anything outside the alphabet,
     * so a malformed payload would be written as a short, corrupt file rather
     * than refused. Checking first means the failure is a message instead of a
     * broken image on disk.
     */
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(req.base64)) {
      throw new ServiceError(
        'INVALID_REQUEST',
        'That image data was not valid, so nothing was written.',
      );
    }

    const bytes = Buffer.from(req.base64, 'base64');

    const chosen = await dialog.showSaveDialog({
      title: 'Save image',
      defaultPath: `${req.suggestedName}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });

    if (chosen.canceled || chosen.filePath === undefined) {
      return { cancelled: true as const, fileName: null };
    }

    await assertNotInLinkedFolder(ctx().handle.db, chosen.filePath);
    await writeFile(chosen.filePath, bytes);
    // Basename only: a label to display, not a location.
    return { cancelled: false as const, fileName: basename(chosen.filePath) };
  });
}
