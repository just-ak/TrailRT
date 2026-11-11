import { describe, expect, it } from 'vitest';
import { drawerAfterSelection } from './drawerTarget';

const A = { ownerType: 'route' as const, ownerId: 'a' };

describe('drawerAfterSelection', () => {
  it('retargets an open drawer to the newly selected route', () => {
    expect(
      drawerAfterSelection({ profile: A, pointTable: null }, { kind: 'route', id: 'b' }),
    ).toEqual({
      profile: { ownerType: 'route', ownerId: 'b' },
      pointTable: null,
      highlightedPoints: [],
    });
  });

  it('keeps the point list open across the change, for the new geometry', () => {
    const next = drawerAfterSelection(
      { profile: A, pointTable: A },
      { kind: 'track', id: 't' },
    );
    expect(next?.profile).toEqual({ ownerType: 'track', ownerId: 't' });
    expect(next?.pointTable).toEqual({ ownerType: 'track', ownerId: 't' });
    // Indices from route A mean nothing on track t.
    expect(next?.highlightedPoints).toEqual([]);
  });

  it('changes nothing when the same geometry is selected again', () => {
    expect(
      drawerAfterSelection({ profile: A, pointTable: A }, { kind: 'route', id: 'a' }),
    ).toBeNull();
  });

  it('does not treat a track with a route’s id as the same geometry', () => {
    expect(
      drawerAfterSelection({ profile: A, pointTable: null }, { kind: 'track', id: 'a' })
        ?.profile,
    ).toEqual({ ownerType: 'track', ownerId: 'a' });
  });

  it.each(['trip', 'folder', 'waypoint'])(
    'closes the drawer when a %s is selected',
    (kind) => {
      expect(
        drawerAfterSelection({ profile: A, pointTable: A }, { kind, id: 'x' }),
      ).toEqual({ profile: null, pointTable: null, highlightedPoints: [] });
    },
  );

  it('closes the drawer when the selection is cleared', () => {
    expect(drawerAfterSelection({ profile: A, pointTable: null }, null)?.profile).toBeNull();
  });

  it('never opens a closed drawer', () => {
    expect(
      drawerAfterSelection({ profile: null, pointTable: null }, { kind: 'route', id: 'b' }),
    ).toBeNull();
  });
});
