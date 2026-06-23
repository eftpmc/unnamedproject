# Spaces Rename & Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `Project` → `Space` end-to-end (DB, API, web), replace the single optional `repo_path` with a generic `space_items` model (repo/file/note), remove the standalone `artifacts` table by folding generated output into items with provenance, and replace `ProjectPage`'s 7 horizontal tabs with a contextual sidebar reused from the global nav.

**Architecture:** One SQLite migration (v5) renames/restructures the schema. Server-side route/function renames follow mechanically. A new item service owns the `space_items` + per-type-subtable invariant. Web API client and types are renamed in lockstep with the server, then the UI layer (Sidebar context-switch, SpacePage sections, Items list) is rebuilt on top.

**Tech Stack:** better-sqlite3, Express routes, vitest + supertest (server tests), React + TanStack Query (web), existing `@/components/ui/sidebar` primitives.

## Global Constraints

- Full rename — `project` is retired as an identifier everywhere (DB tables/columns, routes, function names, types, UI strings), not just relabeled in the UI.
- `space_items.type` is `repo | file | note` only this pass — no `'artifact'` type, no `kind`/`status` columns.
- `space_items` provenance: `source_session_id` set whenever the creating code has a session context (NULL only for items added with no session, e.g. via Settings UI); `source_plan_id`/`source_step_id` set only when that session call was part of a plan step.
- No second sidebar — the existing `web/src/components/Sidebar.tsx` becomes contextual (swaps content when inside a Space); no new sidebar component.
- Item types are immutable after creation (changing type = delete + recreate).
- All DB writes affecting `space_items` + its subtype table happen in one transaction.

---

## Task 1: Migration v5 — schema rename and restructure

**Files:**
- Modify: `server/src/db/index.ts:22-27` (migrations array), and add a new migration function near `widenConnectionsTypeForLocal` (after line 162).
- Test: `server/tests/db/migration-v5.test.ts` (new)

**Interfaces:**
- Produces: tables `spaces`, `space_items`, `space_repos`, `space_files`, `space_notes`; columns `pipelines.space_id`, `sessions.pinned_space_id`, `session_events.item_id`; `artifacts` table removed; `projects` table removed.
- Consumes: existing `Migration` type from `server/src/db/migrate.ts:3-13` (`{ version, name, up, noTransaction? }`) and `runMigrations` from `server/src/db/migrate.ts:34-38`.

- [ ] **Step 1: Write the failing migration test**

```typescript
// server/tests/db/migration-v5.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';

// Build a v4 database by hand (pre-migration shape, matching the REAL current
// schema's columns -- not a simplified stand-in -- so this test actually
// exercises the foreign-key and CHECK-constraint edge cases the migration
// must handle) so the test exercises the actual upgrade path, not a fresh install.
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

    const userId = 'u1';
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)').run(userId, 'a@b.com', 'hash');
    db.prepare(`INSERT INTO projects (id, user_id, name, repo_path) VALUES ('p1', ?, 'My Project', '/repos/p1')`).run(userId);
    db.prepare(`INSERT INTO plans (id, project_id, title) VALUES ('plan1', 'p1', 'Plan One')`).run();
    db.prepare(`INSERT INTO plan_steps (id, plan_id, title, position) VALUES ('step1', 'plan1', 'Step One', 0)`).run();
    db.prepare(`
      INSERT INTO artifacts (id, project_id, kind, title, mime_type, path, source_plan_id, source_step_id)
      VALUES ('art1', 'p1', 'report', 'Generated Report', 'text/markdown', 'artifacts/art1.md', 'plan1', 'step1')
    `).run();
    db.prepare(`INSERT INTO sessions (id, user_id, pinned_project_id) VALUES ('s1', ?, 'p1')`).run(userId);
    db.prepare(`
      INSERT INTO session_events (id, session_id, type, title, project_id, artifact_id)
      VALUES ('ev1', 's1', 'artifact_created', 'Artifact created', 'p1', 'art1')
    `).run();
    db.prepare(`INSERT INTO session_project_links (session_id, project_id) VALUES ('s1', 'p1')`).run();
    db.prepare(`
      INSERT INTO agent_worktrees (id, project_id, session_id, branch, worktree_path)
      VALUES ('wt1', 'p1', 's1', 'main', '/worktrees/wt1')
    `).run();
    db.prepare(`INSERT INTO executions (id, project_id) VALUES ('ex1', 'p1')`).run();
    db.prepare(`INSERT INTO memories (id, project_id, content) VALUES ('mem1', 'p1', 'remember this')`).run();

    const { migrations } = await import('../../src/db/index.js');
    runMigrations(db, migrations);
  });

  it('renames projects to spaces, preserving rows', () => {
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get('p1') as { name: string };
    expect(space.name).toBe('My Project');
  });

  it('rewrites every child table\'s FK to point at spaces, not the now-gone projects table', () => {
    // A literal regression test for the orphaned-FK bug: if the rename had used
    // legacy_alter_table=ON, every one of these REFERENCES clauses would still
    // say "projects" and the next insert with foreign_keys=ON would throw
    // "no such table: projects".
    const tables = ['plans', 'executions', 'memories', 'session_project_links', 'agent_worktrees', 'session_events'];
    for (const table of tables) {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table) as { sql: string };
      expect(row.sql.toLowerCase()).not.toContain('references projects');
    }
    // Prove it at runtime too, not just by reading the schema text.
    expect(() => db.prepare(`INSERT INTO plans (id, project_id, title) VALUES ('plan2', 'p1', 'Plan Two')`).run())
      .not.toThrow();
  });

  it('drops repo_path from spaces and backfills it as a repo item', () => {
    const space = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'spaces'").get() as { sql: string };
    expect(space.sql).not.toContain('repo_path');

    const item = db.prepare(`SELECT * FROM space_items WHERE space_id = 'p1' AND type = 'repo'`).get() as { id: string; name: string };
    expect(item).toBeDefined();
    const repo = db.prepare('SELECT * FROM space_repos WHERE item_id = ?').get(item.id) as { repo_path: string };
    expect(repo.repo_path).toBe('/repos/p1');
  });

  it('backfills the artifacts row as a FILE item pointing at its existing on-disk path (no content read, no data loss), then drops artifacts', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.map(t => t.name)).not.toContain('artifacts');

    const item = db.prepare(`SELECT * FROM space_items WHERE space_id = 'p1' AND type = 'file'`).get() as {
      id: string; source_plan_id: string | null; source_step_id: string | null;
    };
    expect(item.source_plan_id).toBe('plan1');
    expect(item.source_step_id).toBe('step1');

    const file = db.prepare('SELECT * FROM space_files WHERE item_id = ?').get(item.id) as { file_path: string };
    expect(file.file_path).toBe('artifacts/art1.md'); // the original on-disk path is preserved verbatim

    const event = db.prepare('SELECT * FROM session_events WHERE id = ?').get('ev1') as { item_id: string };
    expect(event.item_id).toBe(item.id);
  });

  it('extends session_events.type to allow item_created without breaking historical rows', () => {
    expect(() =>
      db.prepare(`INSERT INTO session_events (id, session_id, type, title, item_id) VALUES ('ev2', 's1', 'item_created', 'Item created', NULL)`).run(),
    ).not.toThrow();
    const historical = db.prepare(`SELECT type FROM session_events WHERE id = 'ev1'`).get() as { type: string };
    expect(historical.type).toBe('artifact_created'); // old rows keep their original type value
  });

  it('renames sessions.pinned_project_id to pinned_space_id', () => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('s1') as { pinned_space_id: string };
    expect(session.pinned_space_id).toBe('p1');
  });

  it('re-keys agent_worktrees to (item_id, session_id), pointing at the backfilled repo item', () => {
    const repoItem = db.prepare(`SELECT id FROM space_items WHERE space_id = 'p1' AND type = 'repo'`).get() as { id: string };
    const worktree = db.prepare('SELECT * FROM agent_worktrees WHERE id = ?').get('wt1') as { item_id: string; session_id: string };
    expect(worktree.item_id).toBe(repoItem.id);
    expect(worktree.session_id).toBe('s1');
  });

  it('renames every other project_id FK column to space_id (generic sweep)', () => {
    const link = db.prepare('SELECT * FROM session_project_links WHERE session_id = ?').get('s1') as { space_id: string };
    expect(link.space_id).toBe('p1');
    const exec = db.prepare("SELECT * FROM executions WHERE id = 'ex1'").get() as { space_id: string };
    expect(exec.space_id).toBe('p1');
    const mem = db.prepare("SELECT * FROM memories WHERE id = 'mem1'").get() as { space_id: string };
    expect(mem.space_id).toBe('p1');
  });

  it('lands on user_version 5', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(5);
  });

  it('is idempotent: re-running the migration function directly does not throw', async () => {
    const { migrations } = await import('../../src/db/index.js');
    const v5 = migrations.find(m => m.version === 5)!;
    expect(() => v5.up(db)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/db/migration-v5.test.ts`
Expected: FAIL — `spaces` table does not exist (migration v5 not yet defined).

- [ ] **Step 3: Implement migration v5**

Add to `server/src/db/index.ts`, after `widenConnectionsTypeForLocal` (line 162) and before `export function initDb()`:

```typescript
function renameProjectsToSpacesAndAddItems(database: Database.Database): void {
  database.exec(`PRAGMA foreign_keys = OFF;`);

  // IMPORTANT: do NOT set legacy_alter_table=ON for this rename. With it OFF
  // (SQLite's modern default since 3.25), ALTER TABLE ... RENAME TO automatically
  // rewrites every other table's `REFERENCES projects(id)` to `REFERENCES spaces(id)`.
  // Setting it ON here -- the way `repairPlanForeignKeys` above had to clean up after
  // the historical campaigns->plans rename -- would silently orphan every child FK
  // and the next insert under foreign_keys=ON would throw "no such table: projects".
  // Guarded so re-running this migration after a crash doesn't fail on a table that
  // no longer exists.
  const projectsTableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
    .get();
  if (projectsTableExists) {
    database.exec(`PRAGMA legacy_alter_table = OFF; ALTER TABLE projects RENAME TO spaces;`);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS space_items (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('repo','file','note')),
      name TEXT NOT NULL,
      source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      source_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      source_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS space_repos (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      repo_path TEXT NOT NULL,
      default_branch TEXT
    );

    CREATE TABLE IF NOT EXISTS space_files (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      size_bytes INTEGER,
      mime_type TEXT
    );

    CREATE TABLE IF NOT EXISTS space_notes (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      content TEXT NOT NULL
    );
  `);

  // Backfill repo_path -> a repo item, one per space that has one. Idempotent:
  // skip a space whose repo item was already created by a prior, interrupted run.
  const repoPathColumnExists = (database.prepare("PRAGMA table_info(spaces)").all() as Array<{ name: string }>)
    .some(c => c.name === 'repo_path');
  if (repoPathColumnExists) {
    const spacesWithRepo = database
      .prepare(`SELECT id, name, repo_path FROM spaces WHERE repo_path IS NOT NULL`)
      .all() as Array<{ id: string; name: string; repo_path: string }>;
    const insertItem = database.prepare(
      `INSERT INTO space_items (id, space_id, type, name) VALUES (?, ?, 'repo', ?)`,
    );
    const insertRepo = database.prepare(`INSERT INTO space_repos (item_id, repo_path) VALUES (?, ?)`);
    const itemExists = database.prepare(`SELECT 1 FROM space_items WHERE id = ?`);
    for (const space of spacesWithRepo) {
      const itemId = `item_${space.id}_repo`;
      if (itemExists.get(itemId)) continue;
      insertItem.run(itemId, space.id, space.name);
      insertRepo.run(itemId, space.repo_path);
    }
  }

  // Re-key agent_worktrees to (item_id, session_id): a space can now contain
  // multiple repos, so the old (project_id, session_id) key -- which assumed
  // exactly one repo per space -- no longer identifies a worktree uniquely.
  // Every pre-migration space had at most one repo_path, so mapping each
  // existing worktree row to that space's backfilled repo item (created just
  // above) is unambiguous. Changing the UNIQUE constraint's columns requires a
  // full rebuild, not just a column rename.
  const worktreesTableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_worktrees'")
    .get();
  const worktreesAlreadyRekeyed = worktreesTableExists
    ? (database.prepare("PRAGMA table_info(agent_worktrees)").all() as Array<{ name: string }>).some(c => c.name === 'item_id')
    : false;
  if (worktreesTableExists && !worktreesAlreadyRekeyed) {
    database.exec(`
      ALTER TABLE agent_worktrees RENAME COLUMN project_id TO space_id;
      ALTER TABLE agent_worktrees RENAME TO agent_worktrees_pre_v5;
      CREATE TABLE agent_worktrees (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES space_items(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        branch TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        claude_session_id TEXT,
        codex_session_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(item_id, session_id)
      );
      INSERT INTO agent_worktrees (id, item_id, session_id, branch, worktree_path, claude_session_id, codex_session_id, created_at)
      SELECT w.id, 'item_' || w.space_id || '_repo', w.session_id, w.branch, w.worktree_path, w.claude_session_id, w.codex_session_id, w.created_at
      FROM agent_worktrees_pre_v5 w
      WHERE EXISTS (SELECT 1 FROM space_items WHERE id = 'item_' || w.space_id || '_repo');
      DROP TABLE agent_worktrees_pre_v5;
    `);
  }

  // Backfill artifacts -> FILE items pointing at their existing on-disk path.
  // Deliberately NOT split into note/file by mime type and NOT re-reading file
  // contents here: every backfilled artifact becomes a `file` item referencing
  // the same `path` the artifacts row already had, so nothing is read, moved,
  // or re-encoded during migration -- the original file stays exactly where it
  // was. (An earlier draft of this migration wrote empty `space_notes.content`
  // for text artifacts, silently discarding the real content stored on disk --
  // this file-item approach is the fix.)
  const artifactsExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'")
    .get();
  if (artifactsExists) {
    const artifacts = database.prepare(`SELECT * FROM artifacts`).all() as Array<{
      id: string; project_id: string; title: string; mime_type: string; path: string | null;
      source_plan_id: string | null; source_step_id: string | null;
    }>;
    const insertFileItem = database.prepare(
      `INSERT INTO space_items (id, space_id, type, name, source_plan_id, source_step_id) VALUES (?, ?, 'file', ?, ?, ?)`,
    );
    const insertFile = database.prepare(`INSERT INTO space_files (item_id, file_path, mime_type) VALUES (?, ?, ?)`);
    const itemExists = database.prepare(`SELECT 1 FROM space_items WHERE id = ?`);

    for (const artifact of artifacts) {
      const itemId = `item_${artifact.id}`;
      if (itemExists.get(itemId)) continue;
      insertFileItem.run(itemId, artifact.project_id, artifact.title, artifact.source_plan_id, artifact.source_step_id);
      insertFile.run(itemId, artifact.path ?? '', artifact.mime_type);
    }

    // session_events.artifact_id -> session_events.item_id, plus widen the type
    // CHECK to allow 'item_created' going forward. Historical type values
    // (including 'artifact_created' on old rows) are preserved as-is -- this is
    // a deliberate scope boundary: only the new value is added, old event type
    // strings are not retroactively renamed.
    database.exec(`
      ALTER TABLE session_events RENAME COLUMN project_id TO space_id;
      ALTER TABLE session_events RENAME TO session_events_pre_v5;
      CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN (
          'scope_changed','project_linked','project_created','plan_created',
          'artifact_created','item_created','approval_requested','approval_resolved',
          'mcp_required','subagent_started','subagent_completed','connection_created'
        )),
        title TEXT NOT NULL,
        body TEXT,
        space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
        plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
        item_id TEXT REFERENCES space_items(id) ON DELETE SET NULL,
        execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO session_events (id, session_id, type, title, body, space_id, plan_id, item_id, execution_id, metadata, created_at)
      SELECT id, session_id, type, title, body, space_id, plan_id,
             CASE WHEN artifact_id IS NOT NULL THEN 'item_' || artifact_id ELSE NULL END,
             execution_id, metadata, created_at
      FROM session_events_pre_v5;
      DROP TABLE session_events_pre_v5;
    `);

    database.exec(`DROP TABLE artifacts;`);
  }

  // spaces no longer carries repo_path. DROP COLUMN (supported natively since
  // SQLite 3.35, which better-sqlite3 bundles) avoids the rebuild-and-copy
  // dance a full rebuild would otherwise need.
  if (repoPathColumnExists) {
    database.exec(`ALTER TABLE spaces DROP COLUMN repo_path;`);
  }

  // sessions.pinned_project_id -> pinned_space_id; pipelines.user_id -> space_id.
  // Neither column is literally named `project_id`, so the generic sweep below
  // doesn't touch them -- handled explicitly, guarded for idempotency.
  const sessionCols = database.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (sessionCols.some(c => c.name === 'pinned_project_id')) {
    database.exec(`ALTER TABLE sessions RENAME COLUMN pinned_project_id TO pinned_space_id;`);
  }
  const pipelineCols = database.prepare("PRAGMA table_info(pipelines)").all() as Array<{ name: string }>;
  if (pipelineCols.some(c => c.name === 'user_id')) {
    database.exec(`ALTER TABLE pipelines RENAME COLUMN user_id TO space_id;`);
  }

  // Generic sweep: rename every remaining `project_id` column to `space_id`,
  // across whatever tables still have one (session_project_links, executions,
  // memories, campaigns, and anything else) -- querying the schema instead of
  // hand-listing tables, since a hand-curated list is exactly how one of these
  // gets missed.
  const tablesWithProjectId = database
    .prepare(`
      SELECT m.name AS table_name FROM sqlite_master m
      JOIN pragma_table_info(m.name) p ON p.name = 'project_id'
      WHERE m.type = 'table'
    `)
    .all() as Array<{ table_name: string }>;
  for (const { table_name } of tablesWithProjectId) {
    database.exec(`ALTER TABLE "${table_name}" RENAME COLUMN project_id TO space_id;`);
  }

  database.exec(`PRAGMA foreign_keys = ON;`);
}
```

Add to the migrations array (`server/src/db/index.ts:22-27`):

```typescript
const migrations: Migration[] = [
  { version: 1, name: 'baseline-schema', noTransaction: true, up: () => applySchema() },
  { version: 2, name: 'repair-plan-foreign-keys', noTransaction: true, up: repairPlanForeignKeys },
  { version: 3, name: 'tool-registry', up: addToolRegistry },
  { version: 4, name: 'widen-connection-type-for-local', noTransaction: true, up: widenConnectionsTypeForLocal },
  { version: 5, name: 'rename-projects-to-spaces-and-add-items', noTransaction: true, up: renameProjectsToSpacesAndAddItems },
];
```

This single function deliberately replaces the earlier draft's per-table hand-listing of `project_id` renames — the generic `pragma_table_info` sweep at the end catches `session_project_links`, `executions`, `memories`, and any other table with a `project_id` column without needing to enumerate them, which is the safer approach given that an earlier review pass found the hand-curated list missed several real tables.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx vitest run tests/db/migration-v5.test.ts`
Expected: PASS — all 5 assertions green.

- [ ] **Step 5: Update `applySchema()` so fresh installs land directly on the new shape**

Modify `server/src/db/index.ts` inside `applySchema()` (the `projects` table definition around line 217-226): replace it with the final `spaces` table (no `repo_path`), and add `space_items`/`space_repos`/`space_files`/`space_notes` table definitions matching migration v5's `CREATE TABLE` statements exactly. Remove the `artifacts` table definition entirely. Update `session_events` to match migration v5's rebuilt shape exactly: `project_id` → `space_id`, `artifact_id` → `item_id REFERENCES space_items(id) ON DELETE SET NULL`, and the `type` CHECK constraint extended to include `'item_created'` (keep `'artifact_created'` in the list too, since it's still a legitimate historical value an upgraded database may contain). Update `pipelines.user_id` to `pipelines.space_id REFERENCES spaces(id) ON DELETE CASCADE`. Update `sessions.pinned_project_id` to `sessions.pinned_space_id REFERENCES spaces(id) ON DELETE SET NULL`. Update `agent_worktrees` to the re-keyed shape: `item_id TEXT NOT NULL REFERENCES space_items(id) ON DELETE CASCADE` replacing `project_id`, and `UNIQUE(item_id, session_id)` replacing `UNIQUE(project_id, session_id)`. Rename every other `project_id` column found in `applySchema()` (e.g. `session_project_links`, `executions`, `memories`) to `space_id`, referencing `spaces(id)`.

- [ ] **Step 6: Run the full server test suite to check for regressions**

Run: `cd server && npx vitest run`
Expected: All existing tests referencing `projects`/`artifacts` will fail at this point — that's expected and addressed in Tasks 3-5. Confirm no *unrelated* suite breaks.

- [ ] **Step 7: Commit**

```bash
git add server/src/db/index.ts server/tests/db/migration-v5.test.ts
git commit -m "feat(db): migration v5 - rename projects to spaces, add space_items model, drop artifacts table"
```

---

## Task 2: Item service — `space_items` + subtype invariant

**Files:**
- Create: `server/src/services/items.ts`
- Test: `server/tests/services/items.test.ts`

**Interfaces:**
- Consumes: `getDb()` from `server/src/db/index.ts`, `newId()` from `server/src/lib/ids.js`.
- Produces:
  ```typescript
  export type SpaceItemType = 'repo' | 'file' | 'note';

  export interface SpaceItemBase {
    id: string;
    space_id: string;
    type: SpaceItemType;
    name: string;
    source_session_id: string | null;
    source_plan_id: string | null;
    source_step_id: string | null;
    created_at: number;
  }

  export type SpaceItem =
    | (SpaceItemBase & { type: 'repo'; repo_path: string; default_branch: string | null })
    | (SpaceItemBase & { type: 'file'; file_path: string; size_bytes: number | null; mime_type: string | null })
    | (SpaceItemBase & { type: 'note'; content: string });

  export interface CreateItemInput {
    space_id: string;
    name: string;
    source_session_id?: string | null;
    source_plan_id?: string | null;
    source_step_id?: string | null;
  }

  export function createRepoItem(input: CreateItemInput & { repo_path: string; default_branch?: string }): SpaceItem;
  export function createFileItem(input: CreateItemInput & { file_path: string; size_bytes?: number; mime_type?: string }): SpaceItem;
  export function createNoteItem(input: CreateItemInput & { content: string }): SpaceItem;
  export function getItemsForSpace(spaceId: string): SpaceItem[];
  export function getItemById(itemId: string): SpaceItem | undefined;
  export function deleteItem(itemId: string): void;
  ```
  These signatures are used by Task 3 (routes), Task 5 (`agent.ts`/`video.ts`), and Task 6 (web API parity).

- [ ] **Step 1: Write failing tests**

```typescript
// server/tests/services/items.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { createRepoItem, createFileItem, createNoteItem, getItemsForSpace, getItemById, deleteItem } from '../../src/services/items.js';

beforeAll(() => {
  process.env.DATA_DIR = `/tmp/items-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, hashed_password) VALUES ('u1', 'a@b.com', 'h')`).run();
  db.prepare(`INSERT INTO spaces (id, user_id, name) VALUES ('sp1', 'u1', 'Space One')`).run();
});

describe('items service', () => {
  it('creates a repo item with its subtype row in one transaction', () => {
    const item = createRepoItem({ space_id: 'sp1', name: 'my-repo', repo_path: '/repos/my-repo' });
    expect(item.type).toBe('repo');
    if (item.type === 'repo') expect(item.repo_path).toBe('/repos/my-repo');
  });

  it('creates a note item with provenance fields set', () => {
    const item = createNoteItem({
      space_id: 'sp1',
      name: 'Generated Report',
      content: '# Report',
      source_session_id: 's1',
      source_plan_id: 'plan1',
      source_step_id: 'step1',
    });
    expect(item.source_plan_id).toBe('plan1');
    expect(item.source_step_id).toBe('step1');
  });

  it('lists all items for a space across types, newest first', () => {
    createFileItem({ space_id: 'sp1', name: 'notes.txt', file_path: '/files/notes.txt' });
    const items = getItemsForSpace('sp1');
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.map(i => i.type)).toEqual(expect.arrayContaining(['repo', 'note', 'file']));
  });

  it('fetches a single item with its subtype data joined', () => {
    const created = createNoteItem({ space_id: 'sp1', name: 'Note Two', content: 'hello' });
    const fetched = getItemById(created.id);
    expect(fetched?.type).toBe('note');
    if (fetched?.type === 'note') expect(fetched.content).toBe('hello');
  });

  it('deleting an item cascades to its subtype row', () => {
    const created = createFileItem({ space_id: 'sp1', name: 'temp.txt', file_path: '/files/temp.txt' });
    deleteItem(created.id);
    expect(getItemById(created.id)).toBeUndefined();
    const subtype = getDb().prepare('SELECT * FROM space_files WHERE item_id = ?').get(created.id);
    expect(subtype).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run tests/services/items.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/items.js'`.

- [ ] **Step 3: Implement the item service**

```typescript
// server/src/services/items.ts
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';

export type SpaceItemType = 'repo' | 'file' | 'note';

interface SpaceItemRow {
  id: string;
  space_id: string;
  type: SpaceItemType;
  name: string;
  source_session_id: string | null;
  source_plan_id: string | null;
  source_step_id: string | null;
  created_at: number;
}

export interface SpaceItemBase {
  id: string;
  space_id: string;
  type: SpaceItemType;
  name: string;
  source_session_id: string | null;
  source_plan_id: string | null;
  source_step_id: string | null;
  created_at: number;
}

export type SpaceItem =
  | (SpaceItemBase & { type: 'repo'; repo_path: string; default_branch: string | null })
  | (SpaceItemBase & { type: 'file'; file_path: string; size_bytes: number | null; mime_type: string | null })
  | (SpaceItemBase & { type: 'note'; content: string });

export interface CreateItemInput {
  space_id: string;
  name: string;
  source_session_id?: string | null;
  source_plan_id?: string | null;
  source_step_id?: string | null;
}

function insertBaseRow(input: CreateItemInput, type: SpaceItemType): SpaceItemRow {
  const id = newId();
  const row: SpaceItemRow = {
    id,
    space_id: input.space_id,
    type,
    name: input.name,
    source_session_id: input.source_session_id ?? null,
    source_plan_id: input.source_plan_id ?? null,
    source_step_id: input.source_step_id ?? null,
    created_at: Math.floor(Date.now() / 1000),
  };
  getDb()
    .prepare(
      `INSERT INTO space_items (id, space_id, type, name, source_session_id, source_plan_id, source_step_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.space_id, row.type, row.name, row.source_session_id, row.source_plan_id, row.source_step_id);
  return row;
}

export function createRepoItem(
  input: CreateItemInput & { repo_path: string; default_branch?: string },
): SpaceItem {
  return getDb().transaction(() => {
    const base = insertBaseRow(input, 'repo');
    getDb()
      .prepare(`INSERT INTO space_repos (item_id, repo_path, default_branch) VALUES (?, ?, ?)`)
      .run(base.id, input.repo_path, input.default_branch ?? null);
    return { ...base, repo_path: input.repo_path, default_branch: input.default_branch ?? null };
  })();
}

export function createFileItem(
  input: CreateItemInput & { file_path: string; size_bytes?: number; mime_type?: string },
): SpaceItem {
  return getDb().transaction(() => {
    const base = insertBaseRow(input, 'file');
    getDb()
      .prepare(`INSERT INTO space_files (item_id, file_path, size_bytes, mime_type) VALUES (?, ?, ?, ?)`)
      .run(base.id, input.file_path, input.size_bytes ?? null, input.mime_type ?? null);
    return {
      ...base,
      file_path: input.file_path,
      size_bytes: input.size_bytes ?? null,
      mime_type: input.mime_type ?? null,
    };
  })();
}

export function createNoteItem(input: CreateItemInput & { content: string }): SpaceItem {
  return getDb().transaction(() => {
    const base = insertBaseRow(input, 'note');
    getDb().prepare(`INSERT INTO space_notes (item_id, content) VALUES (?, ?)`).run(base.id, input.content);
    return { ...base, content: input.content };
  })();
}

function hydrate(row: SpaceItemRow): SpaceItem {
  const db = getDb();
  if (row.type === 'repo') {
    const sub = db.prepare('SELECT * FROM space_repos WHERE item_id = ?').get(row.id) as {
      repo_path: string;
      default_branch: string | null;
    };
    return { ...row, type: 'repo', repo_path: sub.repo_path, default_branch: sub.default_branch };
  }
  if (row.type === 'file') {
    const sub = db.prepare('SELECT * FROM space_files WHERE item_id = ?').get(row.id) as {
      file_path: string;
      size_bytes: number | null;
      mime_type: string | null;
    };
    return { ...row, type: 'file', file_path: sub.file_path, size_bytes: sub.size_bytes, mime_type: sub.mime_type };
  }
  const sub = db.prepare('SELECT * FROM space_notes WHERE item_id = ?').get(row.id) as { content: string };
  return { ...row, type: 'note', content: sub.content };
}

export function getItemsForSpace(spaceId: string): SpaceItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM space_items WHERE space_id = ? ORDER BY created_at DESC')
    .all(spaceId) as SpaceItemRow[];
  return rows.map(hydrate);
}

export function getItemById(itemId: string): SpaceItem | undefined {
  const row = getDb().prepare('SELECT * FROM space_items WHERE id = ?').get(itemId) as SpaceItemRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function deleteItem(itemId: string): void {
  getDb().prepare('DELETE FROM space_items WHERE id = ?').run(itemId);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run tests/services/items.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/items.ts server/tests/services/items.test.ts
git commit -m "feat(items): add space_items service with per-type subtable invariant"
```

---

## Task 3: Server route rename — `projects.ts` → `spaces.ts`, item-scoped filesystem routes

**Files:**
- Create: `server/src/routes/spaces.ts` (replaces `server/src/routes/projects.ts`)
- Delete: `server/src/routes/projects.ts`
- Modify: wherever `projects.ts` is mounted (search for `app.use('/projects'` or similar route registration, likely `server/src/index.ts` or `server/src/app.ts`)
- Test: `server/tests/routes/spaces.test.ts` (replaces any existing `server/tests/routes/projects.test.ts` if present)

**Interfaces:**
- Consumes: `createRepoItem`, `getItemsForSpace`, `getItemById`, `deleteItem` from Task 2 (`server/src/services/items.ts`).
- Produces: mounted router at `/spaces` consumed by the web API client renames in Task 6.

- [ ] **Step 1: Write failing route tests**

```typescript
// server/tests/routes/spaces.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import request from 'supertest';
import { initDb, getDb } from '../../src/db/index.js';
import { createApp } from '../../src/app.js'; // adjust to actual app factory export

let app: ReturnType<typeof createApp>;
let authCookie: string;

beforeAll(async () => {
  process.env.DATA_DIR = `/tmp/spaces-route-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  initDb();
  app = createApp();
  // Reuse this suite's existing auth helper pattern (see server/tests/auth.test.ts)
  // to register a user and capture authCookie before running the assertions below.
});

describe('GET /spaces', () => {
  it('lists spaces for the authenticated user', async () => {
    const createRes = await request(app).post('/spaces').set('Cookie', authCookie).send({ name: 'Demo Space' });
    expect(createRes.status).toBe(201);

    const listRes = await request(app).get('/spaces').set('Cookie', authCookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.map((s: { name: string }) => s.name)).toContain('Demo Space');
  });
});

describe('item-scoped routes', () => {
  it('rejects an item ID that belongs to a different space', async () => {
    const spaceA = await request(app).post('/spaces').set('Cookie', authCookie).send({ name: 'Space A' });
    const spaceB = await request(app).post('/spaces').set('Cookie', authCookie).send({ name: 'Space B' });
    const itemRes = await request(app)
      .post(`/spaces/${spaceA.body.id}/items`)
      .set('Cookie', authCookie)
      .send({ type: 'repo', name: 'repo-a', repo_path: '/repos/a' });

    const crossRes = await request(app)
      .get(`/spaces/${spaceB.body.id}/items/${itemRes.body.id}/tree`)
      .set('Cookie', authCookie);
    expect(crossRes.status).toBe(404);
  });

  it('rejects a tree request against a non-repo item', async () => {
    const space = await request(app).post('/spaces').set('Cookie', authCookie).send({ name: 'Space C' });
    const noteItem = await request(app)
      .post(`/spaces/${space.body.id}/items`)
      .set('Cookie', authCookie)
      .send({ type: 'note', name: 'a-note', content: 'hi' });

    const res = await request(app)
      .get(`/spaces/${space.body.id}/items/${noteItem.body.id}/tree`)
      .set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run tests/routes/spaces.test.ts`
Expected: FAIL — `/spaces` routes don't exist yet.

- [ ] **Step 3: Implement `spaces.ts`**

Start from the body of `server/src/routes/projects.ts` and apply this exact mapping (mechanical renames — copy each handler's existing body, only the listed names/paths change):

| Old (projects.ts) | New (spaces.ts) |
|---|---|
| `GET /` (project list) | `GET /` → calls `getSpacesForUser` |
| `POST /` | `POST /` → calls `createSpace` (no `repo_path` field in body) |
| `DELETE /:id` | `DELETE /:id` |
| `PATCH /:id` | `PATCH /:id` (drop `repo_path` from accepted body fields) |
| `GET /:id/tree` | `GET /:id/items/:itemId/tree` |
| `GET /:id/file` | `GET /:id/items/:itemId/file` |
| `GET /:id/plans` | `GET /:id/plans` (unchanged path, renamed function call to `getPlansForSpace`) |
| `GET /:id/capabilities` | `GET /:id/items/:itemId/capabilities` |
| `GET /:id/artifacts` | removed (no replacement route) |
| `GET /:id/artifacts/:artifactId/content` | removed (no replacement route) |
| `GET /:id/workspace` | `GET /:id/items/:itemId/workspace` |
| `PUT /:id/workspace` | `PUT /:id/items/:itemId/workspace` |
| `GET /:id/media` | `GET /:id/items/:itemId/media` |
| `GET /:id/media/:filename` | `GET /:id/items/:itemId/media/:filename` |
| `GET /:id/research` | `GET /:id/items/:itemId/research` |
| `GET /:id/research/:filename` | `GET /:id/items/:itemId/research/:filename` |

Additionally, find the existing pipelines router (`server/src/routes/pipelines.ts`, mounted separately per the earlier exploration noting `routes/pipelines.ts:64-73`). Re-mount it nested under spaces instead of at its own top-level path: change its mount point from `app.use('/pipelines', pipelinesRouter)` to `app.use('/spaces/:spaceId/pipelines', pipelinesRouter)`, and inside `pipelines.ts` replace every `req.body.user_id`/query-by-user-id lookup with `req.params.spaceId` (matching the migration's `pipelines.space_id` column from Task 1). Update its `POST /` (create pipeline) and `POST /:id/run` (run pipeline, creates a plan) handlers so the plan they create always uses `req.params.spaceId`, not a separately-supplied space/project id.

Add new item CRUD routes and a shared item-scope guard:

```typescript
// server/src/routes/spaces.ts (excerpt — item routes; combine with renamed routes above)
import { Router } from 'express';
import { createRepoItem, createFileItem, createNoteItem, getItemsForSpace, getItemById, deleteItem } from '../services/items.js';

const router = Router();

router.get('/:spaceId/items', (req, res) => {
  res.json(getItemsForSpace(req.params.spaceId));
});

router.post('/:spaceId/items', (req, res) => {
  const { type, name } = req.body as { type: 'repo' | 'file' | 'note'; name: string };
  if (type === 'repo') {
    return res.status(201).json(createRepoItem({ space_id: req.params.spaceId, name, repo_path: req.body.repo_path }));
  }
  if (type === 'file') {
    return res.status(201).json(createFileItem({ space_id: req.params.spaceId, name, file_path: req.body.file_path }));
  }
  return res.status(201).json(createNoteItem({ space_id: req.params.spaceId, name, content: req.body.content ?? '' }));
});

router.delete('/:spaceId/items/:itemId', (req, res) => {
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) return res.status(404).end();
  deleteItem(req.params.itemId);
  res.status(204).end();
});

// Shared guard used by every /:spaceId/items/:itemId/<sub-resource> route below.
function requireRepoItem(req: import('express').Request, res: import('express').Response): import('../services/items.js').SpaceItem | undefined {
  const item = getItemById(req.params.itemId);
  if (!item || item.space_id !== req.params.spaceId) {
    res.status(404).json({ error: 'item not found in this space' });
    return undefined;
  }
  if (item.type !== 'repo') {
    res.status(400).json({ error: `operation not supported for item type '${item.type}'` });
    return undefined;
  }
  return item;
}

router.get('/:spaceId/items/:itemId/tree', (req, res) => {
  const item = requireRepoItem(req, res);
  if (!item) return;
  // existing tree-listing logic from projects.ts's GET /:id/tree, now reading item.repo_path
  // instead of the space's old repo_path field.
});

export default router;
```

Apply the same `requireRepoItem` guard to `file`, `capabilities`, `workspace`, `media`, and `research` routes, reusing each handler's existing body from `projects.ts` but reading `item.repo_path` (from the guard's return value) instead of a space-level `repo_path`.

- [ ] **Step 4: Update route mounting**

Find where `projects.ts`'s router is mounted (grep `from '\.\./routes/projects` or `from './routes/projects'` in `server/src/index.ts`/`server/src/app.ts`). Replace:

```typescript
import projectsRouter from './routes/projects.js';
app.use('/projects', projectsRouter);
```

with:

```typescript
import spacesRouter from './routes/spaces.js';
app.use('/spaces', spacesRouter);
```

- [ ] **Step 5: Delete the old file**

Run: `git rm server/src/routes/projects.ts`

- [ ] **Step 6: Run to verify pass**

Run: `cd server && npx vitest run tests/routes/spaces.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/spaces.ts server/tests/routes/spaces.test.ts server/src/index.ts
git commit -m "feat(routes): rename projects routes to spaces, scope filesystem ops to items"
```

---

## Task 4: Agent worktree re-keying — `(repo_item_id, session_id)` instead of `(space_id, session_id)`

**Files:**
- Modify: `server/src/lib/worktree.ts` (`ensureWorktree` and any helper reading/writing `agent_worktrees`)
- Modify: `server/src/db/index.ts` (`getAgentWorktree`, `createAgentWorktree`, `setAgentWorktreeSession`, `updateAgentWorktreePath` — around lines 966-987 in the current codebase)
- Modify: `server/src/services/agent.ts:446,453,473,480,492,514` (every `ensureWorktree(project, sessionId)` call site)
- Test: `server/tests/lib/worktree.test.ts`

**Interfaces:**
- Consumes: `agent_worktrees` table re-keyed by Task 1's migration to `(item_id, session_id)`; `getItemsForSpace`, `getItemById` from Task 2.
- Produces: `ensureWorktree(repoItem: SpaceItem, sessionId: string)` — signature changes from `(project, sessionId)`. Consumed by `agent.ts`'s 6 call sites.

This task exists because the spec requires worktrees to be keyed by which *repo item* they're for, not which Space — a Space can now contain more than one repo, so `(space_id, session_id)` no longer identifies a worktree uniquely. The DB-level re-key already happened in Task 1's migration (`agent_worktrees.item_id` replacing `project_id`); this task updates the code that reads/writes that table to match.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/lib/worktree.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { createRepoItem } from '../../src/services/items.js';
import { ensureWorktree } from '../../src/lib/worktree.js';

beforeAll(() => {
  process.env.DATA_DIR = `/tmp/worktree-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, hashed_password) VALUES ('u1', 'a@b.com', 'h')`).run();
  db.prepare(`INSERT INTO spaces (id, user_id, name) VALUES ('sp1', 'u1', 'Space One')`).run();
  db.prepare(`INSERT INTO sessions (id, user_id) VALUES ('sess1', 'u1')`).run();
});

describe('ensureWorktree', () => {
  it('keys the worktree by (item_id, session_id), so two repo items in the same Space and session get distinct worktrees', async () => {
    const repoA = createRepoItem({ space_id: 'sp1', name: 'repo-a', repo_path: '/repos/a' });
    const repoB = createRepoItem({ space_id: 'sp1', name: 'repo-b', repo_path: '/repos/b' });

    const worktreeA = await ensureWorktree(repoA, 'sess1');
    const worktreeB = await ensureWorktree(repoB, 'sess1');

    expect(worktreeA.id).not.toBe(worktreeB.id);

    const row = getDb().prepare('SELECT item_id FROM agent_worktrees WHERE id = ?').get(worktreeA.id) as { item_id: string };
    expect(row.item_id).toBe(repoA.id);
  });

  it('reuses the same worktree for the same (item_id, session_id) pair', async () => {
    const repo = createRepoItem({ space_id: 'sp1', name: 'repo-c', repo_path: '/repos/c' });
    const first = await ensureWorktree(repo, 'sess1');
    const second = await ensureWorktree(repo, 'sess1');
    expect(first.id).toBe(second.id);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run tests/lib/worktree.test.ts`
Expected: FAIL — `ensureWorktree` still expects a `project`/`project_id` shape, not a `SpaceItem`.

- [ ] **Step 3: Implement**

In `server/src/db/index.ts`, update the four worktree DB functions (around lines 966-987) to take `itemId` instead of `projectId`:

```typescript
// Before: getAgentWorktree(projectId: string, sessionId: string)
// After:
export function getAgentWorktree(itemId: string, sessionId: string): AgentWorktree | undefined {
  return getDb()
    .prepare('SELECT * FROM agent_worktrees WHERE item_id = ? AND session_id = ?')
    .get(itemId, sessionId) as AgentWorktree | undefined;
}

// Before: createAgentWorktree(projectId: string, sessionId: string, branch: string, worktreePath: string)
// After:
export function createAgentWorktree(itemId: string, sessionId: string, branch: string, worktreePath: string): AgentWorktree {
  const id = newId();
  getDb()
    .prepare('INSERT INTO agent_worktrees (id, item_id, session_id, branch, worktree_path) VALUES (?, ?, ?, ?, ?)')
    .run(id, itemId, sessionId, branch, worktreePath);
  return getAgentWorktree(itemId, sessionId)!;
}
```

(`setAgentWorktreeSession` and `updateAgentWorktreePath` are unaffected beyond their existing `worktreeId` parameter — no `project_id`/`item_id` reference in their bodies, leave as-is.)

In `server/src/lib/worktree.ts`, update `ensureWorktree`'s signature and body to take the repo `SpaceItem` instead of a project:

```typescript
// Before: export async function ensureWorktree(project: Project, sessionId: string): Promise<AgentWorktree>
// After:
import type { SpaceItem } from '../services/items.js';

export async function ensureWorktree(repoItem: SpaceItem & { type: 'repo' }, sessionId: string): Promise<AgentWorktree> {
  const existing = getAgentWorktree(repoItem.id, sessionId);
  if (existing) return existing;
  const branch = `agent/${sessionId}`;
  const worktreePath = await createGitWorktree(repoItem.repo_path, branch); // existing helper, unchanged
  return createAgentWorktree(repoItem.id, sessionId, branch, worktreePath);
}
```

In `server/src/services/agent.ts`, update each of the 6 call sites (lines 446, 453, 473, 480, 492, 514) from `await ensureWorktree(project, sessionId)` to pass the resolved repo item instead. Since these call sites currently have a `project` in scope, replace that lookup with a repo-item lookup:

```typescript
// Before (repeated pattern at all 6 call sites):
// const worktree = await ensureWorktree(project, sessionId);

// After — resolve the Space's repo item once per call site (a Space may have
// zero or multiple repo items; per the spec's out-of-scope note, the UI
// preselects when there's exactly one, so this pass picks the first repo item
// found and throws clearly if there isn't one):
const repoItem = getItemsForSpace(space.id).find((item): item is SpaceItem & { type: 'repo' } => item.type === 'repo');
if (!repoItem) throw new Error(`Space ${space.id} has no repo item to run this tool against`);
const worktree = await ensureWorktree(repoItem, sessionId);
```

Add `import { getItemsForSpace } from './items.js';` near the top of `agent.ts` (Task 5 also needs this same import for its own item-creation changes — if Task 5 already added it by the time this task runs, skip the duplicate).

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run tests/lib/worktree.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: No failures referencing `ensureWorktree`, `agent_worktrees.project_id`, or the old `(project, sessionId)` signature.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/index.ts server/src/lib/worktree.ts server/src/services/agent.ts server/tests/lib/worktree.test.ts
git commit -m "feat(worktrees): re-key agent_worktrees by repo item instead of space, supporting multi-repo spaces"
```

---

## Task 5: `agent.ts` and `video.ts` — replace artifact creation with item creation

**Files:**
- Modify: `server/src/services/agent.ts:987-1013` (create_artifact dispatch block), `:346` (`SUB_TOOLS` set), `server/src/tools/definitions.ts` (tool schema for `create_artifact`)
- Modify: `server/src/services/video.ts:43-89` (`renderVideo`)
- Delete: `server/src/services/artifacts.ts`
- Test: `server/tests/services/agent-item-creation.test.ts`

**Interfaces:**
- Consumes: `createNoteItem`, `createFileItem` from `server/src/services/items.ts` (Task 2).
- Produces: `dispatchTool('create_item', ...)` replacing `dispatchTool('create_artifact', ...)`; `renderVideo` returns the created item's `id` instead of an artifact id.

- [ ] **Step 1: Write failing test**

```typescript
// server/tests/services/agent-item-creation.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { getItemsForSpace } from '../../src/services/items.js';

beforeAll(() => {
  process.env.DATA_DIR = `/tmp/agent-item-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, hashed_password) VALUES ('u1', 'a@b.com', 'h')`).run();
  db.prepare(`INSERT INTO spaces (id, user_id, name) VALUES ('sp1', 'u1', 'Space One')`).run();
  db.prepare(`INSERT INTO sessions (id, user_id) VALUES ('sess1', 'u1')`).run();
});

describe('create_item tool dispatch (replaces create_artifact)', () => {
  it('creates a note item with source_session_id set and no plan linkage from a plain chat call', async () => {
    const { dispatchTool } = await import('../../src/services/agent.js');
    await dispatchTool('create_item', { space_id: 'sp1', type: 'note', name: 'Plain Chat Note', content: 'hi' }, 'u1', 'msg1', 'sess1');

    const items = getItemsForSpace('sp1');
    const created = items.find(i => i.name === 'Plain Chat Note');
    expect(created?.source_session_id).toBe('sess1');
    expect(created?.source_plan_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run tests/services/agent-item-creation.test.ts`
Expected: FAIL — `create_item` tool not recognized by `dispatchTool`.

- [ ] **Step 3: Implement**

In `server/src/tools/definitions.ts`, rename the `create_artifact` tool definition to `create_item`: keep `title`→`name`, `content`, replace `kind`/`status`/`mime_type` parameters with a required `type: 'repo' | 'file' | 'note'` parameter, keep `plan_step_id` (optional) and add `space_id` (required, replacing `project_id`).

In `server/src/services/agent.ts`, replace the block at lines 987-1013:

```typescript
// Before (lines 987-1013, create_artifact):
// const artifactStepId = toolInput.plan_step_id as string | undefined;
// if (artifactStepId) await startPlanStep(userId, artifactStepId, executionId);
// const artifact = await createTextArtifact({ ...toolInput, source_step_id: artifactStepId ?? null });
// ...emits artifact_created session event...
// if (artifactStepId) await finishPlanStep(...)

// After:
case 'create_item': {
  const stepId = toolInput.plan_step_id as string | undefined;
  if (stepId) await startPlanStep(userId, stepId, executionId);

  const { space_id, type, name, content, repo_path, file_path } = toolInput as {
    space_id: string; type: 'repo' | 'file' | 'note'; name: string;
    content?: string; repo_path?: string; file_path?: string;
  };
  const provenance = { source_session_id: sessionId, source_plan_id: planId ?? null, source_step_id: stepId ?? null };

  const item =
    type === 'note' ? createNoteItem({ space_id, name, content: content ?? '', ...provenance })
    : type === 'repo' ? createRepoItem({ space_id, name, repo_path: repo_path ?? '', ...provenance })
    : createFileItem({ space_id, name, file_path: file_path ?? '', ...provenance });

  await emitSessionEvent(sessionId, { type: 'item_created', item_id: item.id });
  if (stepId) await finishPlanStep(userId, stepId, executionId);
  return JSON.stringify(item);
}
```

Add `import { createNoteItem, createRepoItem, createFileItem } from './items.js';` near the top of `agent.ts`. Rename `'create_artifact'` to `'create_item'` in the `SUB_TOOLS` set at line 346, and remove `'list_artifacts'`/`'read_artifact'` from that same set — no replacement tool exists yet (agents read items via direct `getItemsForSpace`/`getItemById` calls from within tool-handling code, not a separate dispatchable tool). Also delete the `list_artifacts` and `read_artifact` tool *definitions* themselves from `server/src/tools/definitions.ts` (their schema entries, not just the `SUB_TOOLS` set membership) — leaving the definitions in place while removing them from `SUB_TOOLS` would leave dead, unreachable schema entries.

In `server/src/services/video.ts`, replace the `createArtifact()` call at lines 77-86:

```typescript
// Before: createArtifact({ project_id: projectId, kind: 'media', status: 'ready', mime_type: 'video/mp4', path: `media/${fileName}`, url: ..., metadata: {...} })
// After:
import { createFileItem } from './items.js';

const item = createFileItem({
  space_id: spaceId,
  name: title,
  file_path: `media/${fileName}`,
  mime_type: 'video/mp4',
});
return item.id;
```

Update `renderVideo`'s signature to accept `spaceId` instead of `projectId` (rename the parameter; callers updated in Task 3's route rename).

Delete `server/src/services/artifacts.ts` (`createArtifact`, `createTextArtifact`, `resolveArtifactContentPath`, `getArtifactById`, `readArtifactContent`, `listProjectArtifacts` are all unused once the above lands).

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run tests/services/agent-item-creation.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: No failures referencing `create_artifact`, `artifacts.ts`, or `ProjectArtifact`. Fix any remaining references (e.g. in `server/src/routes/spaces.ts` if it still imports from the deleted `artifacts.ts`).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/agent.ts server/src/services/video.ts server/src/tools/definitions.ts server/tests/services/agent-item-creation.test.ts
git rm server/src/services/artifacts.ts
git commit -m "feat(agent): replace create_artifact tool with create_item, folding generated output into space_items"
```

---

## Task 6: Web types and API client rename

**Files:**
- Modify: `web/src/types.ts:1-9,93-116` (`Session`, `Project`, `ProjectArtifact`)
- Modify: `web/src/lib/api.ts:139-284` (project/artifact functions)
- Test: `web/src/lib/api.test.ts` (new, if no existing test file covers `api.ts` — check first with `ls web/src/lib/*.test.ts`)

**Interfaces:**
- Produces: `Space`, `SpaceItem` types; `getSpaces`, `createSpace`, `deleteSpace`, `updateSpace`, `getSpaceItems`, `createSpaceItem`, `deleteSpaceItem`, `getItemTree`, `getItemFile`, `getItemWorkspace`, `updateItemWorkspace`, `getItemCapabilities` functions — consumed by Task 7/8 (Sidebar, SpacePage).

- [ ] **Step 1: Update types**

In `web/src/types.ts`, replace lines 93-99 (`Project`) and 101-116 (`ProjectArtifact`):

```typescript
export interface Space {
  id: string;
  name: string;
  description: string | null;
  enabled_connection_ids: string[];
}

export type SpaceItemType = 'repo' | 'file' | 'note';

interface SpaceItemBase {
  id: string;
  space_id: string;
  type: SpaceItemType;
  name: string;
  source_session_id: string | null;
  source_plan_id: string | null;
  source_step_id: string | null;
  created_at: number;
}

export type SpaceItem =
  | (SpaceItemBase & { type: 'repo'; repo_path: string; default_branch: string | null })
  | (SpaceItemBase & { type: 'file'; file_path: string; size_bytes: number | null; mime_type: string | null })
  | (SpaceItemBase & { type: 'note'; content: string });
```

Update `Session` (lines 1-9): rename `pinned_project_id` to `pinned_space_id`.

- [ ] **Step 2: Update the API client**

In `web/src/lib/api.ts`, apply this exact rename mapping (each function's body is unchanged apart from the URL path and type names — copy the existing implementation, only swap the listed pieces):

| Old | New |
|---|---|
| `getProjects(): Promise<Project[]>` at `/projects` | `getSpaces(): Promise<Space[]>` at `/spaces` |
| `createProject(...)` at `POST /projects` | `createSpace(...)` at `POST /spaces` (drop `repo_path` from the payload type) |
| `deleteProject(id)` at `DELETE /projects/:id` | `deleteSpace(id)` at `DELETE /spaces/:id` |
| `updateProject(id, ...)` | `updateSpace(id, ...)` (drop `repo_path` field) |
| `getProjectTree(id)` | `getItemTree(spaceId, itemId)` at `/spaces/:spaceId/items/:itemId/tree` |
| `getProjectFile(id, path)` | `getItemFile(spaceId, itemId, path)` at `/spaces/:spaceId/items/:itemId/file` |
| `getProjectPlans(id)` | `getSpacePlans(id)` at `/spaces/:id/plans` |
| `getProjectWorkspace(id)` | `getItemWorkspace(spaceId, itemId)` at `/spaces/:spaceId/items/:itemId/workspace` |
| `updateProjectWorkspace(id, content)` | `updateItemWorkspace(spaceId, itemId, content)` |
| `getProjectCapabilities(id)` | `getItemCapabilities(spaceId, itemId)` |
| `getProjectArtifacts(id)` | removed, no replacement |
| `getArtifactContent(url)` | removed, no replacement |

Add new functions:

```typescript
export async function getSpaceItems(spaceId: string): Promise<SpaceItem[]> {
  const res = await fetch(`/spaces/${spaceId}/items`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch items');
  return res.json();
}

export async function createSpaceItem(
  spaceId: string,
  input: { type: SpaceItemType; name: string; repo_path?: string; file_path?: string; content?: string },
): Promise<SpaceItem> {
  const res = await fetch(`/spaces/${spaceId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create item');
  return res.json();
}

export async function deleteSpaceItem(spaceId: string, itemId: string): Promise<void> {
  const res = await fetch(`/spaces/${spaceId}/items/${itemId}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error('Failed to delete item');
}
```

- [ ] **Step 3: Grep for remaining references and fix call sites**

Run: `grep -rn "getProjects\|createProject\|deleteProject\|updateProject\|getProjectTree\|getProjectFile\|getProjectPlans\|getProjectWorkspace\|getProjectCapabilities\|getProjectArtifacts\|getArtifactContent\|pinned_project_id\b" web/src`

For each hit outside `api.ts`/`types.ts` (expected in `Sidebar.tsx`, `ProjectPage.tsx`, `ProjectsPage.tsx`, `PlanPage.tsx`), apply the same renames — these call sites get their full treatment in Tasks 6-7; for now just fix the import names and type references so the project type-checks.

- [ ] **Step 4: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: Errors only in files not yet touched by Tasks 6-7 (Sidebar.tsx, ProjectPage.tsx, ProjectsPage.tsx, PlanPage.tsx) — confirm the error list matches exactly those files.

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/lib/api.ts
git commit -m "feat(web): rename Project->Space and Project APIs->Space/Item APIs in types and API client"
```

---

## Task 7: Sidebar — contextual Space-scoped navigation

**Files:**
- Modify: `web/src/components/Sidebar.tsx` (full rewrite of the nav section; header/footer largely unchanged)
- Create: `web/src/components/SpaceSidebarSections.tsx` (the Space-scoped section list, rendered inside `Sidebar.tsx` when a Space is active)

**Interfaces:**
- Consumes: `getSpaces`, `Space` from Task 6.
- Produces: `Sidebar` renders Space-scoped sections when `location.pathname` starts with `/spaces/:id`; no second sidebar component is introduced.

- [ ] **Step 1: Determine active-Space context**

In `web/src/components/Sidebar.tsx`, replace the `Projects` `NavItem` (lines 124-130) and add Space-context detection:

```typescript
// NOTE: don't use useParams() here — Sidebar is rendered at the layout level,
// outside the <Route path="/spaces/:id/*"> element's component tree (that's
// SpacePage, a sibling, not an ancestor/descendant of Sidebar), so useParams()
// in Sidebar would never see `:id` regardless of what it's named. Parse the
// pathname directly instead.
// ...inside Sidebar component, alongside existing `location`/`navigate`:
const activeSpaceId = location.pathname.startsWith('/spaces/') ? location.pathname.split('/')[2] : null;
const activeSpace = activeSpaceId ? spaceById[activeSpaceId] : null; // spaceById, see Step 2 below
```

- [ ] **Step 2: Rename the `projects` query and add the switcher**

Replace lines 45-50 (`projects` query and `projectById`):

```typescript
const { data: spaces = [] } = useQuery<Space[]>({
  queryKey: ['spaces'],
  queryFn: getSpaces,
  staleTime: 60_000,
});
const spaceById = Object.fromEntries(spaces.map(s => [s.id, s]));
```

Replace every other reference to `projects`/`projectById`/`Project` in this file with `spaces`/`spaceById`/`Space` (the recent-chats list at lines 144, 166-171 references `project` for the chat's pinned project label — rename to `space` there too, and `chat.pinned_project_id` to `chat.pinned_space_id`).

- [ ] **Step 3: Render contextual sections**

Replace the `SidebarContent` block (lines 113-184) with a conditional:

```typescript
<SidebarContent>
  {activeSpace ? (
    <SpaceSidebarSections space={activeSpace} onNavigate={closeSidebar} />
  ) : (
    <>
      <SidebarGroup className="pb-1">
        <SidebarGroupContent>
          <SidebarMenu>
            <NavItem icon={<MessagesSquare size={15} strokeWidth={1.75} />} label="Chats" href="/chats" active={isActive('/chats')} onClick={closeSidebar} />
            <NavItem icon={<LayoutGrid size={15} strokeWidth={1.75} />} label="Spaces" href="/spaces" active={isActive('/spaces')} onClick={closeSidebar} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {/* existing recent-chats block, lines 135-183, unchanged apart from the spaceById rename above */}
    </>
  )}
</SidebarContent>
```

- [ ] **Step 4: Implement `SpaceSidebarSections`**

```typescript
// web/src/components/SpaceSidebarSections.tsx
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, LayoutDashboard, MessagesSquare, Boxes, ListTodo, Settings as SettingsIcon } from 'lucide-react';
import { getSpaces } from '../lib/api.js';
import type { Space } from '../types.js';
import {
  SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
} from '@/components/ui/sidebar';
import { cn } from '../lib/utils.js';

export default function SpaceSidebarSections({ space, onNavigate }: { space: Space; onNavigate?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const { data: spaces = [] } = useQuery<Space[]>({ queryKey: ['spaces'], queryFn: getSpaces, staleTime: 60_000 });

  const base = `/spaces/${space.id}`;
  const isActive = (suffix: string) => suffix === '' ? location.pathname === base : location.pathname.startsWith(`${base}/${suffix}`);

  return (
    <>
      <SidebarGroup className="pb-1">
        <SidebarGroupContent>
          <button
            onClick={() => setSwitcherOpen(o => !o)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm font-semibold hover:bg-sidebar-accent"
          >
            <span className="truncate">{space.name}</span>
            {switcherOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {switcherOpen && (
            <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-sidebar-border">
              <button
                onClick={() => { navigate('/spaces'); onNavigate?.(); }}
                className="w-full px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent"
              >
                All Spaces
              </button>
              {spaces.filter(s => s.id !== space.id).map(s => (
                <button
                  key={s.id}
                  onClick={() => { navigate(`/spaces/${s.id}`); setSwitcherOpen(false); onNavigate?.(); }}
                  className="w-full truncate px-2.5 py-1.5 text-left text-xs hover:bg-sidebar-accent"
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup className="min-h-0 flex-1 pt-1">
        <SidebarGroupContent>
          <SidebarMenu>
            <SectionLink href={base} icon={<LayoutDashboard size={15} strokeWidth={1.75} />} label="Overview" active={isActive('')} onClick={onNavigate} />
            <SectionLink href={`${base}/chats`} icon={<MessagesSquare size={15} strokeWidth={1.75} />} label="Chats" active={isActive('chats')} onClick={onNavigate} />
            <SectionLink href={`${base}/items`} icon={<Boxes size={15} strokeWidth={1.75} />} label="Items" active={isActive('items')} onClick={onNavigate} />
            <SectionLink href={`${base}/plans`} icon={<ListTodo size={15} strokeWidth={1.75} />} label="Plans" active={isActive('plans')} onClick={onNavigate} />
            <SectionLink href={`${base}/settings`} icon={<SettingsIcon size={15} strokeWidth={1.75} />} label="Settings" active={isActive('settings')} onClick={onNavigate} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function SectionLink({ href, icon, label, active, onClick }: { href: string; icon: React.ReactNode; label: string; active: boolean; onClick?: () => void }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        className={cn(
          'h-9 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
          active && 'bg-sidebar-accent text-foreground shadow-xs ring-1 ring-sidebar-border/60',
        )}
      >
        <Link to={href} onClick={onClick}>
          {icon}
          <span className="flex-1">{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

(Pipelines is intentionally not a separate `SectionLink` — Task 8 nests it inside the Plans page itself, per the spec's "Pipelines becomes a sub-item under Plans" decision.)

- [ ] **Step 2: Manual verification**

Run: `cd web && npm run dev`, navigate to `/spaces`, click into a Space, confirm the sidebar swaps to the 5 sections above with a working switcher, then navigate back to `/chats` and confirm the sidebar reverts to the global Chats/Spaces nav.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Sidebar.tsx web/src/components/SpaceSidebarSections.tsx
git commit -m "feat(web): make Sidebar contextual for Space-scoped navigation, replacing ProjectPage's tab strip"
```

---

## Task 8: `SpacePage` — replace `ProjectPage`'s tab strip with routed sections; Items list with type filter

**Files:**
- Create: `web/src/pages/SpacePage.tsx` (replaces `web/src/pages/ProjectPage.tsx`)
- Create: `web/src/pages/SpaceItemsSection.tsx`
- Delete: `web/src/pages/ProjectPage.tsx`, any `ArtifactsTab.tsx`
- Modify: routing config (likely `web/src/App.tsx:30-37`) and `web/src/pages/ProjectsPage.tsx` → rename to `SpacesPage.tsx`

**Interfaces:**
- Consumes: `getSpaces`, `getSpaceItems`, `createSpaceItem`, `deleteSpaceItem`, `Space`, `SpaceItem` from Task 6; `SpaceSidebarSections` from Task 7 (rendered by the global `Sidebar`, not by this page).

- [ ] **Step 1: Update routing**

In `web/src/App.tsx` (around lines 30-37), replace:

```typescript
<Route path="/projects" element={<ProjectsPage />} />
<Route path="/projects/:id/*" element={<ProjectPage />} />
```

with:

```typescript
<Route path="/spaces" element={<SpacesPage />} />
<Route path="/spaces/:id/*" element={<SpacePage />} />
```

- [ ] **Step 2: Rename `ProjectsPage` → `SpacesPage`**

`git mv web/src/pages/ProjectsPage.tsx web/src/pages/SpacesPage.tsx`, then update its internal references (`getProjects`/`createProject`/`Project` → `getSpaces`/`createSpace`/`Space`, and the link target from `/projects/:id` to `/spaces/:id`).

- [ ] **Step 3: Implement `SpacePage`**

```typescript
// web/src/pages/SpacePage.tsx
import { Routes, Route, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSpaces } from '../lib/api.js';
import type { Space } from '../types.js';
import SpaceOverview from './SpaceOverview.js';
import SpaceChats from './SpaceChats.js';
import SpaceItemsSection from './SpaceItemsSection.js';
import SpacePlans from './SpacePlans.js';
import SpaceSettings from './SpaceSettings.js';

export default function SpacePage() {
  const { id } = useParams<{ id: string }>();
  const { data: spaces = [] } = useQuery<Space[]>({ queryKey: ['spaces'], queryFn: getSpaces, staleTime: 60_000 });
  const space = spaces.find(s => s.id === id);

  if (!space) return null;

  return (
    <Routes>
      <Route index element={<SpaceOverview space={space} />} />
      <Route path="chats" element={<SpaceChats space={space} />} />
      <Route path="items/*" element={<SpaceItemsSection space={space} />} />
      <Route path="plans/*" element={<SpacePlans space={space} />} />
      <Route path="settings" element={<SpaceSettings space={space} />} />
    </Routes>
  );
}
```

(`SpaceOverview`, `SpaceChats`, `SpaceSettings` are extracted 1:1 from `ProjectPage.tsx`'s existing `overview`/`chats`/`settings` tab bodies — same JSX and queries, just hoisted into their own files and taking `space: Space` as a prop instead of reading `project` from shared tab state. `SpaceSettings` additionally drops the `repo_path` form field per the spec; repo management moves to `SpaceItemsSection`.

`SpacePlans` is the one section that merges two old tabs: it renders the existing `plans` tab body unchanged, plus a "Pipelines" sub-section below it (the old `pipelines` tab's existing list/run-pipeline UI, calling the now-nested `/spaces/:spaceId/pipelines` routes from Task 3's pipelines remount) — matching the spec's "Pipelines becomes a sub-item under Plans, not its own top-level section." No separate `plans/pipelines` route is needed; it's one page with two stacked sections, since the spec calls for an expandable group, not a distinct nested route.)

- [ ] **Step 4: Implement `SpaceItemsSection` with type filter chips**

```typescript
// web/src/pages/SpaceItemsSection.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSpaceItems } from '../lib/api.js';
import type { Space, SpaceItem, SpaceItemType } from '../types.js';

const TYPE_LABELS: Record<SpaceItemType, string> = { repo: 'Repos', file: 'Files', note: 'Notes' };

export default function SpaceItemsSection({ space }: { space: Space }) {
  const [typeFilter, setTypeFilter] = useState<SpaceItemType | 'all'>('all');
  const { data: items = [] } = useQuery<SpaceItem[]>({
    queryKey: ['space-items', space.id],
    queryFn: () => getSpaceItems(space.id),
  });

  const visible = typeFilter === 'all' ? items : items.filter(i => i.type === typeFilter);
  const availableTypes = Array.from(new Set(items.map(i => i.type)));

  return (
    <div className="p-4">
      <div className="mb-3 flex gap-2">
        <FilterChip label="All" active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
        {availableTypes.map(t => (
          <FilterChip key={t} label={TYPE_LABELS[t]} active={typeFilter === t} onClick={() => setTypeFilter(t)} />
        ))}
      </div>
      <ul className="flex flex-col gap-1">
        {visible.map(item => (
          <li key={item.id} className="flex items-center justify-between rounded-lg border border-sidebar-border px-3 py-2">
            <div>
              <div className="text-sm font-medium">{item.name}</div>
              {item.source_plan_id && (
                <div className="text-xs text-muted-foreground">Generated by plan {item.source_plan_id}</div>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{TYPE_LABELS[item.type]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ${active ? 'bg-primary text-primary-foreground' : 'bg-sidebar-accent text-muted-foreground'}`}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 5: Delete obsolete files**

```bash
git rm web/src/pages/ProjectPage.tsx
find web/src -iname "ArtifactsTab.tsx" -o -iname "ArtifactPreviewCard.tsx" -o -iname "ArtifactsTab.test.tsx" | xargs -r git rm
```

- [ ] **Step 6: Type-check and manual verification**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

Run: `cd web && npm run dev`, create a Space, attach a repo item via Settings/Items, confirm the Items list shows it with a "Repos" filter chip, confirm Overview/Chats/Plans/Settings sections render without the old tab strip.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/SpacePage.tsx web/src/pages/SpaceItemsSection.tsx web/src/pages/SpacesPage.tsx web/src/App.tsx
git commit -m "feat(web): replace ProjectPage's 7-tab strip with routed Space sections and a generic Items list"
```

---

## Task 9: Final sweep — verify no `project`/`artifact` identifiers remain, full test pass

**Files:** none new — verification only.

- [ ] **Step 1: Grep for stragglers**

```bash
grep -rln "project_id\|ProjectPage\|getProjectArtifacts\|ProjectArtifact\|pinned_project_id\|ensureWorktree(project\|agent_worktrees.*project_id" server/src web/src
```

Expected: no output. Fix any remaining hit by applying the same rename used in its neighboring code (Tasks 1-7 cover every category of reference; a straggler means a missed call site, not a new pattern).

- [ ] **Step 2: Run full test suites**

```bash
cd server && npx vitest run
cd web && npx tsc --noEmit
```

Expected: all server tests pass; web type-checks clean.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: sweep remaining project/artifact references after Spaces rename"
```
