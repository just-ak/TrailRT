/**
 * A folder's photos as a grid under the Photos section's list (Phase 14
 * Requirement 27, design §5.19): a heading per day taken, then rows of cells.
 *
 * Pure, so the layout and the windowing are tested without a window. Every
 * row has a known height and offset, so only the rows that meet the viewport
 * are drawn, which keeps a folder of 40,000 photos as cheap as one of 30
 * (Requirement 7.3).
 */

/** What the grid needs of a photo. */
export interface GridPhoto {
  id: string;
  takenLocal: string | null;
}

export type GridRow<P extends GridPhoto> =
  | { kind: 'day'; key: string; label: string; count: number; top: number; height: number }
  | { kind: 'cells'; key: string; photos: P[]; top: number; height: number };

export interface GridLayout<P extends GridPhoto> {
  rows: GridRow<P>[];
  height: number;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 16 May 2026" for 2026-05-16, the wall-clock day a photo was taken. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = (new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7;
  return `${DAY_NAMES[weekday] ?? ''} ${d ?? ''} ${MONTHS[(m ?? 1) - 1] ?? ''} ${y ?? ''}`;
}

/**
 * Groups photos by the day they were taken, in the order given, which from
 * `photos:list` is taken time with undated photos last. Undated photos form
 * their own "No date" group wherever they fall.
 */
export function photosByDay<P extends GridPhoto>(photos: readonly P[]): { key: string; label: string; photos: P[] }[] {
  const groups = new Map<string, P[]>();
  for (const photo of photos) {
    const key = photo.takenLocal?.slice(0, 10) ?? 'none';
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [photo]);
    else list.push(photo);
  }
  const days = [...groups.entries()].map(([key, list]) => ({ key, label: key === 'none' ? 'No date' : dayLabel(key), photos: list }));
  // Undated last, whatever order they arrived in.
  return [...days.filter((d) => d.key !== 'none'), ...days.filter((d) => d.key === 'none')];
}

/** Lays the days out as headings and rows of `columns` cells, each `rowHeight` tall. */
export function layoutPhotoGrid<P extends GridPhoto>(
  photos: readonly P[],
  options: { columns: number; rowHeight: number; headingHeight: number },
): GridLayout<P> {
  const columns = Math.max(1, Math.floor(options.columns));
  const rows: GridRow<P>[] = [];
  let top = 0;
  for (const day of photosByDay(photos)) {
    rows.push({ kind: 'day', key: `day:${day.key}`, label: day.label, count: day.photos.length, top, height: options.headingHeight });
    top += options.headingHeight;
    for (let i = 0; i < day.photos.length; i += columns) {
      rows.push({ kind: 'cells', key: `cells:${day.key}:${i}`, photos: day.photos.slice(i, i + columns), top, height: options.rowHeight });
      top += options.rowHeight;
    }
  }
  return { rows, height: top };
}

/**
 * The rows that meet the viewport, widened by `overscan` pixels either side
 * so a slow scroll never shows a gap. Found by binary search over the
 * offsets, so the cost does not grow with the folder.
 */
export function rowsInView<P extends GridPhoto>(
  rows: readonly GridRow<P>[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 0,
): GridRow<P>[] {
  const from = scrollTop - overscan;
  const to = scrollTop + viewportHeight + overscan;
  // The first row whose bottom is below the top of the window.
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const row = rows[mid];
    if (row !== undefined && row.top + row.height <= from) lo = mid + 1;
    else hi = mid;
  }
  const visible: GridRow<P>[] = [];
  for (let i = lo; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined || row.top >= to) break;
    visible.push(row);
  }
  return visible;
}
