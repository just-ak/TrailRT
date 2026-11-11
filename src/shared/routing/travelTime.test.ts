import { describe, expect, it } from 'vitest';
import { estimateDurationSeconds } from '../geo/units';
import { TRANSPORT_MODES } from './RoutingProvider';
import { SPEED_BASIS, TYPICAL_SPEED_KMH, travelSpeedKmh } from './travelTime';

describe('travelSpeedKmh', () => {
  it('times walking at the planning speed from Settings', () => {
    expect(travelSpeedKmh('pedestrian', 4.5)).toBe(4.5);
    expect(travelSpeedKmh('pedestrian', 6)).toBe(6);
  });

  it('ignores the walking speed for every other mode', () => {
    expect(travelSpeedKmh('auto', 4.5)).toBe(TYPICAL_SPEED_KMH.auto);
    expect(travelSpeedKmh('bicycle', 4.5)).toBe(TYPICAL_SPEED_KMH.bicycle);
    expect(travelSpeedKmh('motorcycle', 4.5)).toBe(TYPICAL_SPEED_KMH.motorcycle);
  });

  /*
   * The defect that prompted this module: the panel timed a 34-mile route at
   * 12 h 15 min whichever mode was selected, because every mode used the
   * walking speed.
   */
  it('gives a drive and a walk of the same route different durations', () => {
    const metres = 34.3 * 1609.344;
    const walk = estimateDurationSeconds(metres, travelSpeedKmh('pedestrian', 4.5));
    const drive = estimateDurationSeconds(metres, travelSpeedKmh('auto', 4.5));

    expect(walk).not.toBeNull();
    expect(drive).not.toBeNull();
    // About 12 h on foot, about an hour by car.
    expect((walk ?? 0) / 3600).toBeCloseTo(12.27, 1);
    expect((drive ?? 0) / 3600).toBeCloseTo(1.0, 1);
  });

  it('orders the modes as a reader would expect', () => {
    expect(TYPICAL_SPEED_KMH.bicycle).toBeGreaterThan(4.5);
    expect(TYPICAL_SPEED_KMH.auto).toBeGreaterThan(TYPICAL_SPEED_KMH.bicycle);
  });

  it('can say where every mode’s speed came from', () => {
    for (const mode of TRANSPORT_MODES) {
      expect(SPEED_BASIS[mode].length).toBeGreaterThan(0);
    }
  });
});
