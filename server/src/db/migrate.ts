import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
  /**
   * Migrations that rebuild tables toggle `PRAGMA foreign_keys`, which is a
   * no-op inside a transaction. Those run outside the runner's transaction and
   * must be internally idempotent / self-protecting (the baseline is one).
   */
  noTransaction?: boolean;
}

export interface MigrateHooks {
  /**
   * Called once before any pending migration runs. Use it to snapshot the
   * database so a failed upgrade is recoverable. Not called when nothing is
   * pending.
   */
  beforeMigrate?: (fromVersion: number, toVersion: number) => void;
}

export function getUserVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Applies every migration whose version is greater than the database's current
 * `PRAGMA user_version`, in order. Each migration and its version bump commit
 * atomically, so an interrupted upgrade never leaves the schema half-applied or
 * the version out of sync with the schema. Returns the version landed on.
 */
export function runMigrations(
  db: Database.Database,
  migrations: Migration[],
  hooks: MigrateHooks = {},
): number {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  ordered.forEach((m, i) => {
    if (m.version < 1) throw new Error(`Migration versions must be >= 1 (got ${m.version})`);
    if (i > 0 && m.version === ordered[i - 1].version) {
      throw new Error(`Duplicate migration version ${m.version} (${m.name})`);
    }
  });

  const current = getUserVersion(db);
  const pending = ordered.filter(m => m.version > current);
  if (pending.length === 0) return current;

  const target = pending[pending.length - 1].version;
  hooks.beforeMigrate?.(current, target);

  for (const m of pending) {
    if (m.noTransaction) {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    } else {
      db.transaction(() => {
        m.up(db);
        db.pragma(`user_version = ${m.version}`);
      })();
    }
    console.log(`Applied DB migration ${m.version}: ${m.name}`);
  }
  return target;
}
