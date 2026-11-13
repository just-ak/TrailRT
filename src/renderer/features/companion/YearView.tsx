import { ChevronLeft, ChevronRight, Map as MapIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { TripOverview } from '@shared/domain/library';
import { formatDuration } from '@shared/geo/units';
import { daysInMonth, tripsOn, yearMarks } from '@shared/library/yearMarks';
import { distanceText, shortDay } from '@shared/library/tripGroups';
import { IconButton } from '../../components/IconButton';
import { useLibraryStore } from '../../stores/libraryStore';
import { useNavStore } from '../../stores/navStore';
import { today, tomorrow } from '../itinerary/viewModel';
import { Card, Note, SectionLabel } from './parts';

/**
 * The right panel with no trip open (Requirement 4.1, view 1): the year with
 * each trip's days marked, then what is planned for today and tomorrow.
 * Selecting a marked day or a card opens its trip.
 */

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function plural(n: number, one: string): string {
  return `${n.toLocaleString('en-GB')} ${one}${n === 1 ? '' : 's'}`;
}

/** `Buxton, leave 09:00 · 3 days`, and `97 km · 2 h 20 min driving · 27 photos`. */
function cardLines(trip: TripOverview): string[] {
  const first: string[] = [];
  if (trip.startPlace !== null && trip.startTime !== null) first.push(`${trip.startPlace}, leave ${trip.startTime}`);
  else if (trip.startTime !== null) first.push(`Leave ${trip.startTime}`);
  if (trip.days !== null) first.push(plural(trip.days, 'day'));
  else first.push('end not known yet');
  const second: string[] = [];
  if (trip.distanceM !== null) second.push(distanceText(trip.distanceM));
  if (trip.driveSeconds !== null && trip.driveSeconds > 0) second.push(`${formatDuration(trip.driveSeconds)} driving`);
  if (trip.counts.photos > 0) second.push(plural(trip.counts.photos, 'photo'));
  return [first.join(' · '), second.join(' · ')].filter((l) => l !== '');
}

function TripCard({ trip }: { trip: TripOverview }): ReactNode {
  const openTrip = useNavStore((s) => s.openTrip);
  const [first, second] = cardLines(trip);
  return (
    <button
      type="button"
      onClick={() => openTrip(trip.id)}
      className="mb-2 w-full rounded-xl bg-[var(--color-surface-sunken)] p-3 text-left hover:outline-1 hover:outline-[var(--color-border-subtle)]"
      aria-label={`Open ${trip.name}`}
    >
      <span className="flex items-center gap-2">
        <MapIcon size={16} aria-hidden="true" className="shrink-0 text-[var(--color-accent)]" />
        <span className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{trip.name}</span>
      </span>
      {first !== undefined && <span className="mt-0.5 block truncate pl-6 text-[12px] text-[var(--color-text-secondary)]">{first}</span>}
      {second !== undefined && <span className="block truncate pl-6 text-[12px] text-[var(--color-text-muted)]">{second}</span>}
    </button>
  );
}

function Planned({ label, date, trips }: { label: string; date: string; trips: readonly TripOverview[] }): ReactNode {
  const on = tripsOn(trips, date);
  return (
    <>
      <SectionLabel aside={shortDay(date)}>{label}</SectionLabel>
      {on.length === 0 ? (
        <p className="text-[12px] text-[var(--color-text-muted)]">Nothing planned.</p>
      ) : (
        on.map((trip) => <TripCard key={trip.id} trip={trip} />)
      )}
    </>
  );
}

export function YearView(): ReactNode {
  const overview = useLibraryStore((s) => s.overview);
  const openTrip = useNavStore((s) => s.openTrip);
  const now = today();
  const [year, setYear] = useState(Number(now.slice(0, 4)));
  const marks = useMemo(() => yearMarks(overview, year), [overview, year]);
  const names = useMemo(() => new Map(overview.map((t) => [t.id, t.name])), [overview]);
  const photos = marks.trips.reduce((sum, t) => sum + t.counts.photos, 0);

  return (
    <div data-testid="year-view">
      <div className="flex items-center gap-1">
        <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]" data-testid="year">
          {year}
        </h2>
        <IconButton variant="ghost" hint="The year before" onClick={() => setYear(year - 1)}>
          <ChevronLeft size={15} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" hint="The year after" onClick={() => setYear(year + 1)}>
          <ChevronRight size={15} aria-hidden="true" />
        </IconButton>
        <span className="ml-auto text-[12px] text-[var(--color-text-muted)]">
          {plural(marks.trips.length, 'trip')}
          {photos > 0 && ` · ${plural(photos, 'photo')}`}
        </span>
      </div>

      <div className="mt-3 grid gap-x-[2px] gap-y-[7px]" style={{ gridTemplateColumns: '14px repeat(31, minmax(0, 1fr))', gridAutoRows: '11px' }} role="grid" aria-label={`Trips in ${year}`}>
        {MONTH_LETTERS.map((letter, m) => {
          const days = daysInMonth(year, m + 1);
          return (
            <div key={MONTH_NAMES[m]} role="row" className="contents">
              <span role="rowheader" aria-label={MONTH_NAMES[m]} className="text-[10px] leading-[11px] text-[var(--color-text-muted)]">
                {letter}
              </span>
              {Array.from({ length: 31 }, (_, d) => {
                if (d >= days) return <span key={d} role="gridcell" aria-hidden="true" />;
                const date = `${year}-${String(m + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
                const trips = marks.days.get(date) ?? [];
                const first = trips[0];
                const ring = date === now ? 'outline-1 outline-offset-1 outline-[var(--color-text-primary)]' : '';
                if (first === undefined) {
                  return <span key={d} role="gridcell" className={`block h-full rounded-[2px] bg-[var(--color-surface-sunken)] ${ring}`} />;
                }
                const label = `${trips.map((id) => names.get(id) ?? '').join(', ')}, ${shortDay(date)}`;
                return (
                  <span key={d} role="gridcell" className="block h-full">
                    <button
                      type="button"
                      aria-label={label}
                      data-date={date}
                      onClick={() => openTrip(first)}
                      className={`block h-full w-full rounded-[2px] ${ring}`}
                      style={{ background: marks.colours.get(first) }}
                    />
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      <Planned label="Today" date={now} trips={overview} />
      <Planned label="Tomorrow" date={tomorrow()} trips={overview} />
      <Note>Selecting a trip opens it. Its days are drawn here by the hour.</Note>
      {overview.length > 0 && marks.trips.length === 0 && <Card><p className="text-[12px] text-[var(--color-text-muted)]">No trip has dates in {year}. Give a trip a start date to see it here.</p></Card>}
    </div>
  );
}
