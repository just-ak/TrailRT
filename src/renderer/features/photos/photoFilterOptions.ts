import type { PhotoYears } from '@shared/domain/linkedFolders';

/**
 * The Year filter's choices (design §8.2): "All years", each year with
 * photos, newest first, and "No date" only when some photo has none.
 */
export function yearOptions(years: PhotoYears | null): { value: string; label: string }[] {
  const options = [{ value: '', label: 'All years' }];
  if (years === null) return options;
  for (const { year, count } of years.years) {
    options.push({ value: String(year), label: `${year} (${count.toLocaleString('en-GB')})` });
  }
  if (years.noDate > 0) options.push({ value: 'none', label: `No date (${years.noDate.toLocaleString('en-GB')})` });
  return options;
}
