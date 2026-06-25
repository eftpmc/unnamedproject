import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';

function buildV4Database(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, hashed_password TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      repo_path TEXT,
      enabled_connection_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      pinned_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE plans (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE plan_steps (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', position INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE pipelines (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE executions (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE memories (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE session_project_links (session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY (session_id, project_id));
    CREATE TABLE agent_worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      claude_session_id TEXT,
      codex_session_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(project_id, session_id)
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      path TEXT,
      url TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      source_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      source_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('scope_changed','project_linked','project_created','plan_created','artifact_created','approval_requested','approval_resolved','mcp_required','subagent_started','subagent_completed','connection_created')),
      title TEXT NOT NULL,
      body TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.pragma('user_version = 4');
  return db;
}

describe('migration v5: spaces rename and item model', () => {
  let db: Database.Database;
  const dbPath = path.join('/tmp', `migration-v5-test-${Date.now()}.db`);

  beforeAll(async () => {
    db = buildV4Database(dbPath);
    db.prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u1', 'a@b.com', 'hash')").run();
    db.prepare("INSERT INTO projects (id, user_id, name, repo_path) VALUES ('p1', 'u1', 'My Project', '/repos/p1')").run();
    db.prepare("INSERT INTO plans (id, project_id, title) VALUES ('plan1', 'p1', 'Plan One')").run();
    db.prepare("INSERT INTO plan_steps (id, plan_id, title, position) VALUES ('step1', 'plan1', 'Step One', 0)").run();
    db.prepare(`
      INSERT INTO artifacts (id, project_id, kind, title, mime_type, path, source_plan_id, source_step_id)
      VALUES ('art1', 'p1', 'report', 'Generated Report', 'text/markdown', 'artifacts/art1.md', 'plan1', 'step1')
    `).run();
    db.prepare("INSERT INTO sessions (id, user_id, pinned_project_id) VALUES ('s1', 'u1', 'p1')").run();
    db.prepare(`
      INSERT INTO session_events (id, session_id, type, title, project_id, artifact_id)
      VALUES ('ev1', 's1', 'artifact_created', 'Artifact created', 'p1', 'art1')
    `).run();
    db.prepare("INSERT INTO session_project_links (session_id, project_id) VALUES ('s1', 'p1')").run();
    db.prepare(`
      INSERT INTO agent_worktrees (id, project_id, session_id, branch, worktree_path)
      VALUES ('wt1', 'p1', 's1', 'main', '/worktrees/wt1')
    `).run();
    db.prepare("INSERT INTO executions (id, project_id) VALUES ('ex1', 'p1')").run();
    db.prepare("INSERT INTO memories (id, project_id, content) VALUES ('mem1', 'p1', 'remember this')").run();
    db.prepare("INSERT INTO pipelines (id, user_id, title) VALUES ('pipe1', 'u1', 'Pipeline One')").run();

    const { migrations } = await import('../../src/db/index.js');
    runMigrations(db, migrations);
  });

  afterAll(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* already removed */ }
  });

  it('renames projects to spaces and preserves rows and foreign keys', () => {
    const space = db.prepare("SELECT name FROM spaces WHERE id = 'p1'").get() as { name: string };
    expect(space.name).toBe('My Project');
    // plans and pipelines are dropped by v14; remaining tables should have no projects FK
    for (const table of ['executions', 'memories', 'session_project_links', 'agent_worktrees', 'session_events']) {
      const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table) as { sql: string } | undefined;
      if (!row) continue; // table may have been dropped by a later migration
      expect(row.sql.toLowerCase()).not.toContain('references projects');
    }
  });

  it('backfills the repository and artifact as items', () => {
    const spaceSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'spaces'").get() as { sql: string };
    expect(spaceSql.sql).not.toContain('repo_path');
    const artifactSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'artifacts'").get() as { sql: string } | undefined;
    expect(artifactSql).toBeUndefined();

    const repoItem = db.prepare("SELECT id FROM space_items WHERE space_id = 'p1' AND type = 'repo'").get() as { id: string };
    const repo = db.prepare('SELECT repo_path FROM space_repos WHERE item_id = ?').get(repoItem.id) as { repo_path: string };
    expect(repo.repo_path).toBe('/repos/p1');

    const fileItem = db.prepare("SELECT id FROM space_items WHERE space_id = 'p1' AND type = 'file'").get() as { id: string };
    const file = db.prepare('SELECT file_path FROM space_files WHERE item_id = ?').get(fileItem.id) as { file_path: string };
    expect(file.file_path).toBe('artifacts/art1.md');
    const event = db.prepare("SELECT item_id FROM session_events WHERE id = 'ev1'").get() as { item_id: string };
    expect(event.item_id).toBe(fileItem.id);
  });

  it('renames ownership columns and rekeys worktrees', () => {
    expect((db.prepare("SELECT pinned_space_id FROM sessions WHERE id = 's1'").get() as { pinned_space_id: string }).pinned_space_id).toBe('p1');
    expect((db.prepare("SELECT space_id FROM session_project_links WHERE session_id = 's1'").get() as { space_id: string }).space_id).toBe('p1');
    expect((db.prepare("SELECT space_id FROM executions WHERE id = 'ex1'").get() as { space_id: string }).space_id).toBe('p1');
    expect((db.prepare("SELECT space_id FROM memories WHERE id = 'mem1'").get() as { space_id: string }).space_id).toBe('p1');
    const repoItem = db.prepare("SELECT id FROM space_items WHERE type = 'repo'").get() as { id: string };
    expect((db.prepare("SELECT item_id FROM agent_worktrees WHERE id = 'wt1'").get() as { item_id: string }).item_id).toBe(repoItem.id);
    // pipelines is dropped by v14 — only verify it no longer exists
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'pipelines'").get()).toBeUndefined();
  });

  it('allows new item events while preserving historical artifact events', () => {
    expect(() => db.prepare(
      "INSERT INTO session_events (id, session_id, type, title) VALUES ('ev2', 's1', 'item_created', 'Item created')",
    ).run()).not.toThrow();
    expect((db.prepare("SELECT type FROM session_events WHERE id = 'ev1'").get() as { type: string }).type).toBe('artifact_created');
  });

  it('lands on the latest version and v5 is idempotent', async () => {
    const { migrations } = await import('../../src/db/index.js');
    const latestVersion = Math.max(...migrations.map(m => m.version));
    expect(db.pragma('user_version', { simple: true })).toBe(latestVersion);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const migration = migrations.find(candidate => candidate.version === 5)!;
    expect(() => migration.up(db)).not.toThrow();
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('migration v7: finalize an already-migrated v6 database', () => {
  it('backfills and removes the compatibility artifacts table', async () => {
    const repairPath = path.join('/tmp', `migration-v7-test-${Date.now()}.db`);
    const repairDb = new Database(repairPath);
    repairDb.exec(`
      CREATE TABLE spaces (id TEXT PRIMARY KEY);
      CREATE TABLE sessions (id TEXT PRIMARY KEY);
      CREATE TABLE plans (id TEXT PRIMARY KEY);
      CREATE TABLE plan_steps (id TEXT PRIMARY KEY);
      CREATE TABLE executions (id TEXT PRIMARY KEY);
      CREATE TABLE space_items (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(id),
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        source_session_id TEXT,
        source_plan_id TEXT,
        source_step_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE space_files (item_id TEXT PRIMARY KEY, file_path TEXT NOT NULL, size_bytes INTEGER, mime_type TEXT);
      CREATE TABLE space_repos (item_id TEXT PRIMARY KEY REFERENCES space_items(id), repo_path TEXT NOT NULL, default_branch TEXT);
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        title TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        path TEXT,
        source_plan_id TEXT,
        source_step_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        type TEXT NOT NULL CHECK(type IN (
          'scope_changed','project_linked','project_created','plan_created',
          'artifact_created','item_created','approval_requested','approval_resolved',
          'mcp_required','subagent_started','subagent_completed','connection_created'
        )),
        title TEXT NOT NULL,
        body TEXT,
        space_id TEXT REFERENCES spaces(id),
        plan_id TEXT REFERENCES plans(id),
        item_id TEXT,
        execution_id TEXT REFERENCES executions(id),
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO spaces VALUES ('s1');
      INSERT INTO sessions VALUES ('sess1');
      INSERT INTO artifacts VALUES ('a1', 's1', 'Report', 'text/markdown', 'artifacts/a1.md', NULL, NULL, 123);
      INSERT INTO session_events (id, session_id, type, title, item_id) VALUES ('e1', 'sess1', 'artifact_created', 'Artifact created', 'a1');
      PRAGMA user_version = 6;
    `);

    const { migrations } = await import('../../src/db/index.js');
    runMigrations(repairDb, migrations);

    expect(repairDb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'artifacts'").get()).toBeUndefined();
    expect(repairDb.prepare("SELECT name FROM space_items WHERE id = 'item_a1'").get()).toEqual({ name: 'Report' });
    expect(repairDb.prepare("SELECT file_path FROM space_files WHERE item_id = 'item_a1'").get()).toEqual({ file_path: 'artifacts/a1.md' });
    expect(repairDb.prepare("SELECT item_id FROM session_events WHERE id = 'e1'").get()).toEqual({ item_id: 'item_a1' });

    repairDb.close();
    fs.unlinkSync(repairPath);
  });
});

describe('migration v8: repair pipeline Space ownership', () => {
  it('repoints a legacy user-owned space_id value and fixes the foreign key', async () => {
    const repairPath = path.join('/tmp', `migration-v8-test-${Date.now()}.db`);
    const repairDb = new Database(repairPath);
    repairDb.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE spaces (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE space_repos (item_id TEXT PRIMARY KEY, repo_path TEXT NOT NULL, default_branch TEXT);
      INSERT INTO users VALUES ('u1');
      INSERT INTO spaces VALUES ('s1', 'u1', 1);
      INSERT INTO pipelines VALUES ('p1', 'u1', 'Release', NULL, 2);
      PRAGMA user_version = 7;
      PRAGMA foreign_keys = ON;
    `);

    const { migrations } = await import('../../src/db/index.js');
    runMigrations(repairDb, migrations);

    expect(repairDb.prepare("SELECT space_id FROM pipelines WHERE id = 'p1'").get()).toEqual({ space_id: 's1' });
    const pipelineSql = repairDb.prepare("SELECT sql FROM sqlite_master WHERE name = 'pipelines'").get() as { sql: string };
    expect(pipelineSql.sql.toLowerCase()).toContain('references spaces');
    expect(repairDb.pragma('foreign_key_check')).toEqual([]);

    repairDb.close();
    fs.unlinkSync(repairPath);
  });
});
