import type { RoutePoint } from '@shared/domain/types';
import type { ExportScopeRequest } from '@shared/ipc/schemas';
import {
  deletePoint,
  insertPointAt,
  movePoint,
} from '@shared/geo/routeEdit';
import { wazeNavigateUrl } from '@shared/integrations/waze';
import type { LatLon } from '@shared/geo/distance';
import { EditRefused, planEdit, type RouteEdit } from '@shared/routing/edit';
import { pinCandidate } from '@shared/routing/pin';
import { flattenLegsWithBoundaries } from '@shared/routing/splice';
import type { SectionLocation } from '@shared/routing/RoutingProvider';
import {
  asPreviewedLeg,
  type Candidate,
  type EditOutcome,
  type PreviewedLeg,
  type SnapOutcome,
} from '@shared/routing/results';
import {
  shapingStateFrom,
  type ShapingState,
} from '../features/map/shapingState';
import { AppError, api, call, callOr, describeError } from './client';
import { useEditorStore } from '../stores/editorStore';
import { useGeometryStore } from '../stores/geometryStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useRoutingStore } from '../stores/routingStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useShapingStore } from '../stores/shapingStore';
import {
  draftLegShapes,
  snapComplete,
  useSnapRoutingStore,
} from '../stores/snapRoutingStore';
import { useUiStore } from '../stores/uiStore';

/**
 * Editing operations, in one place.
 *
 * The map, the library tree, the properties panel and the native menus all
 * reach the same functions, so there is a single definition of what "delete a
 * route" means and a single place that refreshes the stores afterwards.
 *
 * Geometry edits compute the new point array with the pure helpers in
 * `shared/geo/routeEdit` and send the whole array. One command covers every
 * gesture, and its inverse is the previous array — see the Phase 2 design.
 */

function toast(message: string, tone: 'info' | 'error' = 'info'): void {
  useUiStore.getState().showToast(message, tone);
}

/** Refreshes everything a mutation could have changed. */
async function refreshAll(): Promise<void> {
  await Promise.all([
    useGeometryStore.getState().reload(),
    useLibraryStore.getState().refresh(),
    useSelectionStore.getState().reload(),
  ]);
}

async function run(
  operation: () => Promise<unknown>,
  failureNote?: string,
): Promise<boolean> {
  try {
    await operation();
    await refreshAll();
    return true;
  } catch (cause) {
    toast(failureNote ?? describeError(cause), 'error');
    // Reload anyway: the local cache may be mid-edit and must not be left
    // showing something the database rejected.
    await refreshAll();
    return false;
  }
}

// ------------------------------------------------------------------ routes

export async function createRouteFromPoints(
  tripId: string,
  points: readonly RoutePoint[],
  name = 'New Route',
): Promise<void> {
  if (points.length === 0) {
    toast('Nothing to save — place at least one point.', 'error');
    return;
  }
  try {
    const route = await call(
      api().routes.create({ tripId, name, points: [...points] }),
    );
    await refreshAll();
    await useSelectionStore.getState().select({ kind: 'route', id: route.id });
    toast(`Route saved with ${points.length} points.`);
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

/** Replaces geometry. All gestures funnel through here. */
async function setGeometry(
  routeId: string,
  points: readonly RoutePoint[],
): Promise<void> {
  await run(() =>
    call(api().routes.setGeometry({ id: routeId, points: [...points] })),
  );
}

function pointsOf(routeId: string): RoutePoint[] | null {
  return useGeometryStore.getState().findRoute(routeId)?.points ?? null;
}

export async function moveRouteVertex(
  routeId: string,
  index: number,
  lat: number,
  lon: number,
): Promise<void> {
  const points = pointsOf(routeId);
  if (points === null) return;
  await setGeometry(routeId, movePoint(points, index, lat, lon));
}

export async function deleteRouteVertex(
  routeId: string,
  index: number,
): Promise<void> {
  const points = pointsOf(routeId);
  if (points === null) return;
  if (points.length <= 1) {
    // Deleting the last point would leave a route with no geometry at all.
    // Deleting the route is a different, confirmable action.
    toast('A route needs at least one point. Delete the route instead.', 'error');
    return;
  }
  await setGeometry(routeId, deletePoint(points, index));
}

export async function insertRouteVertex(
  routeId: string,
  index: number,
  lat: number,
  lon: number,
): Promise<void> {
  const points = pointsOf(routeId);
  if (points === null) return;
  await setGeometry(
    routeId,
    insertPointAt(points, index, {
      lat,
      lon,
      ele: null,
      name: null,
      symbol: null,
      notes: null,
    }),
  );
}

export async function reverseRoute(routeId: string): Promise<void> {
  await run(() => call(api().routes.reverse({ id: routeId })));
}

export async function duplicateRoute(routeId: string): Promise<void> {
  try {
    const copy = await call(api().routes.duplicate({ id: routeId }));
    await refreshAll();
    await useSelectionStore.getState().select({ kind: 'route', id: copy.id });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function renameRoute(routeId: string, name: string): Promise<void> {
  await run(() => call(api().routes.update({ id: routeId, name })));
}

export async function setRouteColour(
  routeId: string,
  colour: string,
): Promise<void> {
  await run(() => call(api().routes.update({ id: routeId, colour })));
}

export async function deleteRoute(routeId: string): Promise<void> {
  const ok = await run(() => call(api().routes.delete({ id: routeId })));
  if (ok) {
    useSelectionStore.getState().clear();
    toast('Route deleted. Undo with ⌘Z.');
  }
}

// --------------------------------------------------------------- waypoints

export async function createWaypoint(
  tripId: string,
  lat: number,
  lon: number,
  name = 'New Waypoint',
): Promise<void> {
  try {
    const waypoint = await call(
      api().waypoints.create({ tripId, name, lat, lon }),
    );
    await refreshAll();
    await useSelectionStore
      .getState()
      .select({ kind: 'waypoint', id: waypoint.id });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function moveWaypoint(
  id: string,
  lat: number,
  lon: number,
): Promise<void> {
  await run(() => call(api().waypoints.move({ id, lat, lon })));
}

export async function updateWaypoint(
  id: string,
  patch: {
    name?: string;
    lat?: number;
    lon?: number;
    eleM?: number | null;
    description?: string | null;
    symbol?: string;
    notes?: string | null;
  },
): Promise<void> {
  await run(() => call(api().waypoints.update({ id, ...patch })));
}

export async function duplicateWaypoint(id: string): Promise<void> {
  try {
    const copy = await call(api().waypoints.duplicate({ id }));
    await refreshAll();
    await useSelectionStore.getState().select({ kind: 'waypoint', id: copy.id });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function deleteWaypoint(id: string): Promise<void> {
  const ok = await run(() => call(api().waypoints.delete({ id })));
  if (ok) {
    useSelectionStore.getState().clear();
    toast('Waypoint deleted. Undo with ⌘Z.');
  }
}

// -------------------------------------------------------------------- undo

export async function undo(): Promise<void> {
  // Inside the snap routing tool nothing is in the database yet, so ⌘Z means
  // "undo my last edit to this draft" (Requirement 8.7).
  if (useEditorStore.getState().mode === 'snapRoute') {
    undoSnapDraft();
    return;
  }
  try {
    await call(api().undo.undo());
    await refreshAll();
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function redo(): Promise<void> {
  try {
    await call(api().undo.redo());
    await refreshAll();
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

// ------------------------------------------------------------------- modes

/**
 * "New Route": starts a route in the trip that owns the current selection.
 *
 * Following roads is the default (ADR 0018). When the engine can route, this is
 * the road-following tool; when it cannot, the route is drawn as straight lines
 * and the hint bar says why, with a way to add map regions. It is never
 * silently straight.
 *
 * Requires a trip context: a route must belong to exactly one trip (ADR 0004),
 * so there is no sensible "draw with nothing selected".
 */
export async function startDrawingRoute(): Promise<void> {
  const tripId = currentTripId();
  if (tripId === null) {
    toast('Select a trip first — a route has to belong to one.', 'error');
    return;
  }

  const status = await useRoutingStore.getState().loadStatus();
  if (status !== null && status.available) {
    await startSnapRouting();
    return;
  }
  useEditorStore.getState().startDrawRoute(tripId, 'unavailable');
}

/**
 * "New Straight-Line Route": a route that deliberately does not follow roads.
 *
 * For paths no road graph knows — off-road, ferries, private land. A menu
 * command rather than a toggle, so the default never has to be switched back.
 */
export function startStraightLineRoute(): void {
  const tripId = currentTripId();
  if (tripId === null) {
    toast('Select a trip first — a route has to belong to one.', 'error');
    return;
  }
  useEditorStore.getState().startDrawRoute(tripId, 'chosen');
}

/**
 * Starts a New Route with its first point at a place, as a search result's
 * "Start a New Route here" does. Phase 10 Requirement 11.2. The route tool
 * then carries on as if the user had clicked there.
 */
export async function startRouteAt(point: { lat: number; lon: number }): Promise<void> {
  await startDrawingRoute();
  const editor = useEditorStore.getState();
  if (editor.mode === 'snapRoute') {
    useSnapRoutingStore.getState().appendPoint({ lat: point.lat, lon: point.lon });
  } else if (editor.mode === 'drawRoute') {
    editor.appendPending({ lat: point.lat, lon: point.lon, ele: null, name: null, symbol: null, notes: null });
  }
}

export function startPlacingWaypoint(): void {
  const tripId = currentTripId();
  if (tripId === null) {
    toast('Select a trip first — a waypoint has to belong to one.', 'error');
    return;
  }
  useEditorStore.getState().startPlaceWaypoint(tripId);
}

/** The trip implied by the current selection, whatever kind it is. */
export function currentTripId(): string | null {
  const selection = useSelectionStore.getState();
  if (selection.trip !== null) return selection.trip.id;
  if (selection.route !== null) return selection.route.tripId;
  if (selection.track !== null) return selection.track.tripId;
  if (selection.waypoint !== null) return selection.waypoint.tripId;
  return useGeometryStore.getState().tripId;
}

// ------------------------------------------------------------------ tracks

/**
 * Track editing.
 *
 * Deliberately range-based rather than per-vertex. A recorded track has
 * hundreds of thousands of samples, so "drag this point" is neither a gesture
 * a user wants nor one the undo stack can afford — see ADR 0003. What a user
 * actually does to a recording is trim it, split it, join it, or simplify it,
 * and those are the operations here.
 */

export async function renameTrack(id: string, name: string): Promise<void> {
  await run(() => call(api().tracks.update({ id, name })));
}

export async function setTrackColour(id: string, colour: string): Promise<void> {
  await run(() => call(api().tracks.update({ id, colour })));
}

export async function setTrackWidth(id: string, width: number): Promise<void> {
  await run(() => call(api().tracks.update({ id, width })));
}

export async function reverseTrack(id: string): Promise<void> {
  await run(() => call(api().tracks.reverse({ id })));
}

/** The resulting point count, so the user agrees to a known cost. */
export async function previewTrackSimplify(
  id: string,
  toleranceM: number,
): Promise<{ before: number; after: number } | null> {
  try {
    return await call(api().tracks.previewSimplify({ id, toleranceM }));
  } catch (cause) {
    toast(describeError(cause), 'error');
    return null;
  }
}

export async function simplifyTrack(
  id: string,
  toleranceM: number,
): Promise<void> {
  const ok = await run(() => call(api().tracks.simplify({ id, toleranceM })));
  if (ok) {
    // Honest about the limit: the inverse of a 200,000-point edit is not on the
    // undo stack, and the retained original is the way back.
    toast('Track simplified. Restore the original from its properties if needed.');
  }
}

export async function splitTrack(
  id: string,
  pointIndex: number,
): Promise<void> {
  await run(() => call(api().tracks.split({ id, pointIndex })));
}

export async function joinTracks(
  firstId: string,
  secondId: string,
): Promise<void> {
  await run(() => call(api().tracks.join({ firstId, secondId })));
}

export async function deleteTrackPointRange(
  id: string,
  from: number,
  to: number,
): Promise<void> {
  await run(() => call(api().tracks.deleteRange({ id, from, to })));
}

export async function restoreTrackOriginal(id: string): Promise<void> {
  const ok = await run(() => call(api().tracks.restoreOriginal({ id })));
  if (ok) toast('Track geometry restored from the imported file.');
}

export async function deleteTrack(id: string): Promise<void> {
  const ok = await run(() => call(api().tracks.delete({ id })));
  if (ok) {
    useSelectionStore.getState().clear();
    // Stated plainly rather than implying an undo that does not exist.
    toast('Track deleted. This one cannot be undone.');
  }
}

// ------------------------------------------------------- import and export

export async function chooseFilesToImport(): Promise<void> {
  const ui = useUiStore.getState();
  try {
    const staged = await call(api().importing.choose());
    if (staged.length === 0) return;
    ui.openDialog({ kind: 'import', staged });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

/** Drag-and-drop. The bridge resolves the paths; the renderer never sees them. */
export async function importDroppedFiles(files: readonly File[]): Promise<void> {
  const ui = useUiStore.getState();
  try {
    const staged = await call(api().importing.addDroppedFiles(files));
    if (staged.length === 0) return;
    ui.openDialog({ kind: 'import', staged });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export function openExportDialog(scope: ExportScopeRequest): void {
  useUiStore.getState().openDialog({ kind: 'export', scope });
}

/** The export scope implied by the current selection. */
export function currentExportScope(): ExportScopeRequest | null {
  const selection = useSelectionStore.getState();
  if (selection.route !== null) return { kind: 'route', id: selection.route.id };
  if (selection.track !== null) return { kind: 'track', id: selection.track.id };
  if (selection.waypoint !== null) {
    return { kind: 'waypoint', id: selection.waypoint.id };
  }
  const tripId = currentTripId();
  return tripId === null ? null : { kind: 'trips', tripIds: [tripId] };
}

// ------------------------------------------- routing, road attributes, Waze

/**
 * Snapping, matching and the Waze hand-off.
 *
 * Every function here is started by a user gesture. Nothing in this section is
 * called from a render path or an effect that runs on selection, because all of
 * it can cause an outbound network request and the consent the user gave was
 * for actions they take, not for the app to poll on their behalf.
 */

/** Resolves the editor into measuring mode. Creates nothing, ever. */
export function startMeasuring(): void {
  useEditorStore.getState().startMeasure();
  toast('Measuring. Click to add points — nothing is saved.');
}

/**
 * Turns a provider failure into a message the user can act on.
 *
 * The three unavailable states need three different responses, and the IPC
 * error codes keep them distinguishable: open settings, fix the endpoint, or
 * accept the consent prompt.
 */
function routingFailure(cause: unknown): void {
  const message = describeError(cause);
  if (cause instanceof AppError && cause.code === 'CONSENT_REQUIRED') {
    toast(message, 'error');
    useUiStore.getState().openDialog({ kind: 'settings' });
    return;
  }
  if (cause instanceof AppError && cause.code === 'PROVIDER_UNAVAILABLE') {
    toast(
      'No routing service is configured. Add one in Settings to snap routes to roads.',
      'error',
    );
    return;
  }
  toast(message, 'error');
}

/**
 * Snaps a route to the road network.
 *
 * Returns the outcome so the caller can describe it. An unmatched leg is not a
 * failure: the route is still snapped everywhere a road was found, and the
 * straight sections are reported.
 */
export async function snapRoute(
  routeId: string,
  controlPoints?: readonly { lat: number; lon: number }[],
): Promise<SnapOutcome | null> {
  const routing = useRoutingStore.getState();
  routing.setBusy('route', routeId, true);

  try {
    const outcome = await call(
      api().routing.snap({
        routeId,
        ...(controlPoints === undefined
          ? {}
          : { controlPoints: [...controlPoints] }),
      }),
    );
    routing.invalidate('route', routeId);
    await refreshAll();

    /*
     * A displaced control point is reported before anything else.
     *
     * It is the more serious finding. An unmatched leg means "there is no road
     * between these two points", which is a fact about the route. A displaced
     * control point means the engine had no road *anywhere near* one of them
     * and quietly routed to somewhere else instead — which almost always means
     * the loaded map region does not reach it, and makes the result wrong
     * rather than incomplete. See ADR 0016.
     */
    if (outcome.displaced.length > 0) {
      const worst = outcome.displaced.reduce((a, b) =>
        b.displacementM > a.displacementM ? b : a,
      );
      const km = (worst.displacementM / 1000).toFixed(1);
      toast(
        `${outcome.displaced.length} point${outcome.displaced.length === 1 ? '' : 's'} ` +
          `had no road nearby — one was ${km} km from the nearest road in the loaded map region. ` +
          `Those sections were left as straight lines. Add the map regions covering your route in Settings.`,
        'error',
      );
      return outcome;
    }

    const unmatched = outcome.unmatchedLegs.length;
    if (unmatched > 0) {
      toast(
        `Snapped to ${outcome.pointCount.toLocaleString()} points. ${unmatched} section${
          unmatched === 1 ? '' : 's'
        } had no road route and stayed straight.`,
      );
    } else if (outcome.undoable) {
      toast(
        `Snapped to roads — ${outcome.pointCount.toLocaleString()} points. Undo with ⌘Z.`,
      );
    } else {
      // Said plainly rather than implying an undo that is not on the stack.
      toast(
        `Snapped to roads — ${outcome.pointCount.toLocaleString()} points. This one cannot be undone; the previous shape was too large to keep.`,
      );
    }
    return outcome;
  } catch (cause) {
    routingFailure(cause);
    return null;
  } finally {
    useRoutingStore.getState().setBusy('route', routeId, false);
  }
}

// ------------------------------------------- Phase 6: shaping a saved route

/** What shaping needs to know about a saved snapped route, or null. */
export function shapingStateOf(routeId: string): ShapingState | null {
  const provenance = useRoutingStore.getState().provenance[routeId];
  const points = pointsOf(routeId);
  if (provenance === undefined || points === null) return null;
  return shapingStateFrom(points, provenance.controlPoints);
}

/** Routes a section for a shaping preview. No write. */
export function routeSection(section: SectionLocation[]): Promise<PreviewedLeg[]> {
  return call(api().routing.routeSection({ locations: section }));
}

/**
 * Commits a shaping edit to a saved snapped route: one undo entry.
 *
 * `previewLegs` are the legs the user watched appear while dragging; they are
 * what gets stored. When there are none but the edit needs routing — an
 * Alt-click removal, say — the section is routed here first.
 *
 * A route snapped before Phase 6 has no leg boundaries, so its first edit
 * re-routes the whole route once to establish them, and says so
 * (Requirement 8.8). The control points do not move in that re-route, so a
 * preview computed against them is still valid afterwards; only a click on
 * the old line has to become a drag-style insert, since the line itself has
 * changed.
 */
export async function applyShapingEdit(
  routeId: string,
  edit: RouteEdit,
  previewLegs: PreviewedLeg[] | null,
): Promise<void> {
  const routing = useRoutingStore.getState();
  if (routing.isBusy('route', routeId)) return;
  routing.setBusy('route', routeId, true);

  try {
    await routing.loadProvenance(routeId);
    let state = shapingStateOf(routeId);
    if (state === null) {
      toast('Only a route that follows the roads can be shaped. Snap it to roads first.', 'error');
      return;
    }

    let nextEdit = edit;
    let legs = previewLegs;
    if (!state.boundariesKnown) {
      toast('Re-routing the whole route once to enable section editing…');
      await call(api().routing.snap({ routeId }));
      await refreshAll();
      await useRoutingStore.getState().loadProvenance(routeId);
      state = shapingStateOf(routeId);
      if (state === null) return;
      if (nextEdit.kind === 'insertOnLine') {
        nextEdit = { kind: 'insert', leg: nextEdit.leg, at: nextEdit.at };
        legs = null;
      }
    }

    const plan = planEdit(state.control, state.legs, nextEdit);
    if (plan.section !== null && legs === null) legs = await routeSection(plan.section);

    const outcome = await call(
      api().routing.applyEdit({
        routeId,
        expected: state.expected,
        edit: toWireEdit(nextEdit),
        legs: plan.section === null || legs === null ? null : legs.map(asPreviewedLeg),
      }),
    );
    useRoutingStore.getState().invalidate('route', routeId);
    await refreshAll();
    await useRoutingStore.getState().loadProvenance(routeId);
    describeEdit(outcome);
  } catch (cause) {
    if (cause instanceof EditRefused) toast(cause.message, 'error');
    else routingFailure(cause);
    await refreshAll();
  } finally {
    useRoutingStore.getState().setBusy('route', routeId, false);
  }
}

/** Routes a section and joins its legs, for verifying a pinned alternative. */
async function routeJoined(section: SectionLocation[]): Promise<LatLon[]> {
  return flattenLegsWithBoundaries(await routeSection(section)).points;
}

/**
 * Asks the engine for the routes on offer for one leg of a saved route and
 * shows them (Requirement 2). Writes nothing.
 */
export async function showLegAlternatives(routeId: string, leg: number): Promise<void> {
  const state = shapingStateOf(routeId);
  const from = state?.control[leg]?.point;
  const to = state?.control[leg + 1]?.point;
  if (state === null || from === undefined || to === undefined) return;

  try {
    const items = await call(api().routing.alternatives({ from, to, count: 3 }));
    if (items.length === 0) {
      toast('No road route was found for this section.', 'error');
      return;
    }
    useShapingStore.getState().show({
      routeId,
      leg,
      items,
      current: state.legs[leg] ?? [],
    });
  } catch (cause) {
    routingFailure(cause);
  }
}

export function dismissLegAlternatives(): void {
  useShapingStore.getState().clear();
}

/**
 * Uses the selected candidate for that leg: one undo entry.
 *
 * Any candidate but the engine's own first choice is pinned with shaping
 * points first, so a later re-route of the leg keeps the chosen roads
 * (Requirement 3). When the pins cannot be confirmed, the chosen geometry is
 * still used and the user is told what that means.
 */
export async function chooseLegCandidate(): Promise<void> {
  const store = useShapingStore.getState();
  const choice = store.legCandidates;
  if (choice === null || choice.checking) return;
  const candidate = choice.items[choice.selected];
  const preferred = choice.items[0];
  if (candidate === undefined || preferred === undefined) return;

  store.setChecking(true);
  try {
    const pinned =
      choice.selected === 0
        ? { shaping: [], verified: true }
        : await pinCandidate(candidate.shape, preferred.shape, routeJoined);
    await applyShapingEdit(
      choice.routeId,
      { kind: 'choose', leg: choice.leg, candidate: candidate.shape, shaping: pinned.shaping },
      null,
    );
    if (!pinned.verified) {
      toast(
        'Route updated. TrailRT could not confirm that re-routing this section later will keep these roads — check it if you move a neighbouring point.',
      );
    }
  } catch (cause) {
    routingFailure(cause);
  } finally {
    useShapingStore.getState().clear();
  }
}

// ------------------------------------------- Phase 6: extending a saved route

/** One extend click at a time, in order: each is a write and an undo entry. */
let extendQueue: Promise<void> = Promise.resolve();
function inExtendOrder(task: () => Promise<void>): Promise<void> {
  extendQueue = extendQueue.then(task).catch((cause: unknown) => {
    toast(describeError(cause), 'error');
  });
  return extendQueue;
}

/** Leaves the leg choice in place if one is showing: the next action decides it. */
async function settleLegChoice(routeId: string): Promise<void> {
  const choice = useShapingStore.getState().legCandidates;
  if (choice === null || choice.routeId !== routeId) return;
  if (choice.selected > 0) await chooseLegCandidate();
  else dismissLegAlternatives();
}

export function startExtendingRoute(routeId: string): void {
  useEditorStore.getState().startExtendRoute(routeId);
  toast('Extending the route. Click to add points along the roads · Enter or Esc to stop.');
}

/**
 * Appends a via point to the route being extended and routes the new leg
 * (Requirement 6.5). One undo entry per click.
 *
 * Asks for the routes on offer first and uses the engine's preferred one as
 * the new leg, so a click costs one routing request rather than two; the
 * others are then shown, and choosing one is a further undo entry. A
 * candidate already selected for the previous leg is used before moving on,
 * as in the snap routing tool.
 */
export function extendRouteTo(point: LatLon): Promise<void> {
  return inExtendOrder(async () => {
    const routeId = useEditorStore.getState().targetRouteId;
    if (routeId === null) return;
    await settleLegChoice(routeId);

    const state = shapingStateOf(routeId);
    const from = state?.control.at(-1)?.point;
    if (state === null || from === undefined) return;

    const offer =
      useSettingsStore.getState().settings.routeAlternatives &&
      useRoutingStore.getState().status?.capabilities.alternatives === true;

    let items: Candidate[] = [];
    let legs: PreviewedLeg[] | null = null;
    if (offer) {
      try {
        items = await call(api().routing.alternatives({ from, to: point, count: 3 }));
      } catch (cause) {
        routingFailure(cause);
        return;
      }
      legs = [
        items[0] ?? { matched: false, shape: [from, point], distanceM: null, displacementM: null },
      ];
    }

    await applyShapingEdit(routeId, { kind: 'append', at: point }, legs);

    const after = shapingStateOf(routeId);
    if (items.length > 0 && after !== null && after.control.length === state.control.length + 1) {
      useShapingStore.getState().show({
        routeId,
        leg: after.control.length - 2,
        items,
        current: after.legs.at(-1) ?? [],
      });
    }
  });
}

export function stopExtendingRoute(): Promise<void> {
  return inExtendOrder(async () => {
    const routeId = useEditorStore.getState().targetRouteId;
    if (routeId !== null) await settleLegChoice(routeId);
    useEditorStore.getState().cancel();
  });
}

/** `RouteEdit` with its read-only arrays copied, as the IPC schema expects. */
function toWireEdit(edit: RouteEdit) {
  return edit.kind === 'choose'
    ? { ...edit, candidate: [...edit.candidate], shaping: [...edit.shaping] }
    : edit;
}

/**
 * Speaks up only when an edit did something the user should know about. A
 * toast for every successful drag would be noise; the route on the map is the
 * confirmation.
 */
function describeEdit(outcome: EditOutcome): void {
  if (outcome.displaced.length > 0) {
    const worst = outcome.displaced.reduce((a, b) => (b.displacementM > a.displacementM ? b : a));
    toast(
      `A point had no road nearby — it was ${(worst.displacementM / 1000).toFixed(1)} km from the nearest road in the loaded map region. That section was left as a straight line.`,
      'error',
    );
    return;
  }
  if (!outcome.undoable) {
    toast('Route updated. This edit cannot be undone; the section it replaced was too large to keep.');
  }
}

/**
 * Creates a straight-line route from drawn points.
 *
 * Road-following routes come from the snap routing tool, which is what "New
 * Route" opens whenever the engine can route (ADR 0018). This path is only
 * reached for a deliberate straight-line route, or as the fallback when routing
 * is unavailable — so it never snaps.
 */
export async function createRouteFromDrawnPoints(
  tripId: string,
  points: readonly RoutePoint[],
): Promise<void> {
  if (points.length === 0) {
    toast('Nothing to save — place at least one point.', 'error');
    return;
  }

  try {
    const route = await call(
      api().routes.create({ tripId, name: 'New Route', points: [...points] }),
    );
    await refreshAll();
    await useSelectionStore.getState().select({ kind: 'route', id: route.id });

    toast(`Route saved with ${points.length} points.`);
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

/** Map-matches a geometry to read road attributes. Never moves the geometry. */
export async function matchRoads(
  ownerType: 'route' | 'track',
  ownerId: string,
  /**
   * `quiet` is for the automatic lookup on selection: no toast either way.
   * A message on every click would be noise, and the panel shows the outcome
   * inline, including a failure with a retry.
   */
  options: { force?: boolean; quiet?: boolean } = {},
): Promise<boolean> {
  const routing = useRoutingStore.getState();
  routing.setBusy(ownerType, ownerId, true);

  try {
    const status = await call(
      api().routing.match(
        options.force === true
          ? { ownerType, ownerId, force: true }
          : { ownerType, ownerId },
      ),
    );

    /*
     * Provenance is kept through the invalidation. A match never changes it,
     * and only a change of selection would otherwise reload it. Dropping it
     * left the route with no control points: the map lost its unmatched legs,
     * dragging the line could not add a shaping point, and the panel forgot
     * the route was straight. With the lookup now automatic on selection, that
     * happened every time a route was clicked.
     */
    const kept =
      ownerType === 'route'
        ? useRoutingStore.getState().provenance[ownerId]
        : undefined;
    routing.invalidate(ownerType, ownerId);
    if (kept !== undefined) {
      useRoutingStore.setState((state) => ({
        provenance: { ...state.provenance, [ownerId]: kept },
      }));
    }
    await Promise.all([
      ...(ownerType === 'route'
        ? [useRoutingStore.getState().loadProvenance(ownerId)]
        : []),
      useRoutingStore.getState().loadAttributes(ownerType, ownerId),
      useRoutingStore.getState().loadProfile(ownerType, ownerId),
      useRoutingStore
        .getState()
        .loadDistribution(ownerType, ownerId, 'posted'),
    ]);

    if (options.quiet === true) {
      // Reported inline by the panel instead.
    } else if (status.unmatchedPointCount > 0) {
      toast(
        `Matched ${status.edgeCount} road segments. ${status.unmatchedPointCount.toLocaleString()} points matched no road and are counted as unknown.`,
      );
    } else {
      toast(`Matched ${status.edgeCount} road segments.`);
    }
    return true;
  } catch (cause) {
    if (options.quiet !== true) routingFailure(cause);
    return false;
  } finally {
    useRoutingStore.getState().setBusy(ownerType, ownerId, false);
  }
}

export async function clearRoadAttributes(
  ownerType: 'route' | 'track',
  ownerId: string,
): Promise<void> {
  await callOr(api().routing.clearAttributes({ ownerType, ownerId }), true);
  useRoutingStore.getState().invalidate(ownerType, ownerId);
  toast('Road data cleared for this geometry.');
}

/**
 * Hands a single point to Waze.
 *
 * One destination only, because that is all the Waze deep link accepts. For a
 * route or track the caller offers the start and the end as separate items, each
 * labelled, so the user is not left thinking the whole route went across.
 */
export async function openInWaze(point: {
  lat: number;
  lon: number;
}): Promise<void> {
  try {
    await call(api().app.openExternal({ url: wazeNavigateUrl(point) }));
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

/** Opens the profile drawer for a geometry. A local read; no provider call. */
export function openProfile(
  ownerType: 'route' | 'track',
  ownerId: string,
): void {
  useUiStore.getState().openProfile(ownerType, ownerId);
}

/**
 * Opens the point table for a geometry.
 *
 * Opened on request rather than with the selection: for a track it starts
 * paging exact points, and doing that every time something is clicked would
 * make selection feel slow for a drawer most users have closed — the same
 * reasoning the profile drawer follows.
 */
export function openPointTable(
  ownerType: 'route' | 'track',
  ownerId: string,
): void {
  useUiStore.getState().openPointTable(ownerType, ownerId);
}

// ------------------------------------------- the interactive snap routing tool

/**
 * Starts the snap routing tool.
 *
 * Refuses up front when no provider is available, rather than letting the user
 * place points into a tool that cannot route them. The status is re-read first
 * because it is a local database call, so the check costs nothing and cannot be
 * wrong about a consent the user just gave.
 */
export async function startSnapRouting(): Promise<void> {
  const tripId = currentTripId();
  if (tripId === null) {
    toast('Select a trip first — a route has to belong to one.', 'error');
    return;
  }

  const status = await useRoutingStore.getState().loadStatus();
  if (status === null || !status.available) {
    toast(
      status?.message ??
        'Snap routing needs a routing service. Add one in Settings.',
      'error',
    );
    if (status?.reason === 'consent-required') {
      useUiStore.getState().openDialog({ kind: 'settings' });
    }
    return;
  }

  useSnapRoutingStore.getState().reset();
  useEditorStore.getState().startSnapRoute(tripId);
  toast('Snap routing. Each click extends the route along the roads.');
}

export function cancelSnapRouting(): void {
  useSnapRoutingStore.getState().reset();
  useEditorStore.getState().cancel();
}

/**
 * Routes every gap that still needs a leg, strictly in order.
 *
 * One request at a time, guarded by `draining`. Firing a request per click in
 * parallel would be faster and wrong: replies can arrive out of order, and
 * `legs` has to stay index-aligned with the gaps between control points or the
 * saved route joins the wrong pairs. The ordering is enforced here rather than
 * by sorting replies, because a sort cannot tell a late reply from a reply to a
 * line that has since changed.
 *
 * Module-level rather than in the store: it is machinery for keeping the store
 * consistent, not state the UI reads.
 */
let draining = false;

async function drainSnapLegs(): Promise<void> {
  if (draining) return;
  draining = true;

  try {
    for (;;) {
      const store = useSnapRoutingStore.getState();
      const gap = store.nextGap();
      if (gap === null) {
        store.setRouting(false);
        return;
      }

      const generation = store.generation;
      store.setRouting(true);

      /*
       * The leg to the most recently placed point is offered with its
       * alternatives (Requirement 1.1), unless the user turned that off or the
       * provider cannot. Earlier holes — a click ahead of a slow provider —
       * route plainly: only the newest leg is the one the user is choosing.
       */
      const isNewest = gap.index === store.legs.length - 1;
      const offerCandidates =
        isNewest &&
        useSettingsStore.getState().settings.routeAlternatives &&
        useRoutingStore.getState().status?.capabilities.alternatives === true;

      try {
        if (offerCandidates) {
          // eslint-disable-next-line no-await-in-loop
          const items = await call(
            api().routing.alternatives({ from: gap.from, to: gap.to, count: 3 }),
          );
          const accepted =
            items.length === 0
              ? // No road route at all: the same straight unmatched leg a
                // plain route reports (Phase 4 Requirement 3.6).
                useSnapRoutingStore.getState().acceptLeg(generation, gap.index, {
                  matched: false,
                  shape: [gap.from, gap.to],
                  distanceM: null,
                  displacementM: null,
                })
              : useSnapRoutingStore.getState().acceptCandidates(generation, gap.index, items);
          if (!accepted) return;
        } else {
          // eslint-disable-next-line no-await-in-loop
          const leg = await call(api().routing.routeLeg({ from: gap.from, to: gap.to }));
          if (!useSnapRoutingStore.getState().acceptLeg(generation, gap.index, leg)) {
            // The line changed while we were waiting. Another drain will pick
            // up from wherever it now is.
            return;
          }
        }
      } catch (cause) {
        const current = useSnapRoutingStore.getState();
        if (current.generation !== generation) return;
        current.setRouting(false);
        /*
         * The point stays on the map and the leg is left unrouted.
         *
         * Dropping the click would lose work the user did; silently inserting a
         * straight line would claim the provider answered when it did not.
         * Leaving the gap visible, with the reason, lets them retry or back out.
         */
        current.setError(describeError(cause));
        routingFailure(cause);
        return;
      }
    }
  } finally {
    draining = false;
    // A generation bump during the await above can leave `routing` stuck on,
    // because the loop returned before clearing it.
    const after = useSnapRoutingStore.getState();
    if (after.nextGap() === null || after.error !== null) {
      after.setRouting(false);
    } else {
      void drainSnapLegs();
    }
  }
}

/**
 * Serialises the tool's own mutations.
 *
 * Accepting a chosen candidate has to pin it first, which routes, and a click
 * that arrives meanwhile must land after it — otherwise two quick clicks could
 * append in the wrong order. Every tool mutation that can wait goes through
 * here, in arrival order.
 */
let toolQueue: Promise<void> = Promise.resolve();
function inToolOrder(task: () => Promise<void> | void): Promise<void> {
  toolQueue = toolQueue.then(task).catch((cause: unknown) => {
    toast(describeError(cause), 'error');
  });
  return toolQueue;
}

/**
 * Accepts the candidate selected for the newest leg (Requirement 1.6).
 *
 * Candidate A is the engine's own choice and needs nothing more. Any other is
 * pinned with shaping points on it so that re-routing the leg later keeps the
 * chosen roads (Requirement 3); the pins lie on the candidate, so the
 * geometry the user saw does not change.
 */
async function acceptSnapCandidate(): Promise<void> {
  const store = useSnapRoutingStore.getState();
  const choice = store.candidates;
  if (choice === null) return;
  store.clearCandidates();
  const chosen = choice.items[choice.selected];
  const preferred = choice.items[0];
  if (choice.selected === 0 || chosen === undefined || preferred === undefined) return;

  const generation = store.generation;
  const pinned = await pinCandidate(chosen.shape, preferred.shape, routeJoined);
  const now = useSnapRoutingStore.getState();
  // The draft moved on while pinning (undo, cancel): the pins describe a leg
  // that no longer exists, so they are dropped rather than applied.
  if (now.generation !== generation || pinned.shaping.length === 0) return;

  const plan = planEdit(
    now.controlPoints.map((point, i) => ({ point, role: now.roles[i] ?? 'via' })),
    draftLegShapes(now.controlPoints, now.legs),
    { kind: 'choose', leg: choice.leg, candidate: chosen.shape, shaping: pinned.shaping },
  );
  now.applyPlan(plan, null);
  if (!pinned.verified) {
    toast(
      'Using that route. TrailRT could not confirm that re-routing this section later will keep these roads.',
    );
  }
}

/** A shaping edit to the draft, from dragging or clicking in the tool. */
export function applySnapDraftEdit(edit: RouteEdit, routed: PreviewedLeg[] | null): Promise<void> {
  return inToolOrder(async () => {
    await acceptSnapCandidate();
    const store = useSnapRoutingStore.getState();
    const plan = planEdit(
      store.controlPoints.map((point, i) => ({ point, role: store.roles[i] ?? 'via' })),
      draftLegShapes(store.controlPoints, store.legs),
      edit,
    );
    store.applyPlan(plan, routed);
    void drainSnapLegs();
  });
}

/** ⌘Z in the tool. */
export function undoSnapDraft(): void {
  void inToolOrder(() => {
    if (!useSnapRoutingStore.getState().undo()) {
      toast('Nothing to undo in this route yet.');
      return;
    }
    void drainSnapLegs();
  });
}

export function appendSnapPoint(point: { lat: number; lon: number }): void {
  void inToolOrder(async () => {
    // Placing the next point accepts the candidate chosen for the last leg.
    await acceptSnapCandidate();
    useSnapRoutingStore.getState().appendPoint(point);
    void drainSnapLegs();
  });
}

export function undoLastSnapPoint(): void {
  void inToolOrder(() => {
    useSnapRoutingStore.getState().undoLastPoint();
    void drainSnapLegs();
  });
}

/**
 * Saves the route exactly as previewed.
 *
 * Refuses while a leg is still in flight: saving then would store a route
 * shorter than the one on screen, and the user would have no way to tell. A
 * leg that failed outright is the same situation and gets the same refusal.
 */
export function finishSnapRouting(): Promise<void> {
  return inToolOrder(async () => {
    await acceptSnapCandidate();
    await finishSnapRoutingNow();
  });
}

/** How long finishing waits for a leg still in flight. The engine takes milliseconds. */
const LEG_WAIT_MS = 5000;

/**
 * The draft once every leg is routed, a leg has failed, or the wait runs out.
 *
 * Polls the store rather than awaiting the drain: the drain is deliberately
 * fire-and-forget so clicks never wait for it, and a click can start another
 * drain while this one is being awaited.
 */
async function legsSettled(timeoutMs: number) {
  const started = Date.now();
  for (;;) {
    const state = useSnapRoutingStore.getState();
    if (snapComplete(state.legs) || state.error !== null) return state;
    if (Date.now() - started > timeoutMs) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function finishSnapRoutingNow(): Promise<void> {
  const editor = useEditorStore.getState();
  const tripId = editor.targetTripId;
  const snap = useSnapRoutingStore.getState();

  if (tripId === null) {
    cancelSnapRouting();
    return;
  }

  if (snap.controlPoints.length < 2) {
    toast('Place at least two points to build a route.', 'error');
    return;
  }

  // Enter or a double-click straight after the last click arrives while that
  // leg is still being routed. Waiting a moment for it is what the user meant;
  // refusing and making them press Enter again is not.
  const settled = await legsSettled(LEG_WAIT_MS);
  if (settled.generation !== snap.generation) return;
  if (!snapComplete(settled.legs)) {
    toast(
      settled.error === null
        ? 'Still routing the last leg — give it a moment.'
        : `The last leg could not be routed: ${settled.error}`,
      'error',
    );
    return;
  }

  const controlPoints = settled.controlPoints;
  const legs = settled.legs;
  const roles = settled.roles;
  const unmatched = legs.filter((leg) => !leg.matched).length;

  // Cleared before the write so a second Enter cannot submit the same route
  // twice while the first call is in flight.
  cancelSnapRouting();

  try {
    const route = await call(
      api().routing.createSnapped({
        tripId,
        name: 'New Route',
        controlPoints: [...controlPoints],
        // Named fields only: the boundary refuses any extra key.
        legs: legs.map(asPreviewedLeg),
        roles: [...roles],
      }),
    );
    await refreshAll();
    await useSelectionStore.getState().select({ kind: 'route', id: route.id });

    if (unmatched > 0) {
      toast(
        `Route saved, following roads for ${legs.length - unmatched} of ${legs.length} legs. The other ${unmatched === 1 ? 'one is' : `${unmatched} are`} straight lines, drawn dashed in red.`,
      );
    } else {
      toast(
        `Route saved, following roads across ${legs.length} leg${legs.length === 1 ? '' : 's'}. Undo with ⌘Z.`,
      );
    }
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

/**
 * Imports a map region for the built-in routing engine.
 *
 * The main process opens the file dialog, so the renderer neither supplies nor
 * learns a filesystem path — the same rule the file import pipeline follows.
 *
 * Can take minutes on a large extract, so progress arrives as events and the
 * toast reports the outcome rather than the UI blocking.
 */
export async function importRoutingRegion(): Promise<void> {
  const routing = useRoutingStore.getState();
  routing.setRegionImporting(true);

  try {
    const region = await call(api().routing.importRegion());

    // Null means the user cancelled the dialog. Not a failure, and not worth
    // a toast — they know they cancelled.
    if (region === null) return;

    await Promise.all([
      useRoutingStore.getState().loadStatus(),
      useRoutingStore.getState().loadRegion(),
    ]);
    // Cached road attributes were matched against a different graph, so their
    // provenance no longer describes anything real.
    useRoutingStore.getState().clear();

    toast(
      `Map region "${region.regionName}" ready — ${region.tileCount.toLocaleString()} tiles, ${(region.graphBytes / 1024 ** 2).toFixed(0)} MB. Snapping and speed limits now work offline.`,
    );
  } catch (cause) {
    toast(describeError(cause), 'error');
  } finally {
    useRoutingStore.getState().setRegionImporting(false);
    useRoutingStore.getState().setRegionProgress(null);
  }
}

/** Opens Settings, where map regions are managed. */
export function openSettings(): void {
  useUiStore.getState().openDialog({ kind: 'settings' });
}

/** Opens the region picker: the UK county map, with Elsewhere for the rest. */
export function openRegionPicker(): void {
  useUiStore.getState().openDialog({ kind: 'regionPicker' });
}

/**
 * Downloads the chosen regions and builds one graph from them.
 *
 * Closes the picker only on success. Leaving it open on failure keeps the
 * selection and the error together, so the user can change the selection
 * without starting over.
 */
export async function downloadRoutingRegions(
  regionIds: readonly string[],
  onDone?: () => void,
): Promise<void> {
  const routing = useRoutingStore.getState();
  routing.setRegionImporting(true);

  try {
    const region = await call(
      api().routing.downloadRegion({ regionIds: [...regionIds] }),
    );

    await Promise.all([
      useRoutingStore.getState().loadStatus(),
      useRoutingStore.getState().loadRegion(),
    ]);
    // Cached road attributes were matched against a different graph, so their
    // provenance no longer describes anything real.
    useRoutingStore.getState().clear();

    toast(
      `Map ready for ${region.regionName} — ${region.tileCount.toLocaleString()} tiles. Routes follow roads, offline.`,
    );
    if (region.terrainWarning !== undefined && region.terrainWarning !== null) {
      toast(region.terrainWarning, 'error');
    }
    onDone?.();
  } catch (cause) {
    toast(describeError(cause), 'error');
  } finally {
    const store = useRoutingStore.getState();
    store.setRegionImporting(false);
    store.setRegionJob(null);
    store.setRegionProgress(null);
  }
}
