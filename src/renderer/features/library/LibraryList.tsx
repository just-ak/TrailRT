import { Map as MapIcon, MapPin, Route as RouteIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BatchMember,
  ObjectRef,
  TreeNode,
} from "@shared/domain/types";
import type { DuplicateKind } from "@shared/library/duplicates";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import * as actions from "../../lib/actions";
import { api, call, describeError } from "../../lib/client";
import { useLibraryStore } from "../../stores/libraryStore";
import {
  batchMembers,
  isBatchKind,
  refKey,
  useSelectionStore,
} from "../../stores/selectionStore";
import { useUiStore } from "../../stores/uiStore";
import { TreeRow, type ClickModifiers } from "./TreeRow";
import { TripPickerDialog } from "./TripPickerDialog";
import { useMapFocusStore } from "../../stores/mapFocusStore";
import { useNavStore } from "../../stores/navStore";
import { OBJECTS_ROOT, PLAN_ROOT, TRIP_LIST_ROOT, TRIP_PAGE_ROOT } from "./libraryRoots";
import {
  askToUnlink,
  linkFolderToTrip,
  linkLooseFolder,
  relink as relinkFolder,
  rescan as rescanFolder,
  showPhotos,
} from "../photos/photoActions";
import {
  allSelectable,
  describeSelection,
  flattenVisible,
  focusablePath,
  moveFocus,
  rangeTo,
} from "./treeSelection";

/**
 * The left panel: a hierarchical library of folders, trips, routes and
 * waypoints.
 *
 * Drag-and-drop reparents rather than copying (ADR 0004), and a move that
 * would create a cycle is rejected by the main process with an explanation
 * rather than silently dropped.
 *
 * Multi-selection arrived in Phase 5. The mechanics live in
 * `treeSelection.ts`, because the tree uses two keyspaces — a node's `id` is a
 * path, a selection member is `kind:id` — and keeping the conversion between
 * them pure is what makes it testable.
 */

const MIME = "application/x-trailrt-node";

/** Where an item can be moved: outside any trip first (ADR 0022), then each trip. */
function moveDestinations(
  overview: readonly { id: string; name: string }[],
  looseTripId: string | null,
): { id: string; name: string }[] {
  return [...(looseTripId === null ? [] : [{ id: looseTripId, name: "Not in a trip" }]), ...overview];
}

/** Phase 14 Requirement 28: the section's Remove Duplicates… item. */
export function removeDuplicatesItem(kind: DuplicateKind): MenuItem {
  const many = kind === "track" ? "Tracks" : kind === "route" ? "Routes" : "Waypoints";
  return {
    label: `Remove Duplicate ${many}…`,
    separatorBefore: true,
    onSelect: () => useUiStore.getState().openDialog({ kind: "removeDuplicates", objectKind: kind }),
  };
}

/** The sections' roots, from `sectionRoot`. */
const TRACKS_ROOT = "section:tracks";
const ROUTES_ROOT = "section:routes";
const WAYPOINTS_ROOT = "section:waypoints";
/** A trip's page: its Plan and Objects tabs, and the trip searched (Requirement 29). */
const TRIP_PAGE_ROOTS: ReadonlySet<string> = new Set([PLAN_ROOT, OBJECTS_ROOT, TRIP_PAGE_ROOT]);

/** Every track in a row and under it. */
function trackIdsIn(node: TreeNode): string[] {
  if (node.ref?.kind === "track") return [node.ref.id];
  return node.children.flatMap(trackIdsIn);
}

/**
 * Where each list was scrolled to, by root. The trip list unmounts while a
 * trip page is open, and ‹ Trips should find it where it was left.
 */
const scrollMemory = new Map<string, number>();

/**
 * Which kinds can be dragged, and what they can be dropped onto.
 *
 * `track` was missing until Phase 5, which was an omission rather than a
 * decision: a track belongs to a trip exactly as a route does, and moving one
 * has always been supported through the service layer.
 */
const DRAGGABLE: ReadonlySet<string> = new Set([
  "trip",
  "folder",
  "route",
  "track",
  "waypoint",
]);

/** A drag payload: one object, or the whole multi-selection it was part of. */
interface DragPayload {
  members: ObjectRef[];
}

function canAcceptDrop(node: TreeNode, dragged: readonly ObjectRef[]): boolean {
  if (dragged.length === 0) return false;

  // A mixed drag goes where its most restrictive member can go, which for a
  // multi-selection of objects is always a trip.
  if (dragged.some((ref) => ref.kind === "trip" || ref.kind === "folder")) {
    // Trips and folders live in folders, or at the root of the Trips view.
    return (
      dragged.length === 1 &&
      (node.kind === "folder" ||
        node.heading === true ||
        (node.kind === "view" && node.viewId === "trips"))
    );
  }
  // Routes, tracks and waypoints belong to a trip, so only a trip receives them.
  return node.kind === "trip";
}

function readDragged(event: React.DragEvent): ObjectRef[] {
  const raw = event.dataTransfer.getData(MIME);
  if (raw.length === 0) return [];
  try {
    const payload = JSON.parse(raw) as DragPayload;
    return Array.isArray(payload.members) ? payload.members : [];
  } catch {
    // A foreign drag payload is not an error; it simply is not ours.
    return [];
  }
}

/**
 * One list of the left panel, drawn from a root. Phase 14, design §4.2.
 *
 * The trip list, a trip's contents and each cross-trip section are different
 * roots drawn by this one component, so selection, the keyboard model, drag,
 * rename and the context menus behave the same everywhere (Phase 5). The
 * root itself is not drawn.
 *
 * In the trip list, selecting a trip only selects it: the map and the right
 * panel follow, and the list stays where it is. Double-click, Return or the
 * row's arrow opens it (Requirement 2.4, as amended by the trip list flow).
 * The list's scroll position outlives it, so coming back from a trip page
 * finds the list as it was left.
 */
export function LibraryList({
  root,
  label,
  emptyText,
  openIds,
}: {
  root: TreeNode;
  label: string;
  emptyText?: string;
  /** Phase 14 Requirement 20.5: rows a search opens so its matches show, beside those the user opened. */
  openIds?: ReadonlySet<string>;
}): ReactNode {
  const { tree, loading, error, refresh, toggleExpanded, setExpanded } = useLibraryStore();
  const overview = useLibraryStore((s) => s.overview);
  const looseTripId = useLibraryStore((s) => s.looseTripId);
  const isTripList = root.id === TRIP_LIST_ROOT;

  const expanded = useLibraryStore((s) => s.expanded);

  const selected = useSelectionStore((s) => s.selected);
  const selectedKeys = useSelectionStore((s) => s.selectedKeys);
  const anchorKey = useSelectionStore((s) => s.anchorKey);
  const select = useSelectionStore((s) => s.select);
  const toggle = useSelectionStore((s) => s.toggle);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const showToast = useUiStore((s) => s.showToast);
  const openDialog = useUiStore((s) => s.openDialog);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
    /** True when the click landed inside an existing multi-selection. */
    inSelection: boolean;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** Phase 14 Requirement 21: what Move to Trip… is moving, while its list is open. */
  const [movePicker, setMovePicker] = useState<BatchMember[] | null>(null);
  // Stable: Dialog reopens itself when its onClose changes.
  const closeMovePicker = useCallback(() => setMovePicker(null), []);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  /** Which row holds the roving tab stop. A path, not a selection key. */
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const remembered = scrollMemory.get(root.id);
    if (remembered !== undefined && treeRef.current !== null) treeRef.current.scrollTop = remembered;
  }, [root.id]);

  const selectedKey = useMemo(
    () => (selected === null ? null : refKey(selected)),
    [selected],
  );

  /**
   * The rows on screen, in order.
   *
   * A Shift-click range is measured over exactly this list, which is what
   * makes Requirement 1.1 true: a collapsed trip's children are not here, so
   * they cannot be silently included.
   */
  const rows = useMemo(
    // The expansion *set* is the dependency, not the `isExpanded` predicate:
    // the predicate's identity is stable, so depending on it would never
    // recompute this when a branch opened.
    () =>
      flattenVisible(root, (path) => path === root.id || expanded.has(path) || openIds?.has(path) === true)
        .filter((row) => row.path !== root.id)
        .map((row) => ({ ...row, depth: row.depth - 1 })),
    [root, expanded, openIds],
  );

  /**
   * Drops selection members whose objects have gone.
   *
   * Requirement 1.9 makes this silent. An object disappearing from under a
   * selection is ordinary — another pane deleted it, an undo removed it, a
   * refresh raced a click — and an error would be noise.
   */
  useEffect(() => {
    if (tree === null) return;
    const surviving = new Set<string>();
    const walk = (node: TreeNode): void => {
      if (node.ref !== undefined) surviving.add(refKey(node.ref));
      for (const child of node.children) walk(child);
    };
    walk(tree);
    useSelectionStore.getState().prune(surviving);
  }, [tree]);

  const multiSelection = useMemo(
    () => (selectedKeys.size > 1 ? batchMembers(selectedKeys) : []),
    [selectedKeys],
  );

  // ------------------------------------------------------- click handling

  /**
   * Turns a click plus its modifiers into a selection change.
   *
   * The row cannot do this itself: only the panel knows the anchor and the
   * visible row order a range is measured over.
   */
  const handleRowClick = useCallback(
    (node: TreeNode, modifiers: ClickModifiers): void => {
      const ref = node.ref;
      if (ref === undefined) return;

      setFocusPath(node.id);

      // Trips and folders never join a multi-selection, so a modifier on one
      // behaves as a plain click rather than doing nothing — silently ignoring
      // the click would look broken.
      if (!isBatchKind(ref.kind)) {
        void select(ref);
        return;
      }

      if (modifiers.shiftKey) {
        const range = rangeTo(rows, anchorKey, node.id);
        if (range.length > 0) {
          // The anchor stays where the range started, so a second Shift-click
          // extends from the same origin instead of ratcheting along.
          const anchor =
            anchorKey === null
              ? ref
              : (range.find((candidate) => refKey(candidate) === anchorKey) ??
                ref);
          void selectMany(range, anchor);
          return;
        }
      }

      if (modifiers.metaKey) {
        void toggle(ref);
        return;
      }

      void select(ref);
    },
    [anchorKey, rows, select, selectMany, toggle],
  );

  // ---------------------------------------------------------- mutations

  const createTrip = useCallback(
    async (folderId: string | null) => {
      try {
        const trip = await call(
          api().trips.create({ name: "New Trip", folderId }),
        );
        // Phase 14: the new trip is named in the trip list, then opened by selecting it.
        const nav = useNavStore.getState();
        nav.setSection("trips");
        nav.closeTrip();
        await refresh();
        await select({ kind: "trip", id: trip.id });
        setRenamingId(`trip:${trip.id}`);
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [refresh, select, showToast],
  );

  const createFolder = useCallback(
    async (parentId: string | null) => {
      try {
        const folder = await call(
          api().folders.create({ name: "New Folder", parentId }),
        );
        if (parentId !== null) setExpanded(`folder:${parentId}`, true);
        await refresh();
        await select({ kind: "folder", id: folder.id });
        setRenamingId(`folder:${folder.id}`);
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [refresh, select, setExpanded, showToast],
  );

  const commitRename = useCallback(
    async (node: TreeNode, name: string) => {
      setRenamingId(null);
      const ref = node.ref;
      if (ref === undefined) return;

      const trimmed = name.trim();
      if (trimmed.length === 0) {
        showToast("A name cannot be empty.", "error");
        return;
      }

      try {
        switch (ref.kind) {
          case "trip":
            await call(api().trips.update({ id: ref.id, name: trimmed }));
            break;
          case "folder":
            await call(api().folders.rename({ id: ref.id, name: trimmed }));
            break;
          case "route":
            await actions.renameRoute(ref.id, trimmed);
            return;
          case "waypoint":
            await actions.updateWaypoint(ref.id, { name: trimmed });
            return;
          default:
            return;
        }
        await refresh();
        await useSelectionStore.getState().reload();
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [refresh, showToast],
  );

  // ------------------------------------------------------- batch actions

  /**
   * Asks the main process what the deletion would do, then confirms it.
   *
   * The assessment is fetched rather than guessed here, because only the main
   * process knows the point counts and the undo bounds — and because the same
   * calculation gates the mutation, so the warning cannot promise something
   * the deletion will not honour.
   */
  const confirmBatchDelete = useCallback(
    async (members: BatchMember[]) => {
      if (members.length === 0) return;
      try {
        const assessment = await call(
          api().batch.assess({ members, operation: "delete" }),
        );
        if (assessment.total === 0) {
          // Everything selected has already gone. Refreshing is the honest
          // response; an error would blame the user for a race.
          await refresh();
          return;
        }
        openDialog({ kind: "confirmBatchDelete", members, assessment });
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [openDialog, refresh, showToast],
  );

  const moveBatchToTrip = useCallback(
    async (members: BatchMember[], tripId: string) => {
      try {
        const outcome = await call(api().batch.move({ members, tripId }));
        await refresh();
        // One reload afterwards, not one per member (Requirement 2.8).
        await useSelectionStore.getState().reload();
        showToast(
          tripId === useLibraryStore.getState().looseTripId
            ? `Moved ${outcome.applied} object${outcome.applied === 1 ? "" : "s"} out of the trip.`
            : `Moved ${outcome.applied} object${outcome.applied === 1 ? "" : "s"} to that trip.`,
        );
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [refresh, showToast],
  );

  const confirmDeleteTripOrFolder = useCallback(
    async (ref: ObjectRef, name: string) => {
      try {
        if (ref.kind === "trip") {
          const trip = await call(api().trips.get({ id: ref.id }));
          openDialog({
            kind: "confirmDelete",
            target: { type: "trip", id: ref.id, name },
            counts: {
              routes: trip.routeCount,
              tracks: trip.trackCount,
              waypoints: trip.waypointCount,
            },
          });
        } else {
          openDialog({
            kind: "confirmDelete",
            target: { type: "folder", id: ref.id, name },
            counts: {},
          });
        }
      } catch (cause) {
        showToast(describeError(cause), "error");
      }
    },
    [openDialog, showToast],
  );

  // ------------------------------------------------------- drag and drop

  /**
   * Starts a drag, carrying the whole multi-selection when the dragged row is
   * part of one.
   *
   * Dragging one member of a twelve-object selection and moving only that one
   * would be a surprise. Dragging a row *outside* the selection carries only
   * that row, which matches how the context menu behaves.
   */
  const onDragStart =
    (node: TreeNode) =>
    (event: React.DragEvent): void => {
      const ref = node.ref;
      if (ref === undefined || !DRAGGABLE.has(ref.kind)) return;

      const members =
        selectedKeys.size > 1 && selectedKeys.has(refKey(ref))
          ? batchMembers(selectedKeys)
          : [ref];

      const payload: DragPayload = { members };
      event.dataTransfer.setData(MIME, JSON.stringify(payload));
      // "move", not "copy": dragging reparents rather than duplicating.
      event.dataTransfer.effectAllowed = "move";
    };

  const onDragOver =
    (node: TreeNode) =>
    (event: React.DragEvent): void => {
      if (!event.dataTransfer.types.includes(MIME)) return;
      // The payload is unreadable during dragover, so acceptance is checked
      // loosely here and strictly on drop.
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTargetId(node.id);
    };

  const onDrop =
    (node: TreeNode) =>
    (event: React.DragEvent): void => {
      event.preventDefault();
      setDropTargetId(null);

      const dragged = readDragged(event);
      if (!canAcceptDrop(node, dragged)) return;

      // Dropping something onto itself is a no-op, not an error.
      const onto = node.ref;
      if (
        dragged.length === 1 &&
        onto !== undefined &&
        onto.kind === dragged[0]?.kind &&
        onto.id === dragged[0]?.id
      ) {
        return;
      }

      // Several objects: one batch call, so it is one undo entry and one
      // library refresh rather than N of each.
      const objects = dragged.filter((ref) => isBatchKind(ref.kind));
      const destination = node.ref?.id;
      if (objects.length > 1 && destination !== undefined) {
        void moveBatchToTrip(
          objects.map((ref) => ({
            kind: ref.kind as BatchMember["kind"],
            id: ref.id,
          })),
          destination,
        );
        return;
      }

      const single = dragged[0];
      if (single === undefined) return;

      void (async () => {
        try {
          switch (single.kind) {
            case "trip": {
              const folderId =
                node.kind === "folder" ? (node.ref?.id ?? null) : null;
              await call(api().trips.move({ id: single.id, folderId }));
              if (folderId !== null) setExpanded(`folder:${folderId}`, true);
              break;
            }
            case "folder": {
              const parentId =
                node.kind === "folder" ? (node.ref?.id ?? null) : null;
              await call(api().folders.move({ id: single.id, parentId }));
              if (parentId !== null) setExpanded(`folder:${parentId}`, true);
              break;
            }
            case "route": {
              const tripId = node.ref?.id;
              if (tripId === undefined) return;
              await call(api().routes.move({ id: single.id, tripId }));
              showToast("Route moved to that trip.");
              break;
            }
            case "track": {
              const tripId = node.ref?.id;
              if (tripId === undefined) return;
              await call(api().tracks.move({ id: single.id, tripId }));
              showToast("Track moved to that trip.");
              break;
            }
            case "waypoint": {
              const tripId = node.ref?.id;
              if (tripId === undefined) return;
              await call(api().waypoints.moveToTrip({ id: single.id, tripId }));
              showToast("Waypoint moved to that trip.");
              break;
            }
            default:
              return;
          }
          await refresh();
          await useSelectionStore.getState().reload();
        } catch (cause) {
          // A rejected cycle arrives here with the main process's explanation.
          showToast(describeError(cause), "error");
        }
      })();
    };

  // Phase 14 Requirement 23: in the Tracks section, a track's arrow, or a
  // year's, month's or day's, shows those tracks on the map. A track's also
  // selects it, as clicking the row does.
  // Requirement 26: in the Routes and Waypoints sections, a route's arrow
  // selects it and fits the map to it; a waypoint's centres the map on it.
  // Requirement 29: on a trip's page, every route, track and waypoint row. Its
  // tracks belong to the trip the map draws, so a track is shown as a route is.
  const showOnMap = (node: TreeNode): { onShow?: () => void; showLabel?: string } => {
    const ref = node.ref;
    if (TRIP_PAGE_ROOTS.has(root.id) && (ref?.kind === "route" || ref?.kind === "track" || ref?.kind === "waypoint")) {
      const focus = useMapFocusStore.getState();
      return {
        showLabel: `Show ${node.name} on the map`,
        onShow: () =>
          void (ref.kind === "route" ? focus.showRoute(ref.id) : ref.kind === "track" ? focus.showTrack(ref.id) : focus.showWaypoint(ref.id)),
      };
    }
    if ((root.id === ROUTES_ROOT && ref?.kind === "route") || (root.id === WAYPOINTS_ROOT && ref?.kind === "waypoint")) {
      const focus = useMapFocusStore.getState();
      return {
        showLabel: `Show ${node.name} on the map`,
        onShow: () => void (ref.kind === "route" ? focus.showRoute(ref.id) : focus.showWaypoint(ref.id)),
      };
    }
    if (root.id !== TRACKS_ROOT) return {};
    const ids = trackIdsIn(node);
    if (ids.length === 0) return {};
    const shown = node.fullName ?? node.name;
    return {
      showLabel: `Show ${shown} on the map`,
      onShow: () => {
        if (node.ref?.kind === "track") void select(node.ref);
        void useMapFocusStore.getState().showTracks(ids, shown);
      },
    };
  };

  // -------------------------------------------------------- context menu

  // Phase 14 Requirement 9.5: one item moves in or out of a trip from its
  // own menu, through the batch path so it is one undo step. Requirement 21:
  // through a list of every trip, which the menu itself cannot hold.
  const moveTo = (member: BatchMember): MenuItem[] => [
    { label: "Move to Trip…", separatorBefore: true, onSelect: () => setMovePicker([member]) },
  ];

  const menuItems = (node: TreeNode, batch: BatchMember[]): MenuItem[] => {
    const ref = node.ref;


    /*
     * Batch actions replace the per-object ones when the click landed inside a
     * multi-selection (Requirement 1.7). Offering "Rename…" for twelve objects
     * would be a lie — the properties panel describes the anchor only, and
     * multi-object property editing is explicitly out of scope for this phase.
     */
    if (batch.length > 1) {
      // Every trip, from the overview: on a trip page no trip rows are drawn.
      // ADR 0022: "Not in a trip" comes first.
      const destinations = moveDestinations(overview, looseTripId);
      // Requirement 13.5: two routes or waypoints can be joined by a new route,
      // from the first one's end to the second one's start, in list order.
      const [joinFrom, joinTo] = batch;
      const joinable =
        batch.length === 2 &&
        joinFrom !== undefined &&
        joinTo !== undefined &&
        (joinFrom.kind === "route" || joinFrom.kind === "waypoint") &&
        (joinTo.kind === "route" || joinTo.kind === "waypoint");
      const join: MenuItem[] = joinable
        ? [
            {
              label: "Join with a New Route",
              separatorBefore: true,
              onSelect: () => void actions.joinWithRoute({ kind: joinFrom.kind as "route" | "waypoint", id: joinFrom.id }, { kind: joinTo.kind as "route" | "waypoint", id: joinTo.id }, false),
            },
            {
              label: "Join with a Straight Line",
              onSelect: () => void actions.joinWithRoute({ kind: joinFrom.kind as "route" | "waypoint", id: joinFrom.id }, { kind: joinTo.kind as "route" | "waypoint", id: joinTo.id }, true),
            },
          ]
        : [];
      return [
        { label: describeSelection(batch), disabled: true },
        ...join,
        {
          // Requirement 21: a list of every trip, rather than the first eight
          // inline. Choosing this moves nothing until a trip is picked.
          label: "Move to Trip…",
          separatorBefore: true,
          disabled: destinations.length === 0,
          disabledReason: "There are no trips to move these into.",
          onSelect: () => setMovePicker(batch),
        },
        {
          label: `Delete ${batch.length} Objects…`,
          danger: true,
          separatorBefore: true,
          onSelect: () => void confirmBatchDelete(batch),
        },
      ];
    }

    // Phase 14: empty space on a trip's page offers what can be added to it.
    if (node.id === TRIP_PAGE_ROOT) {
      return [
        { label: "New Route", onSelect: () => void actions.startDrawingRoute() },
        { label: "New Straight-Line Route", onSelect: () => void actions.startStraightLineRoute() },
        { label: "New Waypoint", onSelect: () => void actions.startPlacingWaypoint() },
      ];
    }

    if ((node.kind === "view" && node.viewId === "trips") || node.heading === true || node.id === TRIP_LIST_ROOT) {
      return [
        { label: "New Trip", onSelect: () => void createTrip(null) },
        { label: "New Folder", onSelect: () => void createFolder(null) },
      ];
    }

    if (node.kind === "view") {
      return node.available === true
        ? [
            {
              label: `${node.children.length} item${node.children.length === 1 ? "" : "s"}`,
              disabled: true,
            },
          ]
        : [
            {
              label: node.name,
              disabled: true,
              disabledReason: "This view becomes available in a later phase.",
            },
          ];
    }

    if (ref?.kind === "folder") {
      return [
        {
          label: "New Trip in Folder",
          onSelect: () => void createTrip(ref.id),
        },
        { label: "New Subfolder", onSelect: () => void createFolder(ref.id) },
        {
          label: "Rename…",
          separatorBefore: true,
          onSelect: () => setRenamingId(node.id),
        },
        {
          label: "Delete Folder…",
          danger: true,
          separatorBefore: true,
          onSelect: () => void confirmDeleteTripOrFolder(ref, node.name),
        },
      ];
    }

    if (ref?.kind === "trip") {
      const archived = node.status === "archived";
      return [
        { label: "New Route", onSelect: () => void actions.startDrawingRoute() },
        {
          label: "New Straight-Line Route",
          onSelect: () => void actions.startStraightLineRoute(),
        },
        {
          label: "New Waypoint",
          onSelect: () => void actions.startPlacingWaypoint(),
        },
        {
          // Phase 11. Named for the folder, not photos (design §4.1).
          label: "Link Folder…",
          onSelect: () => void linkFolderToTrip(ref.id, node.name),
        },
        {
          label: "Rename…",
          separatorBefore: true,
          onSelect: () => setRenamingId(node.id),
        },
        {
          label: "Duplicate",
          onSelect: () =>
            void (async () => {
              try {
                const copy = await call(api().trips.duplicate({ id: ref.id }));
                await refresh();
                await select({ kind: "trip", id: copy.id });
              } catch (cause) {
                showToast(describeError(cause), "error");
              }
            })(),
        },
        {
          label: archived ? "Unarchive" : "Archive",
          onSelect: () =>
            void (async () => {
              try {
                await call(
                  api().trips.setStatus({
                    id: ref.id,
                    status: archived ? "active" : "archived",
                  }),
                );
                await refresh();
              } catch (cause) {
                showToast(describeError(cause), "error");
              }
            })(),
        },
        {
          label: "Delete Trip…",
          danger: true,
          separatorBefore: true,
          onSelect: () => void confirmDeleteTripOrFolder(ref, node.name),
        },
      ];
    }

    if (ref?.kind === "route") {
      return [
        { label: "Rename…", onSelect: () => setRenamingId(node.id) },
        {
          label: "Reverse",
          separatorBefore: true,
          onSelect: () => void actions.reverseRoute(ref.id),
        },
        {
          label: "Duplicate",
          onSelect: () => void actions.duplicateRoute(ref.id),
        },
        {
          label: "Edit Points…",
          onSelect: () => {
            void select(ref);
            actions.openPointTable("route", ref.id);
          },
        },
        ...moveTo({ kind: "route", id: ref.id }),
        {
          label: "Delete Route",
          danger: true,
          separatorBefore: true,
          onSelect: () => void actions.deleteRoute(ref.id),
        },
      ];
    }

    if (ref?.kind === "track") {
      // Tracks had no context menu at all before Phase 5, which left reverse
      // and deletion reachable only from the properties panel.
      return [
        { label: "Rename…", onSelect: () => setRenamingId(node.id) },
        {
          label: "Reverse",
          separatorBefore: true,
          onSelect: () =>
            void (async () => {
              try {
                await call(api().tracks.reverse({ id: ref.id }));
                await refresh();
                await useSelectionStore.getState().reload();
              } catch (cause) {
                showToast(describeError(cause), "error");
              }
            })(),
        },
        {
          label: "Edit Points…",
          onSelect: () => {
            void select(ref);
            actions.openPointTable("track", ref.id);
          },
        },
        {
          label: "Delete Track…",
          danger: true,
          separatorBefore: true,
          // Through the batch path even for one object, so the confirmation
          // naming what cannot be undone is the same one a batch shows.
          onSelect: () =>
            void confirmBatchDelete([{ kind: "track", id: ref.id }]),
        },
        ...moveTo({ kind: "track", id: ref.id }),
      ];
    }

    if (ref?.kind === "linkedFolder") {
      return [
        { label: "Show Photos", onSelect: () => showPhotos(ref.id) },
        { label: "Rescan", onSelect: () => void rescanFolder(ref.id) },
        { label: "Relink…", onSelect: () => void relinkFolder(ref.id) },
        {
          label: "Unlink…",
          danger: true,
          separatorBefore: true,
          onSelect: () => askToUnlink(ref.id, node.name),
        },
      ];
    }

    if (ref?.kind === "waypoint") {
      return [
        { label: "Rename…", onSelect: () => setRenamingId(node.id) },
        {
          label: "Duplicate",
          separatorBefore: true,
          onSelect: () => void actions.duplicateWaypoint(ref.id),
        },
        ...moveTo({ kind: "waypoint", id: ref.id }),
        {
          label: "Delete Waypoint",
          danger: true,
          separatorBefore: true,
          onSelect: () => void actions.deleteWaypoint(ref.id),
        },
      ];
    }

    // The list's own space: what makes sense in this section (owner
    // feedback, 14 Nov 2026: the Routes section offered only New Trip).
    switch (root.id) {
      case "section:routes":
        return [
          { label: "New Route", onSelect: () => void actions.startDrawingRoute() },
          { label: "New Straight-Line Route", onSelect: () => void actions.startStraightLineRoute() },
          { label: "Import Files…", separatorBefore: true, onSelect: () => void actions.chooseFilesToImport() },
          removeDuplicatesItem("route"),
        ];
      case "section:waypoints":
        return [
          { label: "New Waypoint", onSelect: () => void actions.startPlacingWaypoint() },
          { label: "Import Files…", separatorBefore: true, onSelect: () => void actions.chooseFilesToImport() },
          removeDuplicatesItem("waypoint"),
        ];
      case "section:tracks":
        return [{ label: "Import Files…", onSelect: () => void actions.chooseFilesToImport() }, removeDuplicatesItem("track")];
      case "section:imported":
        return [{ label: "Import Files…", onSelect: () => void actions.chooseFilesToImport() }];
      case "section:photos":
        return [{ label: "Link a Folder…", onSelect: () => void linkLooseFolder() }];
      case OBJECTS_ROOT:
      case PLAN_ROOT:
      case TRIP_PAGE_ROOT:
        return [
          { label: "New Route", onSelect: () => void actions.startDrawingRoute() },
          { label: "New Straight-Line Route", onSelect: () => void actions.startStraightLineRoute() },
          { label: "New Waypoint", onSelect: () => void actions.startPlacingWaypoint() },
          { label: "Import Files…", separatorBefore: true, onSelect: () => void actions.chooseFilesToImport() },
        ];
      default:
        return [
          { label: "New Trip", onSelect: () => void createTrip(null) },
          { label: "New Folder", onSelect: () => void createFolder(null) },
        ];
    }
  };

  // Phase 14: the header's More menu asks for a new trip or folder.
  // A request is consumed once, so a list mounted later never repeats it.
  useEffect(
    () =>
      useNavStore.subscribe((state) => {
        const request = state.request;
        if (request === null) return;
        useNavStore.setState({ request: null });
        if (request.kind === "newTrip") void createTrip(null);
        else void createFolder(null);
      }),
    [createTrip, createFolder],
  );

  // Native menu actions that act on the library selection.
  useEffect(() => {
    return api().events.onMenuAction((action) => {
      const state = useSelectionStore.getState();
      const ref = state.selected;

      if (action === "trip:new") void createTrip(null);
      else if (action === "folder:new") void createFolder(null);
      else if (action === "selection:selectAll") {
        const every = allSelectable(rows);
        if (every.length > 0) void selectMany(every, ref);
      } else if (action === "trip:rename" && ref !== null) {
        setRenamingId(`${ref.kind}:${ref.id}`);
      } else if (action === "trip:duplicate" && ref?.kind === "trip") {
        void (async () => {
          const copy = await call(api().trips.duplicate({ id: ref.id }));
          await refresh();
          await select({ kind: "trip", id: copy.id });
        })();
      } else if (action === "trip:delete" || action === "selection:delete") {
        // A multi-selection takes priority: the user built it, and deleting
        // only the anchor would quietly ignore eleven of their twelve clicks.
        const members = batchMembers(state.selectedKeys);
        if (members.length > 1) {
          void confirmBatchDelete(members);
          return;
        }
        if (ref === null) return;
        if (ref.kind === "route") void actions.deleteRoute(ref.id);
        else if (ref.kind === "waypoint") void actions.deleteWaypoint(ref.id);
        else if (ref.kind === "track") {
          void confirmBatchDelete([{ kind: "track", id: ref.id }]);
        } else {
          const name = state.trip?.name ?? state.folder?.name ?? "this item";
          void confirmDeleteTripOrFolder(ref, name);
        }
      }
    });
  }, [
    createTrip,
    createFolder,
    confirmBatchDelete,
    confirmDeleteTripOrFolder,
    refresh,
    rows,
    select,
    selectMany,
  ]);

  // --------------------------------------------------------- keyboard model

  /**
   * Arrow navigation, Space, ⌘A and Escape over the tree.
   *
   * The tree had no keyboard handling at all before Phase 5 — no tab stop, no
   * arrow keys — so this is the first time it is reachable without a pointer
   * (Requirements 1.5 and 1.6).
   */
  const onTreeKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (renamingId !== null) return;

      const current = focusablePath(rows, focusPath, anchorKey);

      const focusRow = (delta: number): void => {
        const next = moveFocus(rows, current, delta);
        if (next === null) return;
        event.preventDefault();
        setFocusPath(next.path);
        // Moving the DOM focus as well as the state, or a screen reader would
        // announce nothing and the roving tabIndex would be decorative.
        treeRef.current
          ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.path)}"]`)
          ?.focus();

        if (event.shiftKey && next.ref !== null && next.selectable) {
          const range = rangeTo(rows, anchorKey, next.path);
          if (range.length > 0) {
            void selectMany(range, selected);
            return;
          }
        }
        if (!event.shiftKey && next.ref !== null) void select(next.ref);
      };

      switch (event.key) {
        case "ArrowDown":
          focusRow(1);
          return;
        case "ArrowUp":
          focusRow(-1);
          return;
        case "ArrowRight": {
          const row = rows.find((candidate) => candidate.path === current);
          if (row !== undefined && row.node.children.length > 0) {
            event.preventDefault();
            setExpanded(row.path, true);
          }
          return;
        }
        case "ArrowLeft": {
          const row = rows.find((candidate) => candidate.path === current);
          if (row !== undefined && row.node.children.length > 0) {
            event.preventDefault();
            setExpanded(row.path, false);
          }
          return;
        }
        case " ": {
          const row = rows.find((candidate) => candidate.path === current);
          if (row?.ref != null && row.selectable) {
            event.preventDefault();
            void toggle(row.ref);
          }
          return;
        }
        case "Escape": {
          event.preventDefault();
          // A batch collapses to its anchor; a single selection clears, which
          // brings back the year on the right (the trip list flow).
          const selection = useSelectionStore.getState();
          if (selection.selectedKeys.size > 1) selection.collapseToAnchor();
          else void select(null);
          return;
        }
        case "Enter": {
          const row = rows.find((candidate) => candidate.path === current);
          if (isTripList && row?.ref?.kind === "trip") {
            event.preventDefault();
            useNavStore.getState().openTrip(row.ref.id);
          }
          return;
        }
        case "a":
        case "A": {
          if (!event.metaKey) return;
          event.preventDefault();
          const every = allSelectable(rows);
          if (every.length > 0) void selectMany(every, selected);
          return;
        }
        default:
          return;
      }
    },
    [
      anchorKey,
      focusPath,
      isTripList,
      renamingId,
      rows,
      select,
      selected,
      selectMany,
      setExpanded,
      toggle,
    ],
  );

  // ------------------------------------------------------------- render

  const tabStop = focusablePath(rows, focusPath, anchorKey);

  /*
   * Rendered from the flattened row list rather than by recursing again.
   *
   * One source of truth for "which rows are visible and in what order": the
   * range a Shift-click selects is measured over this list, so rendering from
   * a second traversal would be an invitation for the two to disagree.
   */
  const renderedRows = rows.map((row) => {
    const nodeKey = row.ref === null ? null : refKey(row.ref);
    const inSelection = nodeKey !== null && selectedKeys.has(nodeKey);
    const hasChildren = row.node.children.length > 0;

    return (
      <TreeRow
        key={row.path}
        node={row.node}
        depth={row.depth}
        selected={nodeKey !== null && nodeKey === selectedKey}
        twoLine={isTripList && row.node.kind === "trip"}
        inSelection={inSelection}
        expanded={expanded.has(row.path)}
        hasChildren={hasChildren}
        renaming={renamingId === row.path}
        dropTarget={dropTargetId === row.path}
        focusable={tabStop === row.path}
        onToggle={() => toggleExpanded(row.path)}
        {...(isTripList && row.ref?.kind === "trip"
          ? { onOpen: () => useNavStore.getState().openTrip(row.node.ref?.id ?? "") }
          : {})}
        {...showOnMap(row.node)}
        onFocusRow={() => setFocusPath(row.path)}
        onSelect={(modifiers) => handleRowClick(row.node, modifiers)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();

          // Requirement 1.7: a right-click inside an existing multi-selection
          // keeps it and offers the batch actions. Outside it, the selection
          // is replaced, matching single-select behaviour.
          const keepSelection = inSelection && selectedKeys.size > 1;
          if (!keepSelection && row.ref !== null) void select(row.ref);

          setMenu({
            x: event.clientX,
            y: event.clientY,
            node: row.node,
            inSelection: keepSelection,
          });
        }}
        onRenameCommit={(name) => void commitRename(row.node, name)}
        onRenameCancel={() => setRenamingId(null)}
        {...(row.ref !== null && DRAGGABLE.has(row.ref.kind)
          ? { onDragStart: onDragStart(row.node) }
          : {})}
        onDragOver={onDragOver(row.node)}
        onDragLeave={() => setDropTargetId(null)}
        onDrop={onDrop(row.node)}
      />
    );
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={treeRef}
        role="tree"
        aria-label={label}
        // Declared so assistive technology announces that more than one row
        // can be selected at once. Without it, `aria-selected` on several rows
        // reads as a bug rather than a feature.
        aria-multiselectable="true"
        tabIndex={-1}
        onKeyDown={onTreeKeyDown}
        onScroll={(event) => scrollMemory.set(root.id, event.currentTarget.scrollTop)}
        // A click on the list's empty space clears the selection. Rows stop
        // their own clicks, so this only sees the space between and below them.
        onClick={(event) => {
          if (event.target === event.currentTarget) void select(null);
        }}
        className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({
            x: event.clientX,
            y: event.clientY,
            node: root,
            inSelection: false,
          });
        }}
      >
        {loading && tree === null && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
            Loading…
          </p>
        )}

        {error !== null && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {renderedRows}
        {tree !== null && rows.length === 0 && emptyText !== undefined && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">{emptyText}</p>
        )}
      </div>

      {/*
        The selection summary.

        Requirement 1.4 wants the count and composition visible, and 1.10 wants
        it said plainly that the properties panel is describing one of them —
        otherwise a panel showing one route while twelve rows are highlighted
        looks like the selection was lost.
      */}
      {multiSelection.length > 1 && (
        <div
          aria-live="polite"
          className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)]"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold">
              {describeSelection(
                multiSelection.map((member) => ({
                  kind: member.kind,
                  id: member.id,
                })),
              )}
            </span>
            <button
              type="button"
              onClick={() => useSelectionStore.getState().collapseToAnchor()}
              className="ml-auto rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 hover:bg-[var(--color-surface)]"
            >
              Clear
            </button>
            <button
              type="button"
              aria-label="Delete selected objects"
              onClick={() => void confirmBatchDelete(multiSelection)}
              className="rounded border border-[var(--color-danger)]/50 px-1.5 py-0.5 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
            >
              Delete…
            </button>
          </div>
          <p className="mt-0.5 text-[var(--color-text-muted)]">
            Properties shows the last one clicked. Batch actions apply to all of
            them.
          </p>
        </div>
      )}

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.node, menu.inSelection ? multiSelection : [])}
          onClose={() => setMenu(null)}
        />
      )}

      {movePicker !== null && (
        <TripPickerDialog
          title={movePicker.length === 1 ? `Move the ${movePicker[0]?.kind ?? "object"} to a trip` : `Move ${describeSelection(movePicker).replace(/ selected$/, "")} to a trip`}
          destinations={moveDestinations(overview, looseTripId)}
          onClose={closeMovePicker}
          onPick={(tripId) => {
            const members = movePicker;
            closeMovePicker();
            void moveBatchToTrip(members, tripId);
          }}
        />
      )}
    </div>
  );
}

/** Nothing in the open list matches: say so, and offer the whole library (Requirement 20.7). */
export function NothingMatches({ where }: { where: string }): ReactNode {
  const setScope = useLibraryStore((s) => s.setSearchScope);
  return (
    <div className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]" data-testid="search-nothing-here">
      <p>Nothing in {where} matches.</p>
      <button type="button" className="mt-1 text-[var(--color-accent)] hover:underline" onClick={() => void setScope("everywhere")}>
        Search everywhere
      </button>
    </div>
  );
}

/** A search pattern that is not valid, explained (Phase 14 Requirement 20.3). */
export function SearchProblem({ message }: { message: string }): ReactNode {
  return (
    <div role="alert" data-testid="search-error" className="px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
      <p className="font-semibold text-[var(--color-danger)]">Not a valid pattern</p>
      <p className="mt-0.5">{message}.</p>
      <p className="mt-1 text-[var(--color-text-muted)]">
        Search takes a regular expression. Put a backslash before ( ) [ ] . * + ? to match it as written.
      </p>
    </div>
  );
}

/**
 * Flat search results across trips, routes and waypoints (Phase 14
 * Requirement 20). A pattern that is not valid explains itself in place of
 * the count, with no results under it.
 */
export function SearchResults({
  selectedKey,
}: {
  selectedKey: string | null;
}): ReactNode {
  const trips = useLibraryStore((s) => s.searchResults);
  const routes = useLibraryStore((s) => s.routeResults);
  const waypoints = useLibraryStore((s) => s.waypointResults);
  const error = useLibraryStore((s) => s.searchError);
  const looseTripId = useLibraryStore((s) => s.looseTripId);
  const select = useSelectionStore((s) => s.select);

  if (error !== null) return <SearchProblem message={error} />;

  const total = (trips?.length ?? 0) + (routes?.length ?? 0) + (waypoints?.length ?? 0);
  // ADR 0022: one outside a trip opens its section, never a trip page.
  const reveal = (tripId: string, section: "routes" | "waypoints"): void => {
    void useLibraryStore.getState().setSearch("");
    if (tripId === looseTripId) useNavStore.getState().setSection(section);
    else useNavStore.getState().openTrip(tripId);
  };
  const tripName = (tripId: string, name: string): string => (tripId === looseTripId ? "Not in a trip" : name);
  const rowClass = (key: string): string =>
    `flex w-full min-w-0 items-center gap-1.5 overflow-hidden px-3 py-1 text-left text-[13px] ${
      selectedKey === key ? "bg-[var(--color-accent)] text-white" : "hover:bg-[var(--color-surface-sunken)]"
    }`;
  const iconClass = "shrink-0 opacity-70";

  return (
    <div data-testid="search-results">
      <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {total} match{total === 1 ? "" : "es"}
      </p>

      {(trips ?? []).map((trip) => (
        <button
          key={`trip:${trip.id}`}
          type="button"
          onClick={() => {
            // Phase 14: a trip found by search opens, as it does from the list.
            void useLibraryStore.getState().setSearch("");
            useNavStore.getState().openTrip(trip.id);
          }}
          className={rowClass(`trip:${trip.id}`)}
        >
          <MapIcon size={14} aria-hidden="true" className={iconClass} />
          <span className="truncate">{trip.name}</span>
        </button>
      ))}

      {(routes ?? []).map((route) => (
        <button
          key={`route:${route.id}`}
          type="button"
          onClick={() => {
            reveal(route.tripId, "routes");
            void select({ kind: "route", id: route.id });
          }}
          className={rowClass(`route:${route.id}`)}
        >
          <RouteIcon size={14} aria-hidden="true" className={iconClass} />
          <span className="min-w-0 shrink-0 truncate" style={{ maxWidth: "70%" }}>{route.name}</span>
          <span className="min-w-[4rem] max-w-[45%] shrink truncate text-[11px] text-[var(--color-text-muted)]">{tripName(route.tripId, route.tripName)}</span>
        </button>
      ))}

      {(waypoints ?? []).map((waypoint) => (
        <button
          key={`waypoint:${waypoint.id}`}
          type="button"
          onClick={() => {
            reveal(waypoint.tripId, "waypoints");
            void select({ kind: "waypoint", id: waypoint.id });
          }}
          className={rowClass(`waypoint:${waypoint.id}`)}
        >
          <MapPin size={14} aria-hidden="true" className={iconClass} />
          <span className="min-w-0 shrink-0 truncate" style={{ maxWidth: "70%" }}>{waypoint.name}</span>
          <span className="min-w-[4rem] max-w-[45%] shrink truncate text-[11px] text-[var(--color-text-muted)]">{tripName(waypoint.tripId, waypoint.tripName)}</span>
        </button>
      ))}
    </div>
  );
}
