import { describe, expect, it } from 'vitest';
import { companionView, type CompanionInput } from './companionView';

const TRIP = 't1';
const READY = { tripId: TRIP, answered: true, dated: true };
const input = (over: Partial<CompanionInput>): CompanionInput => ({ selected: null, openTripId: null, editing: false, editingRef: null, plan: null, itinerary: READY, ...over });

describe('which view the right panel shows', () => {
  it('shows the year with no trip open', () => {
    expect(companionView(input({}))).toEqual({ kind: 'year' });
  });

  it('shows an open trip by the hour, whether it is selected or nothing is', () => {
    expect(companionView(input({ openTripId: TRIP, selected: { kind: 'trip', id: TRIP } }))).toEqual({ kind: 'trip', tripId: TRIP });
    expect(companionView(input({ openTripId: TRIP }))).toEqual({ kind: 'trip', tripId: TRIP });
  });

  it('asks when an undated trip is, and guesses nothing while its plan loads', () => {
    const open = { openTripId: TRIP, selected: { kind: 'trip' as const, id: TRIP } };
    expect(companionView(input({ ...open, itinerary: { tripId: TRIP, answered: true, dated: false } }))).toEqual({ kind: 'undated', tripId: TRIP });
    expect(companionView(input({ ...open, itinerary: { tripId: TRIP, answered: false, dated: false } }))).toEqual({ kind: 'loading', tripId: TRIP });
    expect(companionView(input({ ...open, itinerary: { tripId: 'other', answered: true, dated: true } }))).toEqual({ kind: 'loading', tripId: TRIP });
  });

  it('shows the selected object’s card, inside a trip or outside one', () => {
    for (const kind of ['route', 'track', 'waypoint', 'folder', 'linkedFolder'] as const) {
      expect(companionView(input({ openTripId: TRIP, selected: { kind, id: 'x' } }))).toEqual({ kind: 'object', ref: { kind, id: 'x' } });
      expect(companionView(input({ selected: { kind, id: 'x' } }))).toEqual({ kind: 'object', ref: { kind, id: 'x' } });
    }
  });

  it('shows a trip selected in the list by the hour without opening it', () => {
    expect(companionView(input({ selected: { kind: 'trip', id: TRIP } }))).toEqual({ kind: 'trip', tripId: TRIP });
    expect(companionView(input({ selected: { kind: 'trip', id: TRIP }, openTripId: 'other' }))).toEqual({ kind: 'trip', tripId: TRIP });
    expect(companionView(input({ selected: { kind: 'trip', id: TRIP }, itinerary: { tripId: TRIP, answered: true, dated: false } }))).toEqual({ kind: 'undated', tripId: TRIP });
  });

  it('shows an object inside a trip opened in place in the list, with no trip open', () => {
    expect(companionView(input({ selected: { kind: 'route', id: 'r' } }))).toEqual({ kind: 'object', ref: { kind: 'route', id: 'r' } });
  });

  it('shows the editor behind the pencil for an object, and nothing to edit with nothing selected', () => {
    expect(companionView(input({ editing: true, selected: { kind: 'route', id: 'r' } }))).toEqual({ kind: 'edit', ref: { kind: 'route', id: 'r' } });
    expect(companionView(input({ editing: true }))).toEqual({ kind: 'year' });
  });

  it('shows a trip’s details, not its editor, unless the editor was opened for that trip', () => {
    const trip = { kind: 'trip' as const, id: TRIP };
    expect(companionView(input({ editing: true, editingRef: { kind: 'route', id: 'r' }, selected: trip }))).toEqual({ kind: 'trip', tripId: TRIP });
    expect(companionView(input({ editing: true, editingRef: trip, selected: trip }))).toEqual({ kind: 'edit', ref: trip });
  });

  it('shows a stop for a waypoint in the plan, and a drive for a route that is a leg', () => {
    const plan = { stops: [{ id: 's1', waypointId: 'w1', legRouteId: null, legMode: 'road' }, { id: 's2', waypointId: 'w2', legRouteId: 'r1', legMode: 'route' }] };
    const w1 = { kind: 'waypoint' as const, id: 'w1' };
    expect(companionView(input({ plan, selected: w1 }))).toEqual({ kind: 'stop', ref: w1, stopId: 's1' });
    expect(companionView(input({ plan, selected: { kind: 'route', id: 'r1' } }))).toEqual({ kind: 'drive', ref: { kind: 'route', id: 'r1' }, stopId: 's2' });
    // Not in the plan: the ordinary card.
    expect(companionView(input({ plan, selected: { kind: 'waypoint', id: 'w9' } }))).toEqual({ kind: 'object', ref: { kind: 'waypoint', id: 'w9' } });
    // The editor left on from another object does not cover a stop; opened for it, it does.
    expect(companionView(input({ plan, editing: true, editingRef: { kind: 'route', id: 'x' }, selected: w1 }))).toEqual({ kind: 'stop', ref: w1, stopId: 's1' });
    expect(companionView(input({ plan, editing: true, editingRef: w1, selected: w1 }))).toEqual({ kind: 'edit', ref: w1 });
  });

  it('shows what adding a highlighted result would do, and a drive with no route from the plan', () => {
    const plan = { stops: [{ id: 's1', waypointId: 'w1', legRouteId: null, legMode: 'road' }, { id: 's2', waypointId: 'w2', legRouteId: null, legMode: 'road' }] };
    expect(companionView(input({ plan, candidate: true, selected: { kind: 'waypoint', id: 'w1' } }))).toEqual({ kind: 'candidate' });
    expect(companionView(input({ plan, focusedLeg: 's2' }))).toEqual({ kind: 'drive', ref: null, stopId: 's2' });
    expect(companionView(input({ plan, focusedLeg: 'gone' }))).toEqual({ kind: 'year' });
  });
});
