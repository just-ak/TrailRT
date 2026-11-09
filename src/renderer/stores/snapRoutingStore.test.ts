import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LatLon } from '@shared/geo/distance';
import { planEdit } from '@shared/routing/edit';
import type { Candidate, PreviewedLeg } from '@shared/routing/results';
import { DEFAULT_SETTINGS } from '@shared/domain/defaults';
import { ok } from '@shared/ipc/result';
import { routingCreateSnappedRequest } from '@shared/ipc/schemas';
import { draftLegShapes, useSnapRoutingStore } from './snapRoutingStore';
import { useRoutingStore } from './routingStore';
import { useSettingsStore } from './settingsStore';

/**
 * The snap routing tool's draft: Phase 6, task 11.
 *
 * The store is exercised directly, and the drain through the real actions
 * against a fake preload bridge — the part worth testing is the ordering and
 * staleness, which only shows up when replies are asynchronous.
 */

const A: LatLon = { lat: 53.2588, lon: -1.9115 };
const B: LatLon = { lat: 53.2533, lon: -1.9343 };
const C: LatLon = { lat: 53.2578, lon: -2.0327 };
const D: LatLon = { lat: 53.2602, lon: -2.1255 };
const X: LatLon = { lat: 53.29, lon: -1.96 };

const leg = (from: LatLon, to: LatLon, matched = true): PreviewedLeg => ({
  matched,
  shape: [from, { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 }, to],
  distanceM: 1000,
  displacementM: null,
});

const store = () => useSnapRoutingStore.getState();

/** A draft A–B–C–D with every leg routed. */
function routedDraft(): void {
  store().reset();
  for (const p of [A, B, C, D]) store().appendPoint(p);
  const generation = store().generation;
  store().acceptLeg(generation, 0, leg(A, B));
  store().acceptLeg(generation, 1, leg(B, C));
  store().acceptLeg(generation, 2, leg(C, D));
}

const plan = (edit: Parameters<typeof planEdit>[2]) => {
  const s = store();
  return planEdit(
    s.controlPoints.map((point, i) => ({ point, role: s.roles[i] ?? 'via' })),
    draftLegShapes(s.controlPoints, s.legs),
    edit,
  );
};

beforeEach(() => store().reset());

describe('the draft', () => {
  it('a middle move leaves exactly the two touched legs to route, and nextGap finds the first', () => {
    routedDraft();
    store().applyPlan(plan({ kind: 'move', index: 2, to: X }), null);

    expect(store().legs.map((l) => l === null)).toEqual([false, true, true]);
    expect(store().nextGap()).toEqual({ index: 1, from: B, to: X });
  });

  it('drops a reply from before an edit', () => {
    routedDraft();
    store().applyPlan(plan({ kind: 'move', index: 2, to: X }), null);
    const before = store().generation;
    store().applyPlan(plan({ kind: 'move', index: 2, to: C }), null);

    expect(store().acceptLeg(before, 1, leg(B, X))).toBe(false);
    expect(store().legs[1]).toBeNull();
  });

  it('refuses to fill a leg that is not waiting', () => {
    routedDraft();
    expect(store().acceptLeg(store().generation, 0, leg(A, X))).toBe(false);
  });

  it('a routed edit lands complete, with nothing left to route', () => {
    routedDraft();
    store().applyPlan(plan({ kind: 'insert', leg: 0, at: X }), [leg(A, X), leg(X, B)]);
    expect(store().roles).toEqual(['via', 'shaping', 'via', 'via', 'via']);
    expect(store().nextGap()).toBeNull();
  });

  const EDITS: [string, () => void][] = [
    ['append', () => store().appendPoint(X)],
    ['undoLastPoint', () => store().undoLastPoint()],
    ['move', () => store().applyPlan(plan({ kind: 'move', index: 1, to: X }), [leg(A, X), leg(X, C)])],
    ['insertOnLine', () => store().applyPlan(plan({ kind: 'insertOnLine', leg: 0, segmentEnd: 1, at: B }), null)],
    ['remove', () => store().applyPlan(plan({ kind: 'remove', index: 1 }), [leg(A, C)])],
    ['setRole', () => store().applyPlan(plan({ kind: 'setRole', index: 1, role: 'shaping' }), null)],
    [
      'choose',
      () =>
        store().applyPlan(
          plan({ kind: 'choose', leg: 1, candidate: [B, X, C], shaping: [{ lat: (B.lat + X.lat) / 2, lon: (B.lon + X.lon) / 2 }] }),
          null,
        ),
    ],
  ];

  it.each(EDITS)('⌘Z restores the draft exactly after %s', (_, edit) => {
    routedDraft();
    const before = { controlPoints: store().controlPoints, roles: store().roles, legs: store().legs };
    edit();
    expect(store().undo()).toBe(true);
    expect({ controlPoints: store().controlPoints, roles: store().roles, legs: store().legs }).toEqual(before);
  });

  it('Backspace keeps its Phase 4 meaning, and the new end is a via point', () => {
    routedDraft();
    store().applyPlan(plan({ kind: 'setRole', index: 2, role: 'shaping' }), null);
    store().undoLastPoint();
    expect(store().controlPoints).toEqual([A, B, C]);
    expect(store().roles).toEqual(['via', 'via', 'via']);
    expect(store().legs).toHaveLength(2);
  });

  it('selecting a candidate swaps the leg without routing', () => {
    store().appendPoint(A);
    store().appendPoint(D);
    const items: Candidate[] = [
      { ...leg(A, D), estimatedDurationS: 600 },
      { ...leg(A, X), shape: [A, X, D], estimatedDurationS: 700 },
    ];
    store().acceptCandidates(store().generation, 0, items);
    store().selectCandidate(1);
    expect(store().legs[0]?.shape[1]).toEqual(X);
    expect(store().candidates?.selected).toBe(1);
  });

  /*
   * The bug behind "Enter does not finish the route": the draft stored the
   * candidate object itself as the leg, duration estimate included, and the
   * strict leg schema refused the save as "not valid". Keeping route A — the
   * default — was enough to hit it. Checked against the real request schema,
   * because that is the boundary that refused it.
   */
  it('keeps legs the save request accepts, whichever candidate is chosen', () => {
    store().appendPoint(A);
    store().appendPoint(D);
    const items: Candidate[] = [
      { ...leg(A, D), estimatedDurationS: 600 },
      { ...leg(A, X), shape: [A, X, D], estimatedDurationS: 700 },
    ];
    store().acceptCandidates(store().generation, 0, items);

    const save = () =>
      routingCreateSnappedRequest.safeParse({
        tripId: '00000000-0000-4000-8000-000000000000',
        name: 'New Route',
        controlPoints: store().controlPoints,
        legs: store().legs,
        roles: store().roles,
      });

    expect(save().success, 'route A, the default').toBe(true);
    store().selectCandidate(1);
    expect(save().success, 'route B').toBe(true);
    expect(store().legs[0]).not.toHaveProperty('estimatedDurationS');
  });
});

// ------------------------------------------------------- the drain, end to end

type Reply<T> = { resolve: (value: T) => void };

/** A fake preload bridge whose routing replies are released by the test. */
function fakeBridge() {
  const legRequests: { from: LatLon; to: LatLon; reply: Reply<PreviewedLeg> }[] = [];
  const altRequests: { from: LatLon; to: LatLon; reply: Reply<Candidate[]> }[] = [];
  const bridge = {
    routing: {
      routeLeg: (req: { from: LatLon; to: LatLon }) =>
        new Promise((resolve) =>
          legRequests.push({ ...req, reply: { resolve: (v) => resolve(ok(v)) } }),
        ),
      alternatives: (req: { from: LatLon; to: LatLon }) =>
        new Promise((resolve) =>
          altRequests.push({ ...req, reply: { resolve: (v) => resolve(ok(v)) } }),
        ),
    },
  };
  return { bridge, legRequests, altRequests };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};

describe('drainSnapLegs', () => {
  let fake: ReturnType<typeof fakeBridge>;

  beforeEach(() => {
    fake = fakeBridge();
    (globalThis as unknown as { window: unknown }).window = { trailrt: fake.bridge };
    useRoutingStore.setState({
      status: {
        capabilities: { alternatives: true, passThrough: true },
      } as never,
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } } as never);
  });

  it('offers candidates for the newest leg', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, routeAlternatives: true } } as never);
    const actions = await import('../lib/actions');
    actions.appendSnapPoint(A);
    actions.appendSnapPoint(B);
    await flush();

    expect(fake.altRequests).toHaveLength(1);
    expect(fake.legRequests).toHaveLength(0);
    fake.altRequests[0]?.reply.resolve([
      { ...leg(A, B), estimatedDurationS: 60 },
      { ...leg(A, B), shape: [A, X, B], estimatedDurationS: 90 },
    ]);
    await flush();
    expect(store().candidates?.items).toHaveLength(2);
    expect(store().legs[0]?.shape).toEqual(leg(A, B).shape);
  });

  it('with the setting off, routes one plain leg per click exactly as Phase 4 did', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, routeAlternatives: false } } as never);
    const actions = await import('../lib/actions');
    actions.appendSnapPoint(A);
    actions.appendSnapPoint(B);
    actions.appendSnapPoint(C);
    await flush();

    // One request at a time, in order.
    expect(fake.legRequests.map((r) => r.to)).toEqual([B]);
    fake.legRequests[0]?.reply.resolve(leg(A, B));
    await flush();
    expect(fake.legRequests.map((r) => r.to)).toEqual([B, C]);
    fake.legRequests[1]?.reply.resolve(leg(B, C));
    await flush();

    expect(fake.altRequests).toHaveLength(0);
    expect(store().candidates).toBeNull();
    expect(store().nextGap()).toBeNull();
  });

  it('re-routes the two legs a middle move opened, in order', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, routeAlternatives: false } } as never);
    const actions = await import('../lib/actions');
    routedDraft();

    // A remote provider: the drag commits with no routed legs.
    await actions.applySnapDraftEdit({ kind: 'move', index: 2, to: X }, null);
    await flush();
    expect(fake.legRequests.map((r) => [r.from, r.to])).toEqual([[B, X]]);
    fake.legRequests[0]?.reply.resolve(leg(B, X));
    await flush();
    expect(fake.legRequests.map((r) => [r.from, r.to])).toEqual([
      [B, X],
      [X, D],
    ]);
    fake.legRequests[1]?.reply.resolve(leg(X, D));
    await flush();
    expect(store().nextGap()).toBeNull();
  });
});
