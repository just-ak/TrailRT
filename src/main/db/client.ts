import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { compileNamePattern, matchesName } from '@shared/search/namePattern';
import { applyMigrations, type MigrationResult } from './migrate';
import { COMPACT_AFTER } from './migrations/index';
import * as schema from './schema';

/**
 * SQLite client construction.
 *
 * Deliberately takes a file path rather than reaching for Electron's app paths,
 * so unit tests can point it at a temporary file (or `:memory:`) with no
 * Electron in the loop. Path resolution lives in `main/paths.ts`.
 */

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
  migration: MigrationResult;
  close(): void;
}

export interface CreateDbOptions {
  /** A file path, or ':memory:' for tests. */
  file: string;
  /** Skip migrations; only used when opening a candidate file for validation. */
  skipMigrations?: boolean;
  readonly?: boolean;
}

export function createDatabase(options: CreateDbOptions): DbHandle {
  const sqlite = new Database(options.file, {
    readonly: options.readonly ?? false,
    fileMustExist: options.readonly ?? false,
  });

  // WAL gives concurrent readers and a crash-consistent log. `synchronous` at
  // NORMAL is the usual WAL pairing: a power loss can cost the last commits but
  // cannot corrupt the file.
  if (!options.readonly) {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
  }
  // Off by default in SQLite, and the schema leans on cascade deletes.
  sqlite.pragma('foreign_keys = ON');
  // Fail fast rather than hang if another process holds a write lock.
  sqlite.pragma('busy_timeout = 5000');
  registerRegexp(sqlite);

  const migration = options.skipMigrations
    ? { applied: [], alreadyCurrent: true, schemaVersion: 0 }
    : applyMigrations(sqlite);

  // ADR 0025: a migration that dropped gigabytes leaves them as free pages
  // inside the file. VACUUM rewrites only the live data, so it needs space for
  // the compacted file, not the old one, and runs once, outside the
  // migration's transaction, which VACUUM cannot run inside.
  if (migration.applied.some((version) => COMPACT_AFTER.has(version))) {
    sqlite.exec('VACUUM');
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
  }

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    migration,
    close: () => {
      try {
        // Fold the WAL back into the main file so a copied database file is
        // complete on its own.
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // A checkpoint failure on shutdown is not worth blocking quit over.
      }
      sqlite.close();
    },
  };
}

/**
 * SQLite's `X REGEXP Y` calls `regexp(Y, X)`, which SQLite does not define.
 * This defines it with the library search's own patterns (Phase 14
 * Requirement 20), so a search keeps its ordering and joins in SQL. The last
 * pattern is kept, because one query tests it against every row.
 */
function registerRegexp(sqlite: Database.Database): void {
  let lastSource: string | null = null;
  let lastRegex: RegExp | null = null;
  sqlite.function('regexp', { deterministic: true }, (pattern: unknown, value: unknown) => {
    if (typeof pattern !== 'string') throw new TypeError('REGEXP needs a text pattern');
    if (pattern !== lastSource || lastRegex === null) {
      const compiled = compileNamePattern(pattern);
      // The request schemas refuse a bad pattern first; this is the backstop.
      if (!compiled.ok) throw new Error(`Not a valid search pattern: ${compiled.message}`);
      lastSource = pattern;
      lastRegex = compiled.regex;
    }
    return matchesName(lastRegex, typeof value === 'string' ? value : null) ? 1 : 0;
  });
}

export { schema };
