import { describe, expect, it } from 'vitest';
import { companionView, type CompanionInput } from './companionView';

const TRIP = 't1';
const READY = { tripId: TRIP, answered: true, dated: true };
const input = (over: Partial<CompanionInput>): CompanionInput => ({ selected: null, section: 'trips', openTripId: null, editing: false, itinerary: READY, ...over });

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
      expect(companionView(input({ section: 'routes', selected: { kind, id: 'x' } }))).toEqual({ kind: 'object', ref: { kind, id: 'x' } });
    }
  });

  it('shows the year once back at the list, with the trip or something in it still selected', () => {
    expect(companionView(input({ selected: { kind: 'trip', id: TRIP } }))).toEqual({ kind: 'year' });
    expect(companionView(input({ selected: { kind: 'route', id: 'r' } }))).toEqual({ kind: 'year' });
    expect(companionView(input({ editing: true, selected: { kind: 'waypoint', id: 'w' } }))).toEqual({ kind: 'year' });
    expect(companionView(input({ selected: { kind: 'folder', id: 'f' } }))).toEqual({ kind: 'object', ref: { kind: 'folder', id: 'f' } });
  });

  it('shows the editor behind the pencil for whatever is selected, and nothing to edit with nothing selected', () => {
    expect(companionView(input({ editing: true, section: 'routes', selected: { kind: 'route', id: 'r' } }))).toEqual({ kind: 'edit', ref: { kind: 'route', id: 'r' } });
    expect(companionView(input({ editing: true, openTripId: TRIP, selected: { kind: 'trip', id: TRIP } }))).toEqual({ kind: 'edit', ref: { kind: 'trip', id: TRIP } });
    expect(companionView(input({ editing: true }))).toEqual({ kind: 'year' });
  });
});
