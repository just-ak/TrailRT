import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import type {
  FolderFileFormat,
  Photo,
  PhotoMapPoints,
  PhotoMapScope,
  PhotoMetadata,
  PhotoState,
} from '@shared/domain/linkedFolders';
import type { Db } from '../client';
import { folderFiles, linkedFolders, photoMetadata } from '../schema';

/**
 * Storage for what was read from each photo. Phase 11, design §2, §8 and §9.
 *
 * A cache: every row is rebuilt from its file by a rescan.
 */

export function upsertPhotoMetadata(db: Db, fileId: string, values: PhotoMetadata): void {
  db.insert(photoMetadata)
    .values({ fileId, ...values })
    .onConflictDoUpdate({ target: photoMetadata.fileId, set: values })
    .run();
}

type JoinedRow = {
  folder_files: typeof folderFiles.$inferSelect;
  photo_metadata: typeof photoMetadata.$inferSelect;
};

function rowToPhoto({ folder_files: file, photo_metadata: meta }: JoinedRow): Photo {
  return {
    id: file.id,
    folderId: file.folderId,
    relativePath: file.relativePath,
    kind: 'photo',
    format: file.format as FolderFileFormat,
    sizeBytes: file.sizeBytes,
    mtimeMs: file.mtimeMs,
    fingerprint: file.fingerprint ?? null,
    state: meta.state as PhotoState,
    reason: meta.reason ?? null,
    lat: meta.lat ?? null,
    lon: meta.lon ?? null,
    altitudeM: meta.altitudeM ?? null,
    accuracyM: meta.accuracyM ?? null,
    directionDeg: meta.directionDeg ?? null,
    directionRef: (meta.directionRef ?? null) as Photo['directionRef'],
    takenLocal: meta.takenLocal ?? null,
    takenOffsetMin: meta.takenOffsetMin ?? null,
    orientation: meta.orientation ?? null,
  };
}

export function findPhoto(db: Db, fileId: string): Photo | null {
  const row = db
    .select()
    .from(folderFiles)
    .innerJoin(photoMetadata, eq(photoMetadata.fileId, folderFiles.id))
    .where(eq(folderFiles.id, fileId))
    .get();
  return row === undefined ? null : rowToPhoto(row);
}

/**
 * A folder's photos in taken-time order (design §3.4). The time sorts as
 * text, which is right within one camera's clock. Photos with no taken time
 * come last, by path.
 */
export function listPhotos(db: Db, folderId: string): Photo[] {
  return db
    .select()
    .from(folderFiles)
    .innerJoin(photoMetadata, eq(photoMetadata.fileId, folderFiles.id))
    .where(and(eq(folderFiles.folderId, folderId), eq(folderFiles.kind, 'photo')))
    .orderBy(sql`${photoMetadata.takenLocal} is null`, asc(photoMetadata.takenLocal), asc(folderFiles.relativePath))
    .all()
    .map(rowToPhoto);
}

/**
 * Every photo of every folder linked to a trip, in taken-time order, undated
 * last (Phase 14 design §3.2). For the trip's Photos tab, its day cards and
 * the hour scale's photo times.
 */
export function listPhotosForTrip(db: Db, tripId: string): Photo[] {
  return db
    .select()
    .from(folderFiles)
    .innerJoin(photoMetadata, eq(photoMetadata.fileId, folderFiles.id))
    .innerJoin(linkedFolders, eq(linkedFolders.id, folderFiles.folderId))
    .where(and(eq(linkedFolders.tripId, tripId), eq(folderFiles.kind, 'photo')))
    .orderBy(sql`${photoMetadata.takenLocal} is null`, asc(photoMetadata.takenLocal), asc(folderFiles.relativePath))
    .all()
    .map((row) => rowToPhoto({ folder_files: row.folder_files, photo_metadata: row.photo_metadata }));
}

/** Photos per trip, in one query, for the trip list (Phase 14 design §3.2). */
export function photoCountsByTrip(db: Db): Map<string, number> {
  const rows = db.all<{ trip_id: string; n: number }>(sql`
    select lf.trip_id, count(*) as n
    from photo_metadata pm
    join folder_files ff on ff.id = pm.file_id
    join linked_folders lf on lf.id = ff.folder_id
    group by lf.trip_id`);
  return new Map(rows.map((r) => [r.trip_id, r.n]));
}

export function countsByState(db: Db, folderId: string): Record<PhotoState, number> {
  const counts: Record<PhotoState, number> = { located: 0, unlocated: 0, unreadable: 0, 'not-downloaded': 0 };
  const rows = db
    .select({ state: photoMetadata.state, n: sql<number>`count(*)` })
    .from(photoMetadata)
    .innerJoin(folderFiles, eq(folderFiles.id, photoMetadata.fileId))
    .where(eq(folderFiles.folderId, folderId))
    .groupBy(photoMetadata.state)
    .all();
  for (const row of rows) counts[row.state as PhotoState] = row.n;
  return counts;
}

const noCounts = (): Record<PhotoState, number> => ({ located: 0, unlocated: 0, unreadable: 0, 'not-downloaded': 0 });

/** Photos by state for every folder, in one query, for the library tree. */
export function countsByFolder(db: Db): Map<string, Record<PhotoState, number>> {
  const rows = db
    .select({ folderId: folderFiles.folderId, state: photoMetadata.state, n: sql<number>`count(*)` })
    .from(photoMetadata)
    .innerJoin(folderFiles, eq(folderFiles.id, photoMetadata.fileId))
    .groupBy(folderFiles.folderId, photoMetadata.state)
    .all();
  const byFolder = new Map<string, Record<PhotoState, number>>();
  for (const row of rows) {
    let counts = byFolder.get(row.folderId);
    if (counts === undefined) {
      counts = noCounts();
      byFolder.set(row.folderId, counts);
    }
    counts[row.state as PhotoState] = row.n;
  }
  return byFolder;
}

/**
 * The folders holding any photo taken in `year`, or with no date for
 * `'none'`, for the Photos view's Year filter (design §8.2). The year is the
 * year of the wall clock where the photo was taken.
 */
export function foldersWithYear(db: Db, year: number | 'none'): Set<string> {
  const condition =
    year === 'none'
      ? sql`pm.taken_local is null`
      : sql`substr(pm.taken_local, 1, 4) = ${String(year).padStart(4, '0')}`;
  const rows = db.all<{ folder_id: string }>(sql`
    select distinct ff.folder_id
    from photo_metadata pm
    join folder_files ff on ff.id = pm.file_id
    where ${condition}`);
  return new Set(rows.map((r) => r.folder_id));
}

export interface DayPhotos {
  count: number;
  /** How many of them recorded no time zone, so were placed by the camera's clock. */
  cameraTime: number;
}

/**
 * Photos per day for each trip named, by the **date part of the wall clock**
 * where each was taken (design §8.4). A photo with a recorded zone is on
 * exactly the right day; one without is assumed to have been taken with the
 * camera set to local time, and is counted in `cameraTime` so the tree can
 * say so. Undated photos are on no day.
 */
export function photoDays(db: Db, tripIds: readonly string[]): Map<string, Map<string, DayPhotos>> {
  const result = new Map<string, Map<string, DayPhotos>>();
  if (tripIds.length === 0) return result;
  const rows = db.all<{ trip_id: string; day: string; n: number; camera: number }>(sql`
    select lf.trip_id, substr(pm.taken_local, 1, 10) as day,
           count(*) as n,
           sum(case when pm.taken_offset_min is null then 1 else 0 end) as camera
    from photo_metadata pm
    join folder_files ff on ff.id = pm.file_id
    join linked_folders lf on lf.id = ff.folder_id
    where pm.taken_local is not null
      and lf.trip_id in (${sql.join(tripIds.map((id) => sql`${id}`), sql`, `)})
    group by lf.trip_id, day`);
  for (const row of rows) {
    let days = result.get(row.trip_id);
    if (days === undefined) {
      days = new Map();
      result.set(row.trip_id, days);
    }
    days.set(row.day, { count: row.n, cameraTime: row.camera });
  }
  return result;
}

interface MapRow {
  id: string;
  folder_id: string;
  lat: number;
  lon: number;
  direction_deg: number | null;
}

/**
 * Located photos for the map, column by column (design §9.1), in taken-time
 * order, undated last, so the members of a burst are already in the order
 * the preview steps through them (§9.3).
 *
 * For one trip, every located photo in its folders. For all trips, the
 * located photos of every trip shown in the library (archived trips only when
 * asked), filtered by year taken and by trip. A folder linked to more than one
 * trip would put its photos on the map twice, so all-trips mode keeps one row
 * per `(real_path, relative_path)`: the earliest-linked (Requirement 5.6).
 */
export function mapPoints(db: Db, scope: PhotoMapScope): PhotoMapPoints {
  let rows: MapRow[];
  if ('all' in scope) {
    const where: SQL[] = [sql`pm.state = 'located'`];
    if (!scope.includeArchived) where.push(sql`t.status = 'active'`);
    if (scope.tripId !== undefined) where.push(sql`lf.trip_id = ${scope.tripId}`);
    if (scope.year === 'none') where.push(sql`pm.taken_local is null`);
    else if (scope.year !== undefined) where.push(sql`substr(pm.taken_local, 1, 4) = ${String(scope.year).padStart(4, '0')}`);
    rows = db.all<MapRow>(sql`
      select id, folder_id, lat, lon, direction_deg from (
        select ff.id, ff.folder_id, pm.lat, pm.lon, pm.direction_deg, pm.taken_local,
               row_number() over (
                 partition by lf.real_path, ff.relative_path
                 order by lf.created_at, lf.id
               ) as copy
        from photo_metadata pm
        join folder_files ff on ff.id = pm.file_id
        join linked_folders lf on lf.id = ff.folder_id
        join trips t on t.id = lf.trip_id
        where ${sql.join(where, sql` and `)}
      ) where copy = 1
      order by taken_local is null, taken_local, id`);
  } else {
    rows = db.all<MapRow>(sql`
      select ff.id, ff.folder_id, pm.lat, pm.lon, pm.direction_deg
      from photo_metadata pm
      join folder_files ff on ff.id = pm.file_id
      join linked_folders lf on lf.id = ff.folder_id
      where pm.state = 'located' and lf.trip_id = ${scope.tripId}
      order by pm.taken_local is null, pm.taken_local, ff.id`);
  }

  const folders: string[] = [];
  const folderIndex = new Map<string, number>();
  const points: PhotoMapPoints = {
    ids: Array.from({ length: rows.length }, () => ''),
    lat: new Float64Array(rows.length),
    lon: new Float64Array(rows.length),
    folder: new Uint32Array(rows.length),
    folders,
    dir: Array.from({ length: rows.length }, () => null),
  };
  for (const [i, row] of rows.entries()) {
    let index = folderIndex.get(row.folder_id);
    if (index === undefined) {
      index = folders.length;
      folders.push(row.folder_id);
      folderIndex.set(row.folder_id, index);
    }
    points.ids[i] = row.id;
    points.lat[i] = row.lat;
    points.lon[i] = row.lon;
    points.folder[i] = index;
    points.dir[i] = row.direction_deg;
  }
  return points;
}

/**
 * Years with photos, newest first, and the count with no taken time, for the
 * Photos view's filter (design §8.2). Counts every photo, located or not, and
 * a folder linked to more than one trip once.
 */
export function photoYears(db: Db, includeArchived: boolean): { years: { year: number; count: number }[]; noDate: number } {
  const rows = db.all<{ year: string | null; n: number }>(sql`
    select substr(pm.taken_local, 1, 4) as year,
           count(distinct lf.real_path || char(0) || ff.relative_path) as n
    from photo_metadata pm
    join folder_files ff on ff.id = pm.file_id
    join linked_folders lf on lf.id = ff.folder_id
    join trips t on t.id = lf.trip_id
    ${includeArchived ? sql`` : sql`where t.status = 'active'`}
    group by year
    order by year desc`);
  return {
    years: rows.filter((r) => r.year !== null).map((r) => ({ year: Number(r.year), count: r.n })),
    noDate: rows.find((r) => r.year === null)?.n ?? 0,
  };
}
