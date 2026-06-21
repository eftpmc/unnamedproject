import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backupDatabase } from '../../src/db/backup.js';

describe('backupDatabase', () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    dbPath = path.join(dir, 'app.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (id INTEGER); INSERT INTO t (id) VALUES (42);');
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a restorable snapshot of the current data', () => {
    const dest = backupDatabase(db, dbPath, 'pre-migrate');
    expect(fs.existsSync(dest)).toBe(true);

    const copy = new Database(dest, { readonly: true });
    expect((copy.prepare('SELECT id FROM t').get() as { id: number }).id).toBe(42);
    copy.close();
  });

  it('keeps only the five most recent backups for a label', () => {
    for (let i = 0; i < 8; i++) {
      // Distinct timestamps so prune ordering is deterministic.
      const dest = backupDatabase(db, dbPath, 'pre-migrate');
      const aged = dest.replace('pre-migrate-', `pre-migrate-2020-01-0${i}-`);
      fs.renameSync(dest, aged);
    }
    const remaining = fs.readdirSync(dir).filter(f => f.includes('.pre-migrate-'));
    expect(remaining.length).toBeLessThanOrEqual(5);
  });
});
