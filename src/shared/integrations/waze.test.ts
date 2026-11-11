import { describe, expect, it } from 'vitest';
import { wazeNavigateUrl, wazeTargetsFor } from './waze';

describe('wazeNavigateUrl', () => {
  it('builds an https link with the encoded coordinate pair', () => {
    const url = wazeNavigateUrl({ lat: 46.5, lon: 8.25 });

    // https only, and on the host the main process allowlists.
    expect(url.startsWith('https://www.waze.com/ul?')).toBe(true);
    expect(url).toContain('ll=46.500000%2C8.250000');
    expect(url).toContain('navigate=yes');
  });

  it('rounds to six decimals rather than printing a full double', () => {
    const url = wazeNavigateUrl({ lat: 46.123456789, lon: -8.987654321 });

    expect(url).toContain('ll=46.123457%2C-8.987654');
  });

  it('survives URL parsing, so the main process check can validate it', () => {
    const parsed = new URL(wazeNavigateUrl({ lat: -33.9, lon: 151.2 }));

    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('www.waze.com');
    expect(parsed.searchParams.get('ll')).toBe('-33.900000,151.200000');
  });
});

describe('wazeTargetsFor', () => {
  it('hands off a waypoint at its own position', () => {
    const targets = wazeTargetsFor({
      kind: 'waypoint',
      name: 'Trailhead',
      point: { lat: 46.5, lon: 8 },
    });

    expect(targets).toEqual([
      { label: 'Trailhead', point: { lat: 46.5, lon: 8 } },
    ]);
  });

  it('offers the start and the end of a route, each labelled', () => {
    const targets = wazeTargetsFor({
      kind: 'route',
      name: 'Alpine loop',
      points: [
        { lat: 46.5, lon: 8 },
        { lat: 46.6, lon: 8.1 },
        { lat: 46.7, lon: 8.2 },
      ],
    });

    // Two separate single-point hand-offs, never the intermediate points:
    // Waze takes one destination.
    expect(targets).toEqual([
      { label: 'Start', point: { lat: 46.5, lon: 8 } },
      { label: 'End', point: { lat: 46.7, lon: 8.2 } },
    ]);
  });

  it('does the same for a track', () => {
    const targets = wazeTargetsFor({
      kind: 'track',
      name: 'Morning ride',
      points: [
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ],
    });

    expect(targets.map((t) => t.point)).toEqual([
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
    ]);
  });

  it('copies coordinates only, dropping any other point fields', () => {
    const [start] = wazeTargetsFor({
      kind: 'route',
      name: 'With elevation',
      points: [{ lat: 1, lon: 2, ele: 300 } as { lat: number; lon: number }],
    });

    expect(start?.point).toEqual({ lat: 1, lon: 2 });
  });

  it('returns nothing for an empty geometry so the control can be disabled', () => {
    expect(wazeTargetsFor({ kind: 'route', name: 'Empty', points: [] })).toEqual(
      [],
    );
  });
});
