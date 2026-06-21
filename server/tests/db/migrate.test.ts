import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, getUserVersion, type Migration } from '../../src/db/migrate.js';

describe('runMigrations', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => { db.close(); });

  it('applies pending migrations in order and stamps user_version', () => {
    const order: number[] = [];
    const migrations: Migration[] = [
      { version: 2, name: 'b', up: () => order.push(2) },
      { version: 1, name: 'a', up: () => order.push(1) },
    ];
    const landed = runMigrations(db, migrations);
    expect(order).toEqual([1, 2]);
    expect(landed).toBe(2);
    expect(getUserVersion(db)).toBe(2);
  });

  it('skips already-applied migrations', () => {
    const ran: number[] = [];
    runMigrations(db, [{ version: 1, name: 'a', up: () => ran.push(1) }]);
    runMigrations(db, [
      { version: 1, name: 'a', up: () => ran.push(1) },
      { version: 2, name: 'b', up: () => ran.push(2) },
    ]);
    expect(ran).toEqual([1, 2]);
    expect(getUserVersion(db)).toBe(2);
  });

  it('rolls back a failed transactional migration and leaves the version unchanged', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'create', up: d => d.exec('CREATE TABLE t (id INTEGER)') },
      {
        version: 2,
        name: 'boom',
        up: d => {
          d.exec("INSERT INTO t (id) VALUES (1)");
          throw new Error('boom');
        },
      },
    ];
    expect(() => runMigrations(db, migrations)).toThrow(/boom/);
    expect(getUserVersion(db)).toBe(1);
    // The insert from the failed migration must have rolled back.
    expect((db.prepare('SELECT COUNT(*) n FROM t').get() as { n: number }).n).toBe(0);
  });

  it('calls beforeMigrate only when work is pending', () => {
    let calls = 0;
    runMigrations(db, [], { beforeMigrate: () => { calls++; } });
    expect(calls).toBe(0);
    runMigrations(db, [{ version: 1, name: 'a', up: () => {} }], { beforeMigrate: () => { calls++; } });
    expect(calls).toBe(1);
  });

  it('rejects duplicate versions', () => {
    expect(() => runMigrations(db, [
      { version: 1, name: 'a', up: () => {} },
      { version: 1, name: 'b', up: () => {} },
    ])).toThrow(/Duplicate migration version/);
  });
});
