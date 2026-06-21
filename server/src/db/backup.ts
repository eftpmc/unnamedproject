import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const KEEP_BACKUPS = 5;

/**
 * Writes a point-in-time copy of the SQLite database next to it as
 * `<dbfile>.<label>-<timestamp>`. Checkpoints the WAL first so the copied file
 * is a complete snapshot rather than missing not-yet-merged writes. Keeps only
 * the most recent KEEP_BACKUPS copies for a given label. Returns the path.
 */
export function backupDatabase(db: Database.Database, dbPath: string, label = 'backup'): string {
  db.pragma('wal_checkpoint(TRUNCATE)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${dbPath}.${label}-${stamp}`;
  fs.copyFileSync(dbPath, dest);
  pruneBackups(dbPath, label);
  return dest;
}

function pruneBackups(dbPath: string, label: string): void {
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.${label}-`;
  const backups = fs
    .readdirSync(dir)
    .filter(f => f.startsWith(prefix))
    .sort(); // ISO timestamps sort chronologically
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) {
    try {
      fs.unlinkSync(path.join(dir, old));
    } catch {
      /* a backup we couldn't prune isn't fatal */
    }
  }
}
