import type { RoadClass } from './RoutingProvider';

/**
 * UK default speed limits, for roads where the map data posts none.
 *
 * ADR 0018 amends ADR 0011 §2 to allow this, on conditions: only in the UK,
 * only where the road's class is known, always labelled as **assumed**, and
 * switchable off. This module is the one place the rules live, so correcting
 * one is a one-line change here rather than a hunt through the services.
 *
 * ## Legal basis (cars and motorcycles)
 *
 * - **Motorways, 70 mph.** Motorways Traffic (Speed Limit) Regulations 1974.
 * - **National speed limit, 70 mph on a dual carriageway and 60 mph on a single
 *   carriageway.** The 70 mph, 60 mph and 50 mph (Temporary Speed Limit)
 *   (Continuation) Order 1978.
 * - **Restricted roads, 30 mph.** Road Traffic Regulation Act 1984, ss. 81–82:
 *   a road with street lighting no more than 183 metres apart is restricted to
 *   30 mph unless signed otherwise.
 *
 * ## Two judgement calls
 *
 * 1. **Residential and service roads are taken as restricted roads (30 mph).**
 *    The owner asked for the national speed limit for every unposted road, but
 *    a housing estate is street-lit and so 30 mph by statute; counting it at 60
 *    would be the larger error. Map data does not say whether a road is lit, so
 *    this is a rule of thumb by road type, which is why it is labelled assumed.
 * 2. **A one-way trunk or primary road is read as a dual carriageway.**
 *    OpenStreetMap draws each carriageway of a dual carriageway as a separate
 *    one-way way, so one-way is the signal available. A one-way A-road through
 *    a town centre is the case this gets wrong.
 *
 * What this cannot know: local limits that were never mapped (20 mph zones,
 * 40 mph and 50 mph stretches), lighting, and vehicle class. A posted limit in
 * the data always wins.
 */

export const MPH_TO_MPS = 1609.344 / 3600;

export type UkLimitBasis =
  | 'motorway'
  | 'nsl-dual'
  | 'nsl-single'
  | 'restricted-road';

export const UK_LIMIT_BASIS_LABELS: Record<UkLimitBasis, string> = {
  motorway: 'Motorway limit',
  'nsl-dual': 'National speed limit (dual carriageway)',
  'nsl-single': 'National speed limit (single carriageway)',
  'restricted-road': 'Restricted road (street-lit)',
};

export interface UkDefaultLimit {
  mph: number;
  mps: number;
  basis: UkLimitBasis;
}

function limit(mph: number, basis: UkLimitBasis): UkDefaultLimit {
  return { mph, mps: mph * MPH_TO_MPS, basis };
}

/**
 * The default limit for a road with no posted limit, or null when there is no
 * honest default — an unclassified edge type, or no class at all.
 *
 * `oneway` is null when the data did not say (attributes cached before one-way
 * was recorded); that is read as single carriageway, the lower of the two
 * national limits, rather than guessing the higher one.
 */
export function ukDefaultLimit(
  roadClass: RoadClass | null,
  oneway: boolean | null,
): UkDefaultLimit | null {
  switch (roadClass) {
    case 'motorway':
      return limit(70, 'motorway');
    case 'trunk':
    case 'primary':
      return oneway === true ? limit(70, 'nsl-dual') : limit(60, 'nsl-single');
    case 'secondary':
    case 'tertiary':
    case 'unclassified':
      return limit(60, 'nsl-single');
    case 'residential':
    case 'service_other':
      return limit(30, 'restricted-road');
    case null:
      return null;
    default:
      return null;
  }
}
