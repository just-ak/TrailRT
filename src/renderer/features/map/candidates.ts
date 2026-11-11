import type { UnitSystem } from '@shared/domain/types';
import { formatDistance, formatDuration } from '@shared/geo/units';
import type { RoutingCapabilities } from '@shared/routing/RoutingProvider';
import type { Candidate, RouteProvenance } from '@shared/routing/results';

/**
 * How a list of route candidates is described. Phase 6, Requirement 1.3.
 *
 * Pure so the figures can be tested without a map. Every duration says
 * "(est.)": it is the engine's estimate, never a measurement (ADR 0011 §8),
 * and a candidate list is exactly where a reader compares times as if they
 * were facts.
 */

export const CANDIDATE_LETTERS = ['A', 'B', 'C'] as const;

/** Colours for the candidates that are not selected, so each can be told apart. */
export const CANDIDATE_COLOURS = ['#2563eb', '#7c3aed', '#0891b2'] as const;

export interface CandidateSummary {
  letter: string;
  distance: string;
  duration: string;
  /** Difference from candidate A, or null for A itself. */
  delta: string | null;
  /** Short form for the label drawn on the map. */
  mapLabel: string;
}

function signed(value: string, negative: boolean): string {
  return `${negative ? '−' : '+'}${value}`;
}

function deltaDistance(metres: number, units: UnitSystem): string {
  return signed(formatDistance(Math.abs(metres), units), metres < 0);
}

function deltaDuration(seconds: number): string {
  return signed(formatDuration(Math.abs(seconds)), seconds < 0);
}

export function candidateSummaries(
  candidates: readonly Candidate[],
  units: UnitSystem,
): CandidateSummary[] {
  const first = candidates[0];
  return candidates.map((c, i) => {
    const letter = CANDIDATE_LETTERS[i] ?? String(i + 1);
    const duration =
      c.estimatedDurationS === null ? '—' : `${formatDuration(c.estimatedDurationS)} (est.)`;

    let delta: string | null = null;
    if (i > 0 && first !== undefined) {
      const parts: string[] = [];
      if (c.distanceM !== null && first.distanceM !== null) {
        parts.push(deltaDistance(c.distanceM - first.distanceM, units));
      }
      if (c.estimatedDurationS !== null && first.estimatedDurationS !== null) {
        parts.push(`${deltaDuration(c.estimatedDurationS - first.estimatedDurationS)} (est.)`);
      }
      delta = parts.length === 0 ? '—' : parts.join(' · ');
    }

    return {
      letter,
      distance: formatDistance(c.distanceM, units),
      duration,
      delta,
      mapLabel: delta === null ? `${letter} · ${formatDistance(c.distanceM, units)}` : `${letter} · ${delta}`,
    };
  });
}

/**
 * Whether "Show alternatives" can work for leg `leg` of a route, and if not,
 * why — the menu shows the reason rather than just greying out
 * (Requirement 2.5).
 */
export function legAlternativesAvailability(
  provenance: Pick<RouteProvenance, 'controlPoints' | 'unmatchedLegs'> | null,
  leg: number,
  capabilities: RoutingCapabilities | null,
): { available: true } | { available: false; reason: string } {
  if (provenance === null || provenance.controlPoints.length < 2) {
    return {
      available: false,
      reason: 'Only a route that follows the roads has alternatives. Snap it to roads first.',
    };
  }
  if (leg < 0 || leg >= provenance.controlPoints.length - 1) {
    return { available: false, reason: 'That section is no longer part of the route.' };
  }
  if (provenance.unmatchedLegs.some(([a]) => a === leg)) {
    return {
      available: false,
      reason: 'This section has no road route, so there are no alternatives to it.',
    };
  }
  if (capabilities?.alternatives !== true) {
    return {
      available: false,
      reason: 'The routing service in use cannot offer alternative routes.',
    };
  }
  return { available: true };
}
