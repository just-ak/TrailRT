import { useEffect, type ReactNode } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { usePhotoStore } from '../../stores/photoStore';
import { yearOptions } from './photoFilterOptions';

/**
 * The Photos view's Year and Trip filters (design §8.2, Requirement 4.6),
 * shown under the view's row while it is open. Both narrow the folder list,
 * and in task 10 the all-trips map with it.
 */
export function PhotoViewFilters({ depth }: { depth: number }): ReactNode {
  const filter = useLibraryStore((s) => s.photoFilter);
  const setPhotoFilter = useLibraryStore((s) => s.setPhotoFilter);
  const showArchived = useLibraryStore((s) => s.showArchived);
  const years = usePhotoStore((s) => s.years);
  const trips = usePhotoStore((s) => s.tripsWithPhotos);

  // Loaded when shown; the library store reloads them with the tree while the
  // view is open, so a scan that adds a year shows it.
  useEffect(() => {
    void usePhotoStore.getState().loadFilterOptions(showArchived);
  }, [showArchived]);

  const select =
    'min-w-0 flex-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-1 py-0.5 text-[11px] text-[var(--color-text-primary)]';

  return (
    <div
      className="flex items-center gap-1.5 py-1 pr-2"
      style={{ paddingLeft: (depth + 1) * 14 + 6 }}
      data-testid="photo-view-filters"
    >
      <select
        aria-label="Year"
        className={select}
        value={filter.year === undefined ? '' : String(filter.year)}
        onChange={(event) => {
          const value = event.target.value;
          const { year: _year, ...rest } = filter;
          setPhotoFilter(value === '' ? rest : { ...rest, year: value === 'none' ? 'none' : Number(value) });
        }}
      >
        {yearOptions(years).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Trip"
        className={select}
        value={filter.tripId ?? ''}
        onChange={(event) => {
          const value = event.target.value;
          const { tripId: _tripId, ...rest } = filter;
          setPhotoFilter(value === '' ? rest : { ...rest, tripId: value });
        }}
      >
        <option value="">All trips</option>
        {trips.map((trip) => (
          <option key={trip.id} value={trip.id}>
            {trip.name}
          </option>
        ))}
      </select>
    </div>
  );
}
