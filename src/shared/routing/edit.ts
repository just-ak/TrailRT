import type { LatLon } from '../geo/distance';
import type {
  ControlRole,
  DisplacedControlPoint,
  SectionLocation,
} from './RoutingProvider';

/**
 * The edit planner: one description of every shaping edit, shared by the snap
 * routing tool and saved routes. Phase 6, design §3.
 *
 * An edit changes the control points, and the planner works out three things
 * from that: the new control points, which legs of the old route are replaced,
 * and what has to be routed to replace them. It does no I/O. The renderer runs
 * it to preview an edit; the main process runs it again against the database
 * before writing, so the two can never disagree about what an edit means.
 *
 * ## Section ends are never pass-through
 *
 * The locations routed for an edit start and end at control points whose
 * *other* leg is not being re-routed. Marking those ends pass-through would
 * only be meaningful if the neighbouring legs were routed in the same request,
 * which would change legs Requirement 5.1 says stay identical. So section ends
 * are ordinary stops, and a reversal there is caught afterwards by
 * `reversalAt` (design §5) rather than prevented.
 */

export interface PlannedControl {
  point: LatLon;
  role: ControlRole;
}

export type RouteEdit =
  /** Add a via point after the last one. */
  | { kind: 'append'; at: LatLon }
  /** Drag a control point. */
  | { kind: 'move'; index: number; to: LatLon }
  /** Drag the line of leg `leg`: a new shaping point at `at`. */
  | { kind: 'insert'; leg: number; at: LatLon }
  /**
   * Click the line of leg `leg`: a shaping point exactly on the line, with no
   * routing and no change to the geometry. `segmentEnd` is the index, within
   * that leg's shape, of the end vertex of the clicked segment.
   */
  | { kind: 'insertOnLine'; leg: number; segmentEnd: number; at: LatLon }
  | { kind: 'remove'; index: number }
  | { kind: 'setRole'; index: number; role: ControlRole }
  /**
   * Replace leg `leg` with a chosen candidate, pinned by `shaping` points that
   * lie on it, in order along it. No routing: the candidate is the geometry.
   */
  | { kind: 'choose'; leg: number; candidate: readonly LatLon[]; shaping: readonly LatLon[] };

export interface EditPlan {
  control: PlannedControl[];
  /**
   * Legs replaced, in the old numbering, and how many legs replace them. Null
   * when the geometry does not change at all.
   */
  replace: { from: number; to: number; count: number } | null;
  /** What to route for the replacement. Null when the geometry is known. */
  section: SectionLocation[] | null;
  /** The replacement legs, when no routing is needed. */
  knownLegs: LatLon[][] | null;
  /** New control index of `section[0]`, so routed results can be placed. */
  sectionStart: number;
  /** New index for an old control point, or null if it was removed or moved. */
  remapControl: (old: number) => number | null;
  /** New index for an old leg, or null if it was replaced. */
  remapLeg: (old: number) => number | null;
}

/** An edit that cannot be made. The message is written for the user. */
export class EditRefused extends Error {
  override name = 'EditRefused';
}

function stop(point: LatLon): SectionLocation {
  return { point: { lat: point.lat, lon: point.lon }, passThrough: false };
}

function copyControl(c: PlannedControl): PlannedControl {
  return { point: { lat: c.point.lat, lon: c.point.lon }, role: c.role };
}

/**
 * Splits `shape` at each of `at`, in order, inserting each as a vertex on the
 * nearest segment at or after the previous split. Returns `at.length + 1`
 * pieces whose joins are exactly the split points.
 */
export function splitShapeAt(
  shape: readonly LatLon[],
  at: readonly LatLon[],
): LatLon[][] {
  const pieces: LatLon[][] = [];
  let rest = shape.map((p) => ({ lat: p.lat, lon: p.lon }));

  for (const point of at) {
    let bestEnd = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    const scale = Math.cos((point.lat * Math.PI) / 180);
    for (let i = 1; i < rest.length; i += 1) {
      const a = rest[i - 1] as LatLon;
      const b = rest[i] as LatLon;
      const ax = a.lon * scale;
      const bx = b.lon * scale;
      const px = point.lon * scale;
      const dx = bx - ax;
      const dy = b.lat - a.lat;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq === 0
          ? 0
          : Math.max(0, Math.min(1, ((px - ax) * dx + (point.lat - a.lat) * dy) / lengthSq));
      const d = Math.hypot(px - (ax + t * dx), point.lat - (a.lat + t * dy));
      if (d < bestDistance) {
        bestDistance = d;
        bestEnd = i;
      }
    }
    const split = { lat: point.lat, lon: point.lon };
    pieces.push([...rest.slice(0, bestEnd), split]);
    rest = [split, ...rest.slice(bestEnd)];
  }

  pieces.push(rest);
  return pieces;
}

const identity = (old: number): number => old;

const clonePoint = (p: LatLon): LatLon => ({ lat: p.lat, lon: p.lon });

function shiftAfter(position: number, delta: number) {
  return (old: number): number => (old >= position ? old + delta : old);
}

/**
 * Plans `edit` against `control` (the current control points) and `legs` (the
 * current shape of each leg, needed only by `insertOnLine`).
 *
 * Throws `EditRefused` for an edit that would break a rule: fewer than two
 * control points, or a shaping point at either end.
 */
export function planEdit(
  control: readonly PlannedControl[],
  legs: readonly (readonly LatLon[])[],
  edit: RouteEdit,
): EditPlan {
  const n = control.length;
  const legCount = Math.max(0, n - 1);
  const next = control.map(copyControl);
  const at = (i: number): LatLon => (control[i] as PlannedControl).point;
  const checkIndex = (i: number): void => {
    if (!Number.isInteger(i) || i < 0 || i >= n) {
      throw new EditRefused('That point is no longer part of the route.');
    }
  };
  const checkLeg = (k: number): void => {
    if (!Number.isInteger(k) || k < 0 || k >= legCount) {
      throw new EditRefused('That section is no longer part of the route.');
    }
  };
  switch (edit.kind) {
    case 'append': {
      next.push({ point: { ...edit.at }, role: 'via' });
      return {
        control: next,
        replace: { from: legCount, to: legCount, count: 1 },
        section: n === 0 ? null : [stop(at(n - 1)), stop(edit.at)],
        knownLegs: null,
        sectionStart: n - 1,
        remapControl: identity,
        remapLeg: identity,
      };
    }

    case 'move': {
      checkIndex(edit.index);
      const i = edit.index;
      (next[i] as PlannedControl).point = { ...edit.to };
      const moved = (old: number): number | null => (old === i ? null : old);

      if (n === 1) {
        return {
          control: next,
          replace: null,
          section: null,
          knownLegs: null,
          sectionStart: 0,
          remapControl: moved,
          remapLeg: identity,
        };
      }
      if (i === 0) {
        return {
          control: next,
          replace: { from: 0, to: 1, count: 1 },
          section: [stop(edit.to), stop(at(1))],
          knownLegs: null,
          sectionStart: 0,
          remapControl: moved,
          remapLeg: (old) => (old === 0 ? null : old),
        };
      }
      if (i === n - 1) {
        return {
          control: next,
          replace: { from: n - 2, to: n - 1, count: 1 },
          section: [stop(at(n - 2)), stop(edit.to)],
          knownLegs: null,
          sectionStart: n - 2,
          remapControl: moved,
          remapLeg: (old) => (old === n - 2 ? null : old),
        };
      }
      return {
        control: next,
        replace: { from: i - 1, to: i + 1, count: 2 },
        section: [
          stop(at(i - 1)),
          { point: { ...edit.to }, passThrough: control[i]?.role === 'shaping' },
          stop(at(i + 1)),
        ],
        knownLegs: null,
        sectionStart: i - 1,
        remapControl: moved,
        remapLeg: (old) => (old === i - 1 || old === i ? null : old),
      };
    }

    case 'insert': {
      checkLeg(edit.leg);
      const k = edit.leg;
      next.splice(k + 1, 0, { point: { ...edit.at }, role: 'shaping' });
      const shift = shiftAfter(k + 1, 1);
      return {
        control: next,
        replace: { from: k, to: k + 1, count: 2 },
        section: [stop(at(k)), { point: { ...edit.at }, passThrough: true }, stop(at(k + 1))],
        knownLegs: null,
        sectionStart: k,
        remapControl: shift,
        remapLeg: (old) => (old === k ? null : old > k ? old + 1 : old),
      };
    }

    case 'insertOnLine': {
      checkLeg(edit.leg);
      const k = edit.leg;
      const shape = legs[k];
      if (shape === undefined || shape.length < 2) {
        throw new EditRefused('That section has no line to add a point to.');
      }
      const j = Math.max(1, Math.min(shape.length - 1, edit.segmentEnd));
      const split = { lat: edit.at.lat, lon: edit.at.lon };
      next.splice(k + 1, 0, { point: split, role: 'shaping' });
      return {
        control: next,
        replace: { from: k, to: k + 1, count: 2 },
        section: null,
        knownLegs: [
          [...shape.slice(0, j).map(clonePoint), split],
          [split, ...shape.slice(j).map(clonePoint)],
        ],
        sectionStart: k,
        remapControl: shiftAfter(k + 1, 1),
        remapLeg: (old) => (old === k ? null : old > k ? old + 1 : old),
      };
    }

    case 'remove': {
      checkIndex(edit.index);
      const i = edit.index;
      if (n <= 2) {
        throw new EditRefused('A route needs at least two points. Delete the route instead.');
      }
      next.splice(i, 1);
      const removed = (old: number): number | null =>
        old === i ? null : old > i ? old - 1 : old;

      if (i === 0 || i === n - 1) {
        // The neighbour becomes the start or end, which is always a via point.
        const end = i === 0 ? 0 : next.length - 1;
        (next[end] as PlannedControl).role = 'via';
        const dropped = i === 0 ? 0 : n - 2;
        return {
          control: next,
          replace: { from: dropped, to: dropped + 1, count: 0 },
          section: null,
          knownLegs: [],
          sectionStart: end,
          remapControl: removed,
          remapLeg: (old) => (old === dropped ? null : i === 0 ? old - 1 : old),
        };
      }
      return {
        control: next,
        replace: { from: i - 1, to: i + 1, count: 1 },
        section: [stop(at(i - 1)), stop(at(i + 1))],
        knownLegs: null,
        sectionStart: i - 1,
        remapControl: removed,
        remapLeg: (old) => (old === i - 1 || old === i ? null : old > i ? old - 1 : old),
      };
    }

    case 'setRole': {
      checkIndex(edit.index);
      const i = edit.index;
      if (edit.role === 'shaping' && (i === 0 || i === n - 1)) {
        throw new EditRefused('The start and end of a route are always via points.');
      }
      (next[i] as PlannedControl).role = edit.role;
      return {
        control: next,
        replace: null,
        section: null,
        knownLegs: null,
        sectionStart: i,
        remapControl: identity,
        remapLeg: identity,
      };
    }

    case 'choose': {
      checkLeg(edit.leg);
      const k = edit.leg;
      if (edit.candidate.length < 2) {
        throw new EditRefused('That route has no geometry to use.');
      }
      const pieces = splitShapeAt(edit.candidate, edit.shaping);
      const added = edit.shaping.map((p) => ({
        point: { lat: p.lat, lon: p.lon },
        role: 'shaping' as const,
      }));
      next.splice(k + 1, 0, ...added);
      const count = added.length;
      return {
        control: next,
        replace: { from: k, to: k + 1, count: count + 1 },
        section: null,
        knownLegs: pieces,
        sectionStart: k,
        remapControl: shiftAfter(k + 1, count),
        remapLeg: (old) => (old === k ? null : old > k ? old + count : old),
      };
    }
  }
}

export interface RouteRecords {
  /** Control-point index pairs whose leg is a straight unmatched line. */
  unmatchedLegs: [number, number][];
  displaced: DisplacedControlPoint[];
}

/**
 * Carries a route's unmatched-leg and displaced-point records across an edit.
 *
 * Records about legs and points the edit did not touch move with them;
 * records about replaced legs and moved or removed points are dropped and
 * replaced by what routing the section found. `newLegsMatched` and
 * `sectionDisplaced` are the routing result, indexed from the start of the
 * replacement and of the section respectively. Requirement 8.6.
 */
export function remapRecords(
  plan: EditPlan,
  previous: RouteRecords,
  newLegsMatched: readonly boolean[],
  sectionDisplaced: readonly DisplacedControlPoint[],
): RouteRecords {
  const unmatched: [number, number][] = [];
  for (const [a] of previous.unmatchedLegs) {
    const leg = plan.remapLeg(a);
    if (leg !== null) unmatched.push([leg, leg + 1]);
  }
  if (plan.replace !== null) {
    for (const [offset, matched] of newLegsMatched.entries()) {
      if (!matched) {
        const leg = plan.replace.from + offset;
        unmatched.push([leg, leg + 1]);
      }
    }
  }

  const byIndex = new Map<number, number>();
  for (const entry of previous.displaced) {
    const index = plan.remapControl(entry.index);
    if (index !== null) byIndex.set(index, entry.displacementM);
  }
  for (const entry of sectionDisplaced) {
    const index = plan.sectionStart + entry.index;
    const seen = byIndex.get(index);
    if (seen === undefined || entry.displacementM > seen) byIndex.set(index, entry.displacementM);
  }

  return {
    unmatchedLegs: unmatched.toSorted((x, y) => x[0] - y[0]),
    displaced: [...byIndex.entries()]
      .map(([index, displacementM]) => ({ index, displacementM }))
      .toSorted((x, y) => x.index - y.index),
  };
}
