import type { TransportMode } from './RoutingProvider';

/**
 * The average speed a duration estimate is worked out at, per transport mode.
 *
 * ## Why a flat average and not the road data
 *
 * The transport mode used to sit next to an estimate that ignored it. Every
 * mode was timed at the walking planning speed, so a 34-mile drive came out at
 * twelve hours. These averages fix that.
 *
 * Posted limits would look more precise, but a limit is a ceiling, not a
 * speed. Timing a drive at the limits gives a figure no driver achieves,
 * because it leaves out junctions, bends and traffic. The engine's own travel
 * time would be better still, but it is not kept with a saved route. ADR 0011
 * §8 keeps engine durations labelled as estimates and out of stored data. A
 * stated average is less clever, but nobody will mistake it for a measurement.
 *
 * Car and motorcycle share one figure on purpose. The roads and limits are the
 * same, and a motorcycle-specific number would be invented to make the
 * selector look as if it did more than it does.
 *
 * Walking uses the planning speed from Settings, which predates this module and
 * stays the user's to change.
 */
export const TYPICAL_SPEED_KMH: Readonly<
  Record<Exclude<TransportMode, 'pedestrian'>, number>
> = {
  auto: 55,
  motorcycle: 55,
  bicycle: 16,
};

/** Short description of where the speed came from, for the estimate's caption. */
export const SPEED_BASIS: Readonly<Record<TransportMode, string>> = {
  auto: 'a typical average by car on mixed roads',
  motorcycle: 'a typical average by motorcycle on mixed roads',
  bicycle: 'a typical cycling average',
  pedestrian: 'your walking speed from Settings',
};

/** The speed, in km/h, that a route is timed at for this mode. */
export function travelSpeedKmh(
  mode: TransportMode,
  walkingSpeedKmh: number,
): number {
  return mode === 'pedestrian' ? walkingSpeedKmh : TYPICAL_SPEED_KMH[mode];
}
