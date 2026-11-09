import { describe, expect, it } from 'vitest';
import { ROAD_CLASSES } from './RoutingProvider';
import { MPH_TO_MPS, ukDefaultLimit } from './ukSpeedLimits';

describe('ukDefaultLimit', () => {
  it.each([
    ['motorway', false, 70, 'motorway'],
    ['motorway', true, 70, 'motorway'],
    ['trunk', true, 70, 'nsl-dual'],
    ['primary', true, 70, 'nsl-dual'],
    ['trunk', false, 60, 'nsl-single'],
    ['primary', false, 60, 'nsl-single'],
    ['secondary', true, 60, 'nsl-single'],
    ['tertiary', false, 60, 'nsl-single'],
    ['unclassified', false, 60, 'nsl-single'],
    ['residential', false, 30, 'restricted-road'],
    ['service_other', false, 30, 'restricted-road'],
  ] as const)('%s, one-way %s → %d mph (%s)', (roadClass, oneway, mph, basis) => {
    const limit = ukDefaultLimit(roadClass, oneway);
    expect(limit?.mph).toBe(mph);
    expect(limit?.basis).toBe(basis);
    expect(limit?.mps).toBeCloseTo(mph * MPH_TO_MPS, 9);
  });

  it('reads unknown one-way on a main road as single carriageway, the lower limit', () => {
    expect(ukDefaultLimit('trunk', null)?.mph).toBe(60);
  });

  it('has no default for a road with no class', () => {
    expect(ukDefaultLimit(null, false)).toBeNull();
  });

  it('covers every road class the providers report', () => {
    // A new class added to the vocabulary must get a deliberate rule here.
    for (const roadClass of ROAD_CLASSES) {
      expect(ukDefaultLimit(roadClass, false), roadClass).not.toBeNull();
    }
  });
});
