import { describe, expect, it } from 'vitest';
import {
  isControlRole,
  NO_ROUTING_CAPABILITIES,
  providerCapabilities,
  type RoutingProvider,
} from './RoutingProvider';

/**
 * A provider with only the two required methods.
 *
 * The point of the test is that this still type-checks as a `RoutingProvider`:
 * Phase 6's methods are optional, so a second provider remains an adapter
 * rather than a refactor (ADR 0017, Requirement 10.1).
 */
const minimal: RoutingProvider = {
  id: 'minimal',
  name: 'Minimal',
  origins: [],
  attribution: '',
  snap: () =>
    Promise.resolve({
      provider: 'minimal',
      mode: 'auto',
      legs: [],
      unmatchedLegs: [],
      displaced: [],
    }),
  match: () =>
    Promise.resolve({
      provider: 'minimal',
      mode: 'auto',
      shape: [],
      edges: [],
      unmatchedPointCount: 0,
    }),
};

describe('providerCapabilities', () => {
  it('reports nothing for a provider with only snap and match', () => {
    expect(providerCapabilities(minimal)).toEqual(NO_ROUTING_CAPABILITIES);
  });

  it('reports each capability from the presence of its method', () => {
    expect(
      providerCapabilities({
        ...minimal,
        alternatives: () => Promise.resolve([]),
      }),
    ).toEqual({ alternatives: true, passThrough: false });

    expect(
      providerCapabilities({
        ...minimal,
        snapSection: () => minimal.snap([], 'auto'),
      }),
    ).toEqual({ alternatives: false, passThrough: true });
  });
});

describe('isControlRole', () => {
  it('accepts the two roles and nothing else', () => {
    expect(isControlRole('via')).toBe(true);
    expect(isControlRole('shaping')).toBe(true);
    expect(isControlRole('stop')).toBe(false);
    expect(isControlRole(null)).toBe(false);
  });
});
