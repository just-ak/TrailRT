import type { ItineraryView } from '@shared/domain/itinerary';
import { formatDuration } from '@shared/geo/units';
import { formatStopDuration } from '@shared/itinerary/format';
import type { IcsInput, IcsLeg, IcsStop } from './write';

/**
 * An itinerary as calendar events. Phase 10 Requirement 10.1.
 *
 * Every time comes from the timeline, so the calendar says exactly what the
 * app says. A drive's duration is called an estimate, as it is everywhere
 * else (ADR 0011 §8).
 */
export function icsFromItinerary(
  view: ItineraryView,
  tripName: string,
  options: { includeLegs: boolean; now: number },
): IcsInput {
  const { timeline } = view;
  const stops: IcsStop[] = view.stops.map((stop, index) => {
    const timed = timeline.stops[index];
    const isFirst = index === 0;
    const isLast = index === view.stops.length - 1;
    const lines: string[] = [];
    if (!isFirst && !isLast) lines.push(`Stay: ${formatStopDuration(stop)}`);
    if (stop.notes !== null && stop.notes.length > 0) lines.push(stop.notes);
    if (timed !== undefined && !timed.zoneKnown) lines.push('Time zone not known for this place; times are in UTC.');
    return {
      id: stop.id,
      name: stop.place?.name ?? 'Stop (place deleted)',
      lat: stop.place?.lat ?? null,
      lon: stop.place?.lon ?? null,
      arrival: timed?.arrival ?? null,
      departure: timed?.departure ?? null,
      zone: timed?.zone ?? timeline.calendarZone,
      zoneKnown: timed?.zoneKnown ?? false,
      description: lines.join('\n'),
    };
  });

  const legs: IcsLeg[] = [];
  if (options.includeLegs) {
    for (const [index, stop] of view.stops.entries()) {
      if (index === 0) continue;
      const previous = view.stops[index - 1];
      const timed = timeline.stops[index];
      const before = timeline.stops[index - 1];
      const from = previous?.place?.name ?? 'previous stop';
      const to = stop.place?.name ?? 'next stop';
      const km = timed?.legDistanceM === null || timed?.legDistanceM === undefined ? null : timed.legDistanceM / 1000;
      const parts: string[] = [];
      if (km !== null) parts.push(`${km.toFixed(km < 10 ? 1 : 0)} km`);
      if (timed?.legDriveSeconds !== null && timed?.legDriveSeconds !== undefined) {
        parts.push(`about ${formatDuration(timed.legDriveSeconds)} (estimate at ${timed.legSpeedKmh ?? '?'} km/h)`);
      }
      legs.push({
        id: `leg-${stop.id}`,
        summary: `Drive: ${from} → ${to}`,
        departure: before?.departure ?? null,
        arrival: timed?.arrival ?? null,
        zone: before?.zone ?? timeline.calendarZone,
        zoneKnown: before?.zoneKnown ?? false,
        description: parts.join(', '),
      });
    }
  }

  return { calendarName: tripName, stops, legs, now: options.now };
}
