import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { newId } from '../lib/ids.js';
import { runMigrations, type Migration } from './migrate.js';
import { backupDatabase } from './backup.js';

let db: Database.Database;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, '../../../data');

export function getDataDir(): string {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : defaultDataDir;
}

// Rebuilds every table whose CREATE TABLE statement references `referencedTable`
// so the references point at its current schema, then runs `createReferenced`
// to recreate `referencedTable` itself. SQLite auto-rewrites a table's FK
// reference text when the table it points at is renamed, so naively renaming
// `referencedTable` out of the way and dropping it afterward leaves every
// child table pointing at a name that no longer exists. Capturing each
// child's CREATE SQL before the rename (still saying `referencedTable`)
// and replaying it after recreation keeps every FK correct.
function rebuildTableAndReferencingTables(
  database: Database.Database,
  referencedTable: string,
  createReferenced: string,
): void {
  const referencing = database
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name != ? AND sql LIKE ?",
    )
    .all(referencedTable, `%REFERENCES ${referencedTable}(id)%`) as { name: string; sql: string }[];

  const tmpName = `_${referencedTable}_rebuild_tmp`;
  database.pragma('foreign_keys = OFF');
  database.exec(`ALTER TABLE ${referencedTable} RENAME TO ${tmpName};`);
  database.exec(createReferenced);
  database.exec(`INSERT INTO ${referencedTable} SELECT * FROM ${tmpName};`);

  for (const { name, sql } of referencing) {
    const childTmp = `_${name}_rebuild_tmp`;
    const cols = (database.prepare(`SELECT name FROM pragma_table_info('${name}')`).all() as { name: string }[])
      .map(c => c.name)
      .join(', ');
    database.exec(`ALTER TABLE ${name} RENAME TO ${childTmp};`);
    database.exec(sql); // captured before the rename, so it still says `referencedTable`
    database.exec(`INSERT INTO ${name} (${cols}) SELECT ${cols} FROM ${childTmp};`);
    database.exec(`DROP TABLE ${childTmp};`);
  }

  database.exec(`DROP TABLE ${tmpName};`);
  database.pragma('foreign_keys = ON');
}

export function addDocumentItems(database: Database.Database): void {
  // 1. Widen space_items.type CHECK to include 'document'. Every table that
  // references space_items (space_repos, space_files, space_notes,
  // agent_worktrees, session_events, ...) gets rebuilt too so its FK still
  // points at the live table — see rebuildTableAndReferencingTables.
  const itemsSql = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='space_items'").get() as { sql: string } | undefined)?.sql;
  if (itemsSql && !itemsSql.includes("'document'")) {
    rebuildTableAndReferencingTables(
      database,
      'space_items',
      `CREATE TABLE space_items (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('repo','file','note','document')),
        name TEXT NOT NULL,
        source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        source_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
        source_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );`,
    );
  }

  // 2. Create space_documents table
  database.exec(`
    CREATE TABLE IF NOT EXISTS space_documents (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      template TEXT NOT NULL DEFAULT 'document',
      blocks TEXT NOT NULL DEFAULT '[]'
    );
  `);

  // 3. Add overview_blocks column to space_repos if missing
  const repoCols = database.prepare("SELECT name FROM pragma_table_info('space_repos')").all() as { name: string }[];
  if (!repoCols.some(c => c.name === 'overview_blocks')) {
    database.exec('ALTER TABLE space_repos ADD COLUMN overview_blocks TEXT');
  }

  // 4. Widen session_events.type CHECK to include 'item_updated'
  const eventsSql = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'").get() as { sql: string } | undefined)?.sql;
  if (eventsSql && !eventsSql.includes("'item_updated'")) {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE session_events RENAME TO session_events_pre_v9;
      CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN (
          'scope_changed','project_linked','project_created','plan_created',
          'artifact_created','item_created','item_updated','approval_requested','approval_resolved',
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
      INSERT INTO session_events SELECT * FROM session_events_pre_v9;
      DROP TABLE session_events_pre_v9;
      PRAGMA foreign_keys = ON;
    `);
  }
}

const BUILTIN_BLOCK_TEMPLATES: { id: string; name: string; blocks: unknown[] }[] = [
  { id: 'tpl_document', name: 'Document', blocks: [{ type: 'text', content: '' }] },
  {
    id: 'tpl_spec',
    name: 'Spec',
    blocks: [
      { type: 'heading', level: 1, text: 'Overview' },
      { type: 'callout', variant: 'info', content: 'Describe the problem this solves.' },
      { type: 'heading', level: 2, text: 'Approach' },
      { type: 'text', content: '' },
      { type: 'heading', level: 2, text: 'Success Criteria' },
      { type: 'task-list', tasks: [] },
      { type: 'heading', level: 2, text: 'Open Questions' },
      { type: 'task-list', tasks: [] },
    ],
  },
  {
    id: 'tpl_kanban',
    name: 'Kanban',
    blocks: [
      { type: 'heading', level: 1, text: 'Tasks' },
      { type: 'heading', level: 2, text: 'To Do' },
      { type: 'task-list', tasks: [] },
      { type: 'heading', level: 2, text: 'In Progress' },
      { type: 'task-list', tasks: [] },
      { type: 'heading', level: 2, text: 'Done' },
      { type: 'task-list', tasks: [] },
    ],
  },
  {
    id: 'tpl_report',
    name: 'Report',
    blocks: [
      { type: 'heading', level: 1, text: 'Report' },
      { type: 'text', content: '' },
      { type: 'heading', level: 2, text: 'Details' },
      { type: 'text', content: '' },
    ],
  },
];

const LEGACY_TEMPLATE_KEY_TO_ID: Record<string, string> = {
  document: 'tpl_document',
  spec: 'tpl_spec',
  kanban: 'tpl_kanban',
  report: 'tpl_report',
};

export function addItemTemplates(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS item_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('system', 'blocks')),
      name TEXT NOT NULL,
      blocks TEXT,
      item_type TEXT NOT NULL CHECK(item_type IN ('repo', 'file', 'note', 'document')),
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const insertTemplate = database.prepare(`
    INSERT OR IGNORE INTO item_templates (id, user_id, kind, name, blocks, item_type, is_builtin)
    VALUES (?, NULL, ?, ?, ?, ?, 1)
  `);
  insertTemplate.run('tpl_repo', 'system', 'Repo', null, 'repo');
  insertTemplate.run('tpl_file', 'system', 'File', null, 'file');
  insertTemplate.run('tpl_note', 'system', 'Note', null, 'note');
  for (const t of BUILTIN_BLOCK_TEMPLATES) {
    insertTemplate.run(t.id, 'blocks', t.name, JSON.stringify(t.blocks), 'document');
  }

  const remap = database.prepare("UPDATE space_documents SET template = ? WHERE template = ?");
  for (const [legacyKey, id] of Object.entries(LEGACY_TEMPLATE_KEY_TO_ID)) {
    remap.run(id, legacyKey);
  }
}

// Ordered, versioned schema migrations. Version 1 is the baseline: the full
// historical schema plus every in-place migration that predates this runner,
// kept idempotent so it lands any existing or fresh database at today's schema
// and stamps user_version = 1. New schema changes append as version 2, 3, …
// (use noTransaction + self-managed PRAGMAs for table rebuilds).
export const migrations: Migration[] = [
  { version: 1, name: 'baseline-schema', noTransaction: true, up: () => applySchema() },
  { version: 2, name: 'repair-plan-foreign-keys', noTransaction: true, up: repairPlanForeignKeys },
  { version: 3, name: 'tool-registry', up: addToolRegistry },
  { version: 4, name: 'widen-connection-type-for-local', noTransaction: true, up: widenConnectionsTypeForLocal },
  { version: 5, name: 'rename-projects-to-spaces-and-add-items', noTransaction: true, up: renameProjectsToSpacesAndAddItems },
  { version: 6, name: 'add-user-settings-columns', noTransaction: true, up: (database) => {
    const tableExists = (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_settings'").get());
    if (!tableExists) return;
    const cols = (database.prepare("SELECT name FROM pragma_table_info('user_settings')").all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('claude_code_daily_budget_usd')) database.exec('ALTER TABLE user_settings ADD COLUMN claude_code_daily_budget_usd REAL');
    if (!cols.includes('codex_daily_budget_usd')) database.exec('ALTER TABLE user_settings ADD COLUMN codex_daily_budget_usd REAL');
    if (!cols.includes('permission_profile')) database.exec("ALTER TABLE user_settings ADD COLUMN permission_profile TEXT NOT NULL DEFAULT 'fast' CHECK(permission_profile IN ('fast','trusted','strict'))");
    if (!cols.includes('expo_push_token')) database.exec('ALTER TABLE user_settings ADD COLUMN expo_push_token TEXT');
    if (!cols.includes('apns_device_token')) database.exec('ALTER TABLE user_settings ADD COLUMN apns_device_token TEXT');
  }},
  { version: 7, name: 'finalize-spaces-items-and-pipelines', noTransaction: true, up: finalizeSpacesItemsAndPipelines },
  { version: 8, name: 'repair-pipeline-space-foreign-key', noTransaction: true, up: repairPipelineSpaceForeignKey },
  { version: 9, name: 'add-document-items', noTransaction: true, up: addDocumentItems },
  { version: 10, name: 'repair-document-items-foreign-keys', noTransaction: true, up: repairDocumentItemsForeignKeys },
  { version: 11, name: 'add-item-templates', noTransaction: true, up: addItemTemplates },
];

function tableSql(database: Database.Database, name: string): string | undefined {
  return (database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { sql: string } | undefined)?.sql;
}

/**
 * The campaigns→plans / campaign_tasks→plan_steps rename used
 * `legacy_alter_table = ON`, which deliberately does NOT rewrite foreign-key
 * references in other tables. That left `plan_steps.plan_id` pointing at the
 * dropped `campaigns` table, and `artifacts.source_plan_id` / `source_step_id`
 * pointing at the dropped `campaigns` / `campaign_tasks` tables. With
 * `foreign_keys = ON`, SQLite validates those on every INSERT, so creating a
 * plan step or an artifact failed with "no such table: campaigns". Rebuild both
 * with the FK targets corrected to `plans` / `plan_steps`. plan_steps is rebuilt
 * first because artifacts references it.
 */
function repairPlanForeignKeys(database: Database.Database): void {
  const planStepsSql = tableSql(database, 'plan_steps');
  if (planStepsSql && planStepsSql.includes('campaigns')) {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE plan_steps RENAME TO plan_steps_fk_repair;
      PRAGMA legacy_alter_table = OFF;
      CREATE TABLE plan_steps (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        agent TEXT NOT NULL CHECK(agent IN ('claude_code','codex','mcp','file_write','git','github','eval','subagent')),
        status TEXT NOT NULL DEFAULT 'waiting'
          CHECK(status IN ('waiting','running','done','error')),
        execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
        position INTEGER NOT NULL,
        prompt TEXT,
        depends_on TEXT,
        tool_args TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER
      );
      INSERT INTO plan_steps (
        id, plan_id, title, agent, status, execution_id, position, prompt, depends_on, tool_args, created_at, completed_at
      )
      SELECT
        id, plan_id, title, agent, status, execution_id, position, prompt, depends_on, tool_args, created_at, completed_at
      FROM plan_steps_fk_repair;
      DROP TABLE plan_steps_fk_repair;
      PRAGMA foreign_keys = ON;
    `);
  }

  const artifactsSql = tableSql(database, 'artifacts');
  if (artifactsSql && (artifactsSql.includes('campaign_tasks') || artifactsSql.includes('campaigns'))) {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE artifacts RENAME TO artifacts_fk_repair;
      PRAGMA legacy_alter_table = OFF;
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'ready'
          CHECK(status IN ('ready','review','running','error')),
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        path TEXT,
        url TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        source_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
        source_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO artifacts (
        id, project_id, kind, title, description, status, mime_type, path, url, metadata,
        source_plan_id, source_step_id, created_at
      )
      SELECT
        id, project_id, kind, title, description, status, mime_type, path, url, metadata,
        source_plan_id, source_step_id, created_at
      FROM artifacts_fk_repair;
      DROP TABLE artifacts_fk_repair;
      PRAGMA foreign_keys = ON;
    `);
  }
}

function addToolRegistry(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tool_registry (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      mcp_tool_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      input_schema TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(connection_id, mcp_tool_name),
      UNIQUE(user_id, tool_name)
    );
  `);

  const sessionCols = database.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionCols.some(c => c.name === 'discovered_tools')) {
    database.exec("ALTER TABLE sessions ADD COLUMN discovered_tools TEXT NOT NULL DEFAULT '[]'");
  }
}

function widenConnectionsTypeForLocal(database: Database.Database): void {
  const sql = tableSql(database, 'connections');
  if (!sql || sql.includes("'local'")) return; // already applied
  database.exec(`
    PRAGMA foreign_keys = OFF;
    PRAGMA legacy_alter_table = ON;
    ALTER TABLE connections RENAME TO connections_pre_local_type;
    PRAGMA legacy_alter_table = OFF;
    CREATE TABLE connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('anthropic','openai','github','mcp','local')),
      purpose TEXT NOT NULL DEFAULT 'tool',
      encrypted_config TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );
    INSERT INTO connections SELECT * FROM connections_pre_local_type;
    DROP TABLE connections_pre_local_type;
    PRAGMA foreign_keys = ON;
  `);
}

function renameProjectsToSpacesAndAddItems(database: Database.Database): void {
  database.pragma('foreign_keys = OFF');

  const projectsTableExists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
    .get();
  if (projectsTableExists) {
    database.pragma('legacy_alter_table = OFF');
    database.exec('ALTER TABLE projects RENAME TO spaces');
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

  const repoPathColumnExists = (database.prepare('PRAGMA table_info(spaces)').all() as Array<{ name: string }>)
    .some(column => column.name === 'repo_path');
  if (repoPathColumnExists) {
    const spaces = database
      .prepare('SELECT id, name, repo_path FROM spaces WHERE repo_path IS NOT NULL')
      .all() as Array<{ id: string; name: string; repo_path: string }>;
    const insertItem = database.prepare(
      "INSERT INTO space_items (id, space_id, type, name) VALUES (?, ?, 'repo', ?)",
    );
    const insertRepo = database.prepare('INSERT INTO space_repos (item_id, repo_path) VALUES (?, ?)');
    const itemExists = database.prepare('SELECT 1 FROM space_items WHERE id = ?');
    for (const space of spaces) {
      const itemId = `item_${space.id}_repo`;
      if (itemExists.get(itemId)) continue;
      insertItem.run(itemId, space.id, space.name);
      insertRepo.run(itemId, space.repo_path);
    }
  }

  const worktreeColumns = database.prepare('PRAGMA table_info(agent_worktrees)').all() as Array<{ name: string }>;
  if (worktreeColumns.some(column => column.name === 'project_id')) {
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
      INSERT INTO agent_worktrees (
        id, item_id, session_id, branch, worktree_path,
        claude_session_id, codex_session_id, created_at
      )
      SELECT
        worktree.id, 'item_' || worktree.space_id || '_repo', worktree.session_id,
        worktree.branch, worktree.worktree_path, worktree.claude_session_id,
        worktree.codex_session_id, worktree.created_at
      FROM agent_worktrees_pre_v5 worktree
      WHERE EXISTS (
        SELECT 1 FROM space_items WHERE id = 'item_' || worktree.space_id || '_repo'
      );
      DROP TABLE agent_worktrees_pre_v5;
    `);
  }

  const artifactsExist = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'")
    .get();
  if (artifactsExist) {
    const artifactColumns = database.prepare('PRAGMA table_info(artifacts)').all() as Array<{ name: string }>;
    const artifactSpaceColumn = artifactColumns.some(column => column.name === 'space_id') ? 'space_id' : 'project_id';
    const artifacts = database.prepare('SELECT * FROM artifacts').all() as Array<{
      id: string;
      project_id?: string;
      space_id?: string;
      title: string;
      mime_type: string;
      path: string | null;
      source_plan_id: string | null;
      source_step_id: string | null;
    }>;
    const insertItem = database.prepare(`
      INSERT INTO space_items (
        id, space_id, type, name, source_plan_id, source_step_id
      ) VALUES (?, ?, 'file', ?, ?, ?)
    `);
    const insertFile = database.prepare(
      'INSERT INTO space_files (item_id, file_path, mime_type) VALUES (?, ?, ?)',
    );
    const itemExists = database.prepare('SELECT 1 FROM space_items WHERE id = ?');
    for (const artifact of artifacts) {
      const itemId = `item_${artifact.id}`;
      if (itemExists.get(itemId)) continue;
      const artifactSpaceId = artifactSpaceColumn === 'space_id' ? artifact.space_id : artifact.project_id;
      if (!artifactSpaceId) continue;
      insertItem.run(
        itemId,
        artifactSpaceId,
        artifact.title,
        artifact.source_plan_id,
        artifact.source_step_id,
      );
      insertFile.run(itemId, artifact.path ?? '', artifact.mime_type);
    }
  }

  const eventColumns = database.prepare('PRAGMA table_info(session_events)').all() as Array<{ name: string }>;
  if (eventColumns.some(column => column.name === 'artifact_id')) {
    const eventProjectColumn = eventColumns.some(column => column.name === 'project_id')
      ? 'project_id'
      : 'space_id';
    database.exec(`
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
      INSERT INTO session_events (
        id, session_id, type, title, body, space_id, plan_id,
        item_id, execution_id, metadata, created_at
      )
      SELECT
        id, session_id, type, title, body, ${eventProjectColumn}, plan_id,
        CASE WHEN artifact_id IS NOT NULL THEN 'item_' || artifact_id ELSE NULL END,
        execution_id, metadata, created_at
      FROM session_events_pre_v5;
      DROP TABLE session_events_pre_v5;
    `);
  }

  if (artifactsExist) database.exec('DROP TABLE artifacts');
  if (repoPathColumnExists) database.exec('ALTER TABLE spaces DROP COLUMN repo_path');

  const sessionColumns = database.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  if (sessionColumns.some(column => column.name === 'pinned_project_id')) {
    database.exec('ALTER TABLE sessions RENAME COLUMN pinned_project_id TO pinned_space_id');
  }

  const pipelineColumns = database.prepare('PRAGMA table_info(pipelines)').all() as Array<{ name: string }>;
  if (pipelineColumns.some(column => column.name === 'user_id')) {
    database.pragma('legacy_alter_table = ON');
    database.exec('ALTER TABLE pipelines RENAME TO pipelines_pre_v5');
    database.pragma('legacy_alter_table = OFF');
    database.exec(`
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO pipelines (id, space_id, title, description, created_at)
      SELECT pipeline.id, (
        SELECT space.id
        FROM spaces space
        WHERE space.user_id = pipeline.user_id
        ORDER BY space.created_at, space.id
        LIMIT 1
      ), pipeline.title, pipeline.description, pipeline.created_at
      FROM pipelines_pre_v5 pipeline
      WHERE EXISTS (SELECT 1 FROM spaces space WHERE space.user_id = pipeline.user_id);
      DROP TABLE pipelines_pre_v5;
    `);
  }

  const tablesWithProjectId = database.prepare(`
    SELECT schema.name AS table_name
    FROM sqlite_master schema
    JOIN pragma_table_info(schema.name) columns ON columns.name = 'project_id'
    WHERE schema.type = 'table'
  `).all() as Array<{ table_name: string }>;
  for (const { table_name } of tablesWithProjectId) {
    database.exec(`ALTER TABLE "${table_name}" RENAME COLUMN project_id TO space_id`);
  }

  database.pragma('foreign_keys = ON');
}

function finalizeSpacesItemsAndPipelines(database: Database.Database): void {
  database.pragma('foreign_keys = OFF');

  const artifactsExist = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'")
    .get();
  if (artifactsExist) {
    const columns = database.prepare('PRAGMA table_info(artifacts)').all() as Array<{ name: string }>;
    const spaceColumn = columns.some(column => column.name === 'space_id') ? 'space_id' : 'project_id';
    const artifacts = database.prepare('SELECT * FROM artifacts').all() as Array<{
      id: string;
      space_id?: string;
      project_id?: string;
      title: string;
      mime_type: string;
      path: string | null;
      source_plan_id: string | null;
      source_step_id: string | null;
      created_at: number;
    }>;
    const insertItem = database.prepare(`
      INSERT OR IGNORE INTO space_items (
        id, space_id, type, name, source_plan_id, source_step_id, created_at
      ) VALUES (?, ?, 'file', ?, ?, ?, ?)
    `);
    const insertFile = database.prepare(`
      INSERT OR IGNORE INTO space_files (item_id, file_path, mime_type)
      VALUES (?, ?, ?)
    `);
    for (const artifact of artifacts) {
      const itemId = `item_${artifact.id}`;
      const spaceId = spaceColumn === 'space_id' ? artifact.space_id : artifact.project_id;
      if (!spaceId) continue;
      insertItem.run(
        itemId,
        spaceId,
        artifact.title,
        artifact.source_plan_id,
        artifact.source_step_id,
        artifact.created_at,
      );
      insertFile.run(itemId, artifact.path ?? '', artifact.mime_type);
      database.prepare('UPDATE session_events SET item_id = ? WHERE item_id = ?').run(itemId, artifact.id);
    }
    database.exec('DROP TABLE artifacts');
  }

  database.pragma('foreign_keys = ON');
}

function repairPipelineSpaceForeignKey(database: Database.Database): void {
  const pipelineSql = tableSql(database, 'pipelines');
  if (!pipelineSql || /REFERENCES\s+["`]?spaces["`]?/i.test(pipelineSql)) return;

  database.pragma('foreign_keys = OFF');
  database.pragma('legacy_alter_table = ON');
  database.exec('ALTER TABLE pipelines RENAME TO pipelines_pre_v8');
  database.pragma('legacy_alter_table = OFF');
  database.exec(`
    CREATE TABLE pipelines (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT INTO pipelines (id, space_id, title, description, created_at)
    SELECT
      pipeline.id,
      CASE
        WHEN EXISTS (SELECT 1 FROM spaces WHERE id = pipeline.space_id)
          THEN pipeline.space_id
        ELSE (
          SELECT space.id
          FROM spaces space
          WHERE space.user_id = pipeline.space_id
          ORDER BY space.created_at, space.id
          LIMIT 1
        )
      END,
      pipeline.title,
      pipeline.description,
      pipeline.created_at
    FROM pipelines_pre_v8 pipeline
    WHERE EXISTS (SELECT 1 FROM spaces WHERE id = pipeline.space_id)
       OR EXISTS (SELECT 1 FROM spaces WHERE user_id = pipeline.space_id);
    DROP TABLE pipelines_pre_v8;
  `);
  database.pragma('foreign_keys = ON');
}

// The original v9 migration renamed space_items, which (per SQLite's default
// legacy_alter_table=OFF behavior) auto-rewrote space_repos/space_files/
// space_notes' FK references to point at the renamed table, then dropped it —
// leaving those FKs dangling at a table that no longer exists. v9 itself now
// rebuilds them correctly, but databases that already applied the broken v9
// are stuck (the migration runner never re-invokes an applied version), so
// this repairs them in place.
export function repairDocumentItemsForeignKeys(database: Database.Database): void {
  // Finds every table left referencing the table that v9 dropped, regardless
  // of which table it is (space_repos/space_files/space_notes/agent_worktrees
  // today, possibly others later), and rewrites its FK to point at space_items.
  const dangling = database
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%space_items_pre_v9%'")
    .all() as { name: string; sql: string }[];
  if (dangling.length === 0) return;

  database.pragma('foreign_keys = OFF');
  for (const { name, sql } of dangling) {
    const fixedSql = sql.replace(/["`]?space_items_pre_v9["`]?/g, 'space_items');
    const tmpName = `_${name}_v9_repair`;
    const cols = (database.prepare(`SELECT name FROM pragma_table_info('${name}')`).all() as { name: string }[])
      .map(c => c.name)
      .join(', ');
    database.exec(`ALTER TABLE ${name} RENAME TO ${tmpName};`);
    database.exec(fixedSql);
    database.exec(`INSERT INTO ${name} (${cols}) SELECT ${cols} FROM ${tmpName};`);
    database.exec(`DROP TABLE ${tmpName};`);
  }
  database.pragma('foreign_keys = ON');
}

export function initDb(): void {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db, migrations, {
    beforeMigrate: () => {
      // Only snapshot a database that already holds data — a brand-new install
      // has nothing to lose and the empty file isn't worth copying.
      const hasData = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .get();
      if (hasData) {
        console.log(`Backed up database to ${backupDatabase(db, dbPath, 'pre-migrate')} before migrating.`);
      }
    },
  });
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function closeDb(): void {
  db?.close();
}

function applySchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      hashed_password TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('anthropic','openai','github','mcp')),
      purpose TEXT NOT NULL DEFAULT 'tool'
        CHECK(purpose IN ('lead_agent','claude_code','codex','github','mcp','tool')),
      encrypted_config TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      repo_path TEXT,
      enabled_connection_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      projects_root TEXT,
      claude_code_budget_usd REAL,
      codex_budget_usd REAL,
      claude_code_daily_budget_usd REAL,
      codex_daily_budget_usd REAL,
      permission_profile TEXT NOT NULL DEFAULT 'fast'
        CHECK(permission_profile IN ('fast','trusted','strict'))
    );

    CREATE TABLE IF NOT EXISTS agent_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool TEXT NOT NULL CHECK(tool IN ('claude_code','codex','lead_agent','subagent')),
      cost_usd REAL NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      effort TEXT NOT NULL DEFAULT 'medium' CHECK(effort IN ('low','medium','high')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS session_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','done','error')),
      error TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS session_project_links (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'agent' CHECK(source IN ('agent','user','system')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (session_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS session_events (
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

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      tool TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','done','error','awaiting_approval')),
      output_log TEXT NOT NULL DEFAULT '',
      result TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      resolved_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('user','feedback','project','reference')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, type, key)
    );

    CREATE TABLE IF NOT EXISTS agent_worktrees (
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

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      interval_hours INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER NOT NULL,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running','done','error','cancelled')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS campaign_tasks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agent TEXT NOT NULL CHECK(agent IN ('claude_code','codex','mcp','file_write','git','github','eval','subagent')),
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK(status IN ('waiting','running','done','error')),
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      position INTEGER NOT NULL,
      prompt TEXT,
      depends_on TEXT,
      tool_args TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS pipeline_tasks (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agent TEXT NOT NULL CHECK(agent IN ('claude_code','codex','mcp','file_write','git','github','eval','subagent')),
      prompt TEXT,
      tool_args TEXT,
      depends_on TEXT,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ready'
        CHECK(status IN ('ready','review','running','error')),
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      path TEXT,
      url TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      source_plan_id TEXT,
      source_step_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const connectionCols = db.prepare("SELECT name FROM pragma_table_info('connections')").all() as { name: string }[];
  if (!connectionCols.some(c => c.name === 'purpose')) {
    db.exec(`
      ALTER TABLE connections ADD COLUMN purpose TEXT NOT NULL DEFAULT 'tool'
        CHECK(purpose IN ('lead_agent','claude_code','codex','github','mcp','tool'));

      UPDATE connections
      SET purpose = CASE
        WHEN type = 'openai' THEN 'codex'
        WHEN type = 'github' THEN 'github'
        WHEN type = 'mcp' THEN 'mcp'
        ELSE 'tool'
      END
      WHERE purpose = 'tool';

      -- Promote each user's earliest existing anthropic connection to lead_agent
      -- (only it was previously usable as the lead-agent key).
      UPDATE connections
      SET purpose = 'lead_agent'
      WHERE type = 'anthropic' AND id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS rn
          FROM connections WHERE type = 'anthropic'
        ) WHERE rn = 1
      );
    `);
  }

  const userSettingsCols = db.prepare("SELECT name FROM pragma_table_info('user_settings')").all() as { name: string }[];
  if (!userSettingsCols.some(c => c.name === 'claude_code_budget_usd')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN claude_code_budget_usd REAL');
  }
  if (!userSettingsCols.some(c => c.name === 'codex_budget_usd')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN codex_budget_usd REAL');
  }
  if (!userSettingsCols.some(c => c.name === 'claude_code_daily_budget_usd')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN claude_code_daily_budget_usd REAL');
  }
  if (!userSettingsCols.some(c => c.name === 'codex_daily_budget_usd')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN codex_daily_budget_usd REAL');
  }
  if (!userSettingsCols.some(c => c.name === 'permission_profile')) {
    db.exec("ALTER TABLE user_settings ADD COLUMN permission_profile TEXT NOT NULL DEFAULT 'fast' CHECK(permission_profile IN ('fast','trusted','strict'))");
  }
  if (!userSettingsCols.some(c => c.name === 'expo_push_token')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN expo_push_token TEXT');
  }
  if (!userSettingsCols.some(c => c.name === 'apns_device_token')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN apns_device_token TEXT');
  }

  const sessionCols = db.prepare("SELECT name FROM pragma_table_info('sessions')").all() as { name: string }[];
  if (!sessionCols.some(c => c.name === 'effort')) {
    db.exec("ALTER TABLE sessions ADD COLUMN effort TEXT NOT NULL DEFAULT 'medium' CHECK(effort IN ('low','medium','high'))");
  }
  if (!sessionCols.some(c => c.name === 'model')) {
    db.exec('ALTER TABLE sessions ADD COLUMN model TEXT');
  }
  if (!sessionCols.some(c => c.name === 'pinned_project_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN pinned_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL');
  }
  if (!sessionCols.some(c => c.name === 'summary')) {
    db.exec('ALTER TABLE sessions ADD COLUMN summary TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','done','error')),
      error TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );
  `);

  // Remove legacy type column (added in an old migration, no longer needed)
  const projectCols = db.prepare("SELECT name FROM pragma_table_info('projects')").all() as { name: string }[];
  if (projectCols.some(c => c.name === 'type')) {
    db.exec('ALTER TABLE projects DROP COLUMN type');
  }

  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  if (tableNames.some(t => t.name === 'workspaces')) {
    db.exec(`
      INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids, created_at)
      SELECT id, user_id, name, description, repo_path, enabled_connection_ids, created_at FROM workspaces
      WHERE NOT EXISTS (SELECT 1 FROM projects WHERE projects.id = workspaces.id);
    `);

    const executionCols = db.prepare("SELECT name FROM pragma_table_info('executions')").all() as { name: string }[];
    if (executionCols.some(c => c.name === 'workspace_id') && !executionCols.some(c => c.name === 'project_id')) {
      db.exec(`
        ALTER TABLE executions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
        UPDATE executions SET project_id = workspace_id;
      `);
    }

    db.exec('DROP TABLE workspaces');
  }

  const scheduledCols = db.prepare("SELECT name FROM pragma_table_info('scheduled_tasks')").all() as { name: string }[];
  if (!scheduledCols.some(c => c.name === 'prompt')) {
    db.exec("ALTER TABLE scheduled_tasks ADD COLUMN prompt TEXT");
  }

  if (tableNames.some(t => t.name === 'user_memory')) {
    db.exec(`
      INSERT INTO memories (id, user_id, type, key, value, created_at, updated_at)
      SELECT id, user_id, 'user', key, value, created_at, updated_at FROM user_memory
      WHERE NOT EXISTS (SELECT 1 FROM memories WHERE memories.id = user_memory.id);

      DROP TABLE user_memory;
    `);
  }

  // Remove dangling workspace_id FK from executions (references dropped workspaces table).
  // PRAGMA foreign_keys = ON means SQLite rejects any statement touching executions when the
  // referenced table is gone, so we must recreate the table to drop the bad constraint.
  const executionCols2 = db.prepare("SELECT name FROM pragma_table_info('executions')").all() as { name: string }[];
  if (executionCols2.some(c => c.name === 'workspace_id')) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE executions RENAME TO executions_old;
      CREATE TABLE executions (
        id TEXT PRIMARY KEY,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        tool TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','running','done','error','awaiting_approval')),
        output_log TEXT NOT NULL DEFAULT '',
        result TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER
      );
      INSERT INTO executions (id, message_id, project_id, tool, status, output_log, result, created_at, completed_at)
        SELECT id, message_id, project_id, tool, status, output_log, result, created_at, completed_at
        FROM executions_old;
      DROP TABLE executions_old;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Widen campaign_tasks.agent CHECK to allow non-agent step types (file_write, git, github).
  const campaignTasksSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='campaign_tasks'").get() as { sql: string } | undefined)?.sql;
  if (campaignTasksSql && !campaignTasksSql.includes('github')) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE campaign_tasks RENAME TO campaign_tasks_old;
      CREATE TABLE campaign_tasks (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        agent TEXT NOT NULL CHECK(agent IN ('claude_code','codex','mcp','file_write','git','github')),
        status TEXT NOT NULL DEFAULT 'waiting'
          CHECK(status IN ('waiting','running','done','error')),
        execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER
      );
      INSERT INTO campaign_tasks (id, campaign_id, title, agent, status, execution_id, position, created_at, completed_at)
        SELECT id, campaign_id, title, agent, status, execution_id, position, created_at, completed_at
        FROM campaign_tasks_old;
      DROP TABLE campaign_tasks_old;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Widen campaign_tasks to add eval/subagent agent types + new columns (prompt, depends_on, tool_args).
  const campaignTasksSql2 = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='campaign_tasks'").get() as { sql: string } | undefined)?.sql;
  if (campaignTasksSql2 && !campaignTasksSql2.includes("'eval'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE campaign_tasks RENAME TO campaign_tasks_old2;
      CREATE TABLE campaign_tasks (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        agent TEXT NOT NULL CHECK(agent IN ('claude_code','codex','mcp','file_write','git','github','eval','subagent')),
        status TEXT NOT NULL DEFAULT 'waiting'
          CHECK(status IN ('waiting','running','done','error')),
        execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
        position INTEGER NOT NULL,
        prompt TEXT,
        depends_on TEXT,
        tool_args TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER
      );
      INSERT INTO campaign_tasks (id, campaign_id, title, agent, status, execution_id, position, created_at, completed_at)
        SELECT id, campaign_id, title, agent, status, execution_id, position, created_at, completed_at
        FROM campaign_tasks_old2;
      DROP TABLE campaign_tasks_old2;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Widen session_events.type CHECK to include 'mcp_required'.
  const sessionEventsSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'").get() as { sql: string } | undefined)?.sql;
  if (sessionEventsSql && !sessionEventsSql.includes("'mcp_required'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE session_events RENAME TO session_events_old;
      CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('scope_changed','project_linked','project_created','campaign_created','artifact_created','approval_requested','approval_resolved','mcp_required')),
        title TEXT NOT NULL,
        body TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
        artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO session_events SELECT * FROM session_events_old;
      DROP TABLE session_events_old;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Widen session_events.type CHECK to include subagent event types.
  const sessionEventsSql2 = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'").get() as { sql: string } | undefined)?.sql;
  if (sessionEventsSql2 && !sessionEventsSql2.includes("'subagent_started'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE session_events RENAME TO session_events_old;
      CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('scope_changed','project_linked','project_created','campaign_created','artifact_created','approval_requested','approval_resolved','mcp_required','subagent_started','subagent_completed')),
        title TEXT NOT NULL,
        body TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
        artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO session_events SELECT * FROM session_events_old;
      DROP TABLE session_events_old;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Widen agent_usage.tool CHECK to include lead_agent and subagent.
  const agentUsageSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_usage'").get() as { sql: string } | undefined)?.sql;
  if (agentUsageSql && !agentUsageSql.includes("'lead_agent'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE agent_usage RENAME TO agent_usage_old;
      CREATE TABLE agent_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tool TEXT NOT NULL CHECK(tool IN ('claude_code','codex','lead_agent','subagent')),
        cost_usd REAL NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO agent_usage SELECT * FROM agent_usage_old;
      DROP TABLE agent_usage_old;
      CREATE INDEX IF NOT EXISTS idx_agent_usage_user_tool_date ON agent_usage(user_id, tool, created_at);
      PRAGMA foreign_keys = ON;
    `);
  }

  // Create pipelines and pipeline_tasks tables for existing DBs (already in CREATE TABLE for new DBs).
  const tableNames2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  if (!tableNames2.some(t => t.name === 'pipelines')) {
    db.exec(`
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE pipeline_tasks (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        agent TEXT NOT NULL CHECK(agent IN ('claude_code','codex','mcp','file_write','git','github','eval','subagent')),
        prompt TEXT,
        tool_args TEXT,
        depends_on TEXT,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
  }

  // Fix dangling FKs caused by SQLite auto-rewriting FK references when tables
  // are renamed. Two flavours of the same root bug:
  //
  // 1. artifacts.source_task_id → "campaign_tasks_old2" (dropped temp table)
  // 2. session_events.artifact_id → "artifacts_old_fk_fix" (dropped temp table
  //    created by a previous version of this very migration that didn't use
  //    PRAGMA legacy_alter_table)
  //
  // Fix: use PRAGMA legacy_alter_table = ON so the rename does NOT rewrite FK
  // references in other tables, then rebuild only the target table.
  const artifactsSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='artifacts'").get() as { sql: string } | undefined)?.sql;
  if (artifactsSql?.includes('campaign_tasks_old2')) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE artifacts RENAME TO artifacts_old_fk_fix;
      PRAGMA legacy_alter_table = OFF;
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'ready'
          CHECK(status IN ('ready','review','running','error')),
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        path TEXT,
        url TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        source_campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
        source_task_id TEXT REFERENCES campaign_tasks(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO artifacts SELECT * FROM artifacts_old_fk_fix;
      DROP TABLE artifacts_old_fk_fix;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Repair session_events.artifact_id if it was left pointing at
  // "artifacts_old_fk_fix" by the earlier (broken) version of the migration
  // above that omitted PRAGMA legacy_alter_table.
  const sessionEventsSql3 = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'").get() as { sql: string } | undefined)?.sql;
  if (sessionEventsSql3?.includes('artifacts_old_fk_fix')) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE session_events RENAME TO session_events_old_fk_fix;
      PRAGMA legacy_alter_table = OFF;
      CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('scope_changed','project_linked','project_created','campaign_created','artifact_created','approval_requested','approval_resolved','mcp_required','subagent_started','subagent_completed')),
        title TEXT NOT NULL,
        body TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
        artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO session_events SELECT * FROM session_events_old_fk_fix;
      DROP TABLE session_events_old_fk_fix;
      PRAGMA foreign_keys = ON;
    `);
  }

  // ── Rename campaigns → plans, campaign_tasks → plan_steps ─────────────────
  // Step 1: rename the tables themselves (if still named campaigns/campaign_tasks)
  const tableNames3 = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const hasCampaigns = tableNames3.some(t => t.name === 'campaigns');
  const hasPlans = tableNames3.some(t => t.name === 'plans');
  if (hasCampaigns && !hasPlans) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE campaigns RENAME TO plans;
      ALTER TABLE campaign_tasks RENAME TO plan_steps;
      PRAGMA legacy_alter_table = OFF;
      PRAGMA foreign_keys = ON;
    `);
  } else if (hasCampaigns && hasPlans) {
    // Spurious empty campaigns/campaign_tasks created alongside already-migrated plans — drop them.
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS campaign_tasks;
      DROP TABLE IF EXISTS campaigns;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Step 2: rename plan_steps.campaign_id → plan_id (if still named campaign_id)
  const planStepsCols = db.prepare("SELECT name FROM pragma_table_info('plan_steps')").all() as { name: string }[];
  if (planStepsCols.some(c => c.name === 'campaign_id')) {
    db.exec(`ALTER TABLE plan_steps RENAME COLUMN campaign_id TO plan_id;`);
  }

  // Step 3: rename artifacts.source_campaign_id → source_plan_id and source_task_id → source_step_id
  const artifactsCols = db.prepare("SELECT name FROM pragma_table_info('artifacts')").all() as { name: string }[];
  if (artifactsCols.some(c => c.name === 'source_campaign_id')) {
    db.exec(`
      ALTER TABLE artifacts RENAME COLUMN source_campaign_id TO source_plan_id;
      ALTER TABLE artifacts RENAME COLUMN source_task_id TO source_step_id;
    `);
  }

  // Step 4: rename session_events.campaign_id → plan_id (if still named campaign_id)
  const sessionEventsCols = db.prepare("SELECT name FROM pragma_table_info('session_events')").all() as { name: string }[];
  if (sessionEventsCols.some(c => c.name === 'campaign_id')) {
    db.exec(`ALTER TABLE session_events RENAME COLUMN campaign_id TO plan_id;`);
  }

  // Step 5: rebuild session_events to update CHECK constraint from campaign_created → plan_created
  const sessionEventsSql4 = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'").get() as { sql: string } | undefined)?.sql;
  if (sessionEventsSql4?.includes('campaign_created')) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE session_events RENAME TO session_events_pre_plan;
      PRAGMA legacy_alter_table = OFF;
      CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('scope_changed','project_linked','project_created','plan_created','artifact_created','approval_requested','approval_resolved','mcp_required','subagent_started','subagent_completed')),
        title TEXT NOT NULL,
        body TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
        artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO session_events SELECT * FROM session_events_pre_plan;
      DROP TABLE session_events_pre_plan;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Widen session_events.type CHECK to include 'connection_created'.
  const sessionEventsSql5 = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'").get() as { sql: string } | undefined)?.sql;
  if (sessionEventsSql5 && !sessionEventsSql5.includes("'connection_created'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE session_events RENAME TO session_events_pre_conn;
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
      INSERT INTO session_events SELECT * FROM session_events_pre_conn;
      DROP TABLE session_events_pre_conn;
      PRAGMA foreign_keys = ON;
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_session_turns_session_status ON session_turns(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_plan_steps_plan_id ON plan_steps(plan_id);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_user_tool_date ON agent_usage(user_id, tool, created_at);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled_next ON scheduled_tasks(enabled, next_run_at);
  `);
}

/**
 * Marks executions/plan steps left in 'running' from a previous process
 * (crash or restart) as errored, and removes the empty assistant messages
 * they were streaming into — an empty assistant message would otherwise be
 * sent back to the Anthropic API on the next turn and be rejected.
 */
export function reconcileOrphanedExecutions(): void {
  const db = getDb();
  const stale = db.prepare("SELECT id, message_id FROM executions WHERE status = 'running'").all() as
    { id: string; message_id: string | null }[];
  const staleTurns = db.prepare("SELECT id FROM session_turns WHERE status = 'running'").all() as { id: string }[];

  const markError = db.prepare(
    "UPDATE executions SET status = 'error', result = 'Interrupted by server restart', completed_at = unixepoch() WHERE id = ?"
  );
  const deleteEmptyMessage = db.prepare(
    "DELETE FROM messages WHERE id = ? AND role = 'assistant' AND content = ''"
  );
  for (const { id, message_id } of stale) {
    markError.run(id);
    if (message_id) deleteEmptyMessage.run(message_id);
  }

  db.prepare("UPDATE session_turns SET status = 'error', error = 'Interrupted by server restart', completed_at = unixepoch() WHERE status = 'running'").run();
  db.prepare("UPDATE plan_steps SET status = 'error', completed_at = unixepoch() WHERE status = 'running'").run();
  if (stale.length || staleTurns.length) {
    console.log(`Reconciled ${stale.length} orphaned execution(s) and ${staleTurns.length} orphaned turn(s) from a previous run.`);
  }
}

export interface DbSpace {
  id: string;
  name: string;
  description: string | null;
  enabled_connection_ids: string;
}

/** @deprecated Use DbSpace */
export type DbProject = DbSpace;

export function getSpaceForUser(spaceId: string, userId: string): DbSpace | undefined {
  return getDb()
    .prepare('SELECT id, name, description, enabled_connection_ids FROM spaces WHERE id = ? AND user_id = ?')
    .get(spaceId, userId) as DbSpace | undefined;
}

/** @deprecated Use getSpaceForUser */
export const getProjectForUser = getSpaceForUser;

export interface DbAgentWorktree {
  id: string;
  item_id: string;
  session_id: string;
  branch: string;
  worktree_path: string;
  claude_session_id: string | null;
  codex_session_id: string | null;
}

export function getAgentWorktree(itemId: string, sessionId: string): DbAgentWorktree | undefined {
  return getDb()
    .prepare('SELECT * FROM agent_worktrees WHERE item_id = ? AND session_id = ?')
    .get(itemId, sessionId) as DbAgentWorktree | undefined;
}

export function createAgentWorktree(itemId: string, sessionId: string, branch: string, worktreePath: string): DbAgentWorktree {
  const id = newId();
  getDb()
    .prepare('INSERT INTO agent_worktrees (id, item_id, session_id, branch, worktree_path) VALUES (?,?,?,?,?)')
    .run(id, itemId, sessionId, branch, worktreePath);
  return getAgentWorktree(itemId, sessionId)!;
}

export function setAgentWorktreeSession(id: string, tool: 'claude' | 'codex', sessionId: string): void {
  const column = tool === 'claude' ? 'claude_session_id' : 'codex_session_id';
  getDb().prepare(`UPDATE agent_worktrees SET ${column} = ? WHERE id = ?`).run(sessionId, id);
}

export function updateAgentWorktreePath(id: string, worktreePath: string): void {
  getDb().prepare('UPDATE agent_worktrees SET worktree_path = ? WHERE id = ?').run(worktreePath, id);
}

export function getSpacesForUser(userId: string): DbSpace[] {
  return getDb()
    .prepare('SELECT id, name, description, enabled_connection_ids FROM spaces WHERE user_id = ?')
    .all(userId) as DbSpace[];
}

/** @deprecated Use getSpacesForUser */
export const getProjectsForUser = getSpacesForUser;

export type SessionEventType =
  | 'scope_changed'
  | 'project_linked'
  | 'project_created'
  | 'plan_created'
  | 'artifact_created'
  | 'item_created'
  | 'item_updated'
  | 'approval_requested'
  | 'approval_resolved'
  | 'mcp_required'
  | 'subagent_started'
  | 'subagent_completed'
  | 'connection_created';

export interface DbSessionEvent {
  id: string;
  session_id: string;
  type: SessionEventType;
  title: string;
  body: string | null;
  space_id: string | null;
  plan_id: string | null;
  item_id: string | null;
  execution_id: string | null;
  metadata: string;
  created_at: number;
}

export function createSessionEvent(input: {
  sessionId: string;
  type: SessionEventType;
  title: string;
  body?: string | null;
  spaceId?: string | null;
  planId?: string | null;
  itemId?: string | null;
  executionId?: string | null;
  metadata?: Record<string, unknown>;
}): DbSessionEvent {
  const id = newId();
  getDb()
    .prepare(`
      INSERT INTO session_events (id, session_id, type, title, body, space_id, plan_id, item_id, execution_id, metadata)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `)
    .run(
      id,
      input.sessionId,
      input.type,
      input.title,
      input.body ?? null,
      input.spaceId ?? null,
      input.planId ?? null,
      input.itemId ?? null,
      input.executionId ?? null,
      JSON.stringify(input.metadata ?? {}),
    );
  return getDb()
    .prepare('SELECT * FROM session_events WHERE id = ?')
    .get(id) as DbSessionEvent;
}

export function getSessionEvents(sessionId: string): DbSessionEvent[] {
  return getDb()
    .prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(sessionId) as DbSessionEvent[];
}

export function linkSessionProject(
  sessionId: string,
  spaceId: string,
  source: 'agent' | 'user' | 'system',
): boolean {
  const result = getDb()
    .prepare(`
      INSERT OR IGNORE INTO session_project_links (session_id, space_id, source)
      VALUES (?,?,?)
    `)
    .run(sessionId, spaceId, source);
  return result.changes > 0;
}

export function getSessionProjectLinks(sessionId: string): Array<DbSpace & { source: 'agent' | 'user' | 'system'; linked_at: number }> {
  return getDb()
    .prepare(`
      SELECT p.id, p.name, p.description, p.enabled_connection_ids,
             l.source, l.created_at AS linked_at
      FROM session_project_links l
      JOIN spaces p ON p.id = l.space_id
      WHERE l.session_id = ?
      ORDER BY l.created_at ASC
    `)
    .all(sessionId) as Array<DbSpace & { source: 'agent' | 'user' | 'system'; linked_at: number }>;
}

export function getProjectsRoot(userId: string): string {
  const row = getDb()
    .prepare('SELECT projects_root FROM user_settings WHERE user_id = ?')
    .get(userId) as { projects_root: string | null } | undefined;
  return row?.projects_root || path.join(getDataDir(), 'projects');
}

export function setProjectsRoot(userId: string, projectsRoot: string): void {
  getDb()
    .prepare(`
      INSERT INTO user_settings (user_id, projects_root) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET projects_root = excluded.projects_root
    `)
    .run(userId, projectsRoot);
}

export type AgentUsageTool = 'claude_code' | 'codex' | 'lead_agent' | 'subagent';

export type AgentBudgets = Record<AgentUsageTool, number | null>;
export type AgentBudgetPeriod = 'monthly' | 'daily';

export function getAgentBudgets(userId: string, period: AgentBudgetPeriod = 'monthly'): AgentBudgets {
  const row = getDb()
    .prepare('SELECT claude_code_budget_usd, codex_budget_usd, claude_code_daily_budget_usd, codex_daily_budget_usd FROM user_settings WHERE user_id = ?')
    .get(userId) as {
      claude_code_budget_usd: number | null;
      codex_budget_usd: number | null;
      claude_code_daily_budget_usd: number | null;
      codex_daily_budget_usd: number | null;
    } | undefined;
  if (period === 'daily') {
    return {
      claude_code: row?.claude_code_daily_budget_usd ?? null,
      codex: row?.codex_daily_budget_usd ?? null,
      lead_agent: null,
      subagent: null,
    };
  }
  return {
    claude_code: row?.claude_code_budget_usd ?? null,
    codex: row?.codex_budget_usd ?? null,
    lead_agent: null,
    subagent: null,
  };
}

export function setAgentBudget(userId: string, tool: AgentUsageTool, budgetUsd: number | null, period: AgentBudgetPeriod = 'monthly'): void {
  const column = period === 'daily'
    ? (tool === 'claude_code' ? 'claude_code_daily_budget_usd' : 'codex_daily_budget_usd')
    : (tool === 'claude_code' ? 'claude_code_budget_usd' : 'codex_budget_usd');
  getDb()
    .prepare(`
      INSERT INTO user_settings (user_id, ${column}) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET ${column} = excluded.${column}
    `)
    .run(userId, budgetUsd);
}

export type PermissionProfile = 'fast' | 'trusted' | 'strict';

export function getPermissionProfile(userId: string): PermissionProfile {
  const row = getDb()
    .prepare('SELECT permission_profile FROM user_settings WHERE user_id = ?')
    .get(userId) as { permission_profile: string } | undefined;
  const profile = row?.permission_profile;
  return profile === 'trusted' || profile === 'strict' ? profile : 'fast';
}

export function setPermissionProfile(userId: string, profile: PermissionProfile): void {
  getDb()
    .prepare(`
      INSERT INTO user_settings (user_id, permission_profile) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET permission_profile = excluded.permission_profile
    `)
    .run(userId, profile);
}

export function recordAgentUsage(userId: string, tool: AgentUsageTool, costUsd: number): void {
  if (!costUsd) return;
  getDb()
    .prepare('INSERT INTO agent_usage (id, user_id, tool, cost_usd) VALUES (?, ?, ?, ?)')
    .run(newId(), userId, tool, costUsd);
}

export function getMonthlyUsage(userId: string, tool: AgentUsageTool): number {
  const monthStart = Math.floor(new Date(new Date().toISOString().slice(0, 7) + '-01T00:00:00Z').getTime() / 1000);
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM agent_usage WHERE user_id = ? AND tool = ? AND created_at >= ?')
    .get(userId, tool, monthStart) as { total: number };
  return row.total;
}

export function getDailyUsage(userId: string, tool: AgentUsageTool): number {
  const dayStart = Math.floor(new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() / 1000);
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM agent_usage WHERE user_id = ? AND tool = ? AND created_at >= ?')
    .get(userId, tool, dayStart) as { total: number };
  return row.total;
}

export interface DbScheduledTask {
  id: string;
  type: string;
  prompt: string | null;
  interval_hours: number;
  enabled: number;
  next_run_at: number;
  last_run_at: number | null;
}

export function getScheduledTasksForUser(userId: string): DbScheduledTask[] {
  return getDb()
    .prepare('SELECT id, type, prompt, interval_hours, enabled, next_run_at, last_run_at FROM scheduled_tasks WHERE user_id = ?')
    .all(userId) as DbScheduledTask[];
}

export function getScheduledTaskForUser(id: string, userId: string): DbScheduledTask | undefined {
  return getDb()
    .prepare('SELECT id, type, prompt, interval_hours, enabled, next_run_at, last_run_at FROM scheduled_tasks WHERE id = ? AND user_id = ?')
    .get(id, userId) as DbScheduledTask | undefined;
}

export function updateScheduledTask(id: string, userId: string, updates: { enabled?: boolean; interval_hours?: number }): void {
  if (updates.enabled !== undefined) {
    getDb().prepare('UPDATE scheduled_tasks SET enabled = ? WHERE id = ? AND user_id = ?').run(updates.enabled ? 1 : 0, id, userId);
  }
  if (updates.interval_hours !== undefined) {
    getDb().prepare('UPDATE scheduled_tasks SET interval_hours = ? WHERE id = ? AND user_id = ?').run(updates.interval_hours, id, userId);
  }
}

export function createScheduledTask(userId: string, type: string, intervalHours: number, prompt?: string): string {
  const id = newId();
  const nextRunAt = Math.floor(Date.now() / 1000) + intervalHours * 3600;
  getDb()
    .prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, next_run_at, prompt) VALUES (?,?,?,?,?,?)')
    .run(id, userId, type, intervalHours, nextRunAt, prompt ?? null);
  return id;
}

export function deleteScheduledTask(id: string, userId: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM scheduled_tasks WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return result.changes > 0;
}

export function resumePlan(planId: string): { plan: DbPlan; steps: DbPlanStep[] } | undefined {
  const plan = getPlanById(planId);
  if (!plan) return undefined;
  if (plan.status === 'cancelled') return undefined;
  getDb()
    .prepare("UPDATE plans SET status = 'running', completed_at = NULL WHERE id = ? AND status IN ('error')")
    .run(planId);
  getDb()
    .prepare("UPDATE plan_steps SET status = 'waiting', execution_id = NULL, completed_at = NULL WHERE plan_id = ? AND status = 'error'")
    .run(planId);
  return { plan: getPlanById(planId)!, steps: getPlanSteps(planId) };
}

export function getDueScheduledTasks(now: number): (DbScheduledTask & { user_id: string })[] {
  return getDb()
    .prepare('SELECT id, user_id, type, interval_hours, enabled, next_run_at, last_run_at FROM scheduled_tasks WHERE enabled = 1 AND next_run_at <= ?')
    .all(now) as (DbScheduledTask & { user_id: string })[];
}

export function markScheduledTaskRun(id: string, now: number, intervalHours: number): void {
  getDb()
    .prepare('UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?')
    .run(now, now + intervalHours * 3600, id);
}

export interface DbPlan {
  id: string;
  space_id: string;
  session_id: string | null;
  title: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  created_at: number;
  completed_at: number | null;
}

export interface DbPlanStep {
  id: string;
  plan_id: string;
  title: string;
  agent: 'claude_code' | 'codex' | 'mcp' | 'file_write' | 'git' | 'github' | 'eval' | 'subagent';
  status: 'waiting' | 'running' | 'done' | 'error';
  execution_id: string | null;
  position: number;
  prompt: string | null;
  depends_on: string | null;
  tool_args: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface DbPipeline {
  id: string;
  space_id: string;
  title: string;
  description: string | null;
  created_at: number;
}

export interface DbPipelineTask {
  id: string;
  pipeline_id: string;
  title: string;
  agent: DbPlanStep['agent'];
  prompt: string | null;
  tool_args: string | null;
  depends_on: string | null;
  position: number;
  created_at: number;
}

export function createPlan(
  spaceId: string,
  sessionId: string | null,
  title: string,
  steps: Array<{
    title: string;
    agent: DbPlanStep['agent'];
    prompt?: string | null;
    depends_on?: number[];
    tool_args?: Record<string, unknown> | null;
  }>
): { plan: DbPlan; steps: DbPlanStep[] } {
  return getDb().transaction(() => {
    const id = newId();
    getDb()
      .prepare('INSERT INTO plans (id, space_id, session_id, title) VALUES (?,?,?,?)')
      .run(id, spaceId, sessionId, title);
    // Pre-assign step IDs so depends_on indices can be resolved to IDs
    const stepIds = steps.map(() => newId());
    const insertStep = getDb().prepare(
      'INSERT INTO plan_steps (id, plan_id, title, agent, position, prompt, depends_on, tool_args) VALUES (?,?,?,?,?,?,?,?)'
    );
    steps.forEach((t, i) => {
      const depIds = (t.depends_on ?? []).map(idx => stepIds[idx]).filter(Boolean);
      insertStep.run(
        stepIds[i], id, t.title, t.agent, i,
        t.prompt ?? null,
        depIds.length > 0 ? JSON.stringify(depIds) : null,
        t.tool_args ? JSON.stringify(t.tool_args) : null,
      );
    });
    const plan = getDb()
      .prepare('SELECT * FROM plans WHERE id = ?')
      .get(id) as DbPlan;
    return { plan, steps: getPlanSteps(id) };
  })();
}

export function createPipeline(
  spaceId: string,
  title: string,
  description: string | null,
  tasks: Array<{
    title: string;
    agent: DbPlanStep['agent'];
    prompt?: string | null;
    depends_on?: number[];
    tool_args?: Record<string, unknown> | null;
  }>
): { pipeline: DbPipeline; tasks: DbPipelineTask[] } {
  return getDb().transaction(() => {
    const id = newId();
    getDb()
      .prepare('INSERT INTO pipelines (id, space_id, title, description) VALUES (?,?,?,?)')
      .run(id, spaceId, title, description);
    const insertTask = getDb().prepare(
      'INSERT INTO pipeline_tasks (id, pipeline_id, title, agent, position, prompt, depends_on, tool_args) VALUES (?,?,?,?,?,?,?,?)'
    );
    tasks.forEach((t, i) => {
      const depPositions = t.depends_on ?? [];
      insertTask.run(
        newId(), id, t.title, t.agent, i,
        t.prompt ?? null,
        depPositions.length > 0 ? JSON.stringify(depPositions) : null,
        t.tool_args ? JSON.stringify(t.tool_args) : null,
      );
    });
    const pipeline = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as DbPipeline;
    const pipelineTasks = getDb().prepare('SELECT * FROM pipeline_tasks WHERE pipeline_id = ? ORDER BY position').all(id) as DbPipelineTask[];
    return { pipeline, tasks: pipelineTasks };
  })();
}

export function getPipelineById(id: string, userId: string): DbPipeline | undefined {
  return getDb().prepare(`
    SELECT pipeline.*
    FROM pipelines pipeline
    JOIN spaces space ON space.id = pipeline.space_id
    WHERE pipeline.id = ? AND space.user_id = ?
  `).get(id, userId) as DbPipeline | undefined;
}

export function getPipelineTasks(pipelineId: string): DbPipelineTask[] {
  return getDb().prepare('SELECT * FROM pipeline_tasks WHERE pipeline_id = ? ORDER BY position').all(pipelineId) as DbPipelineTask[];
}

export interface DbRegistryTool {
  id: string;
  user_id: string;
  connection_id: string;
  tool_name: string;
  mcp_tool_name: string;
  description: string;
  input_schema: string;
  created_at: number;
  updated_at: number;
}

export function upsertMcpRegistryTools(
  userId: string,
  connectionId: string,
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
): void {
  const upsert = getDb().prepare(`
    INSERT INTO tool_registry (id, user_id, connection_id, tool_name, mcp_tool_name, description, input_schema, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(connection_id, mcp_tool_name) DO UPDATE SET
      tool_name = excluded.tool_name,
      description = excluded.description,
      input_schema = excluded.input_schema,
      updated_at = unixepoch()
  `);
  const tx = getDb().transaction((rows: typeof tools) => {
    for (const t of rows) {
      const qualifiedName = qualifyMcpToolName(connectionId, t.name);
      upsert.run(newId(), userId, connectionId, qualifiedName, t.name, t.description ?? '', JSON.stringify(t.inputSchema ?? {}));
    }
  });
  tx(tools);
}

function qualifyMcpToolName(connectionId: string, mcpToolName: string): string {
  const sanitized = mcpToolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const shortConn = connectionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 8);
  return `mcp_${shortConn}_${sanitized}`.slice(0, 128);
}

export function getMcpRegistryToolsForUser(userId: string): DbRegistryTool[] {
  return getDb()
    .prepare('SELECT * FROM tool_registry WHERE user_id = ? ORDER BY tool_name')
    .all(userId) as DbRegistryTool[];
}

export function getMcpRegistryTool(userId: string, toolName: string): DbRegistryTool | undefined {
  return getDb()
    .prepare('SELECT * FROM tool_registry WHERE user_id = ? AND tool_name = ?')
    .get(userId, toolName) as DbRegistryTool | undefined;
}

export function getSessionDiscoveredTools(sessionId: string): string[] {
  const row = getDb()
    .prepare('SELECT discovered_tools FROM sessions WHERE id = ?')
    .get(sessionId) as { discovered_tools: string } | undefined;
  return row ? JSON.parse(row.discovered_tools) as string[] : [];
}

export function addSessionDiscoveredTools(sessionId: string, toolNames: string[]): void {
  const existing = new Set(getSessionDiscoveredTools(sessionId));
  for (const name of toolNames) existing.add(name);
  getDb()
    .prepare('UPDATE sessions SET discovered_tools = ? WHERE id = ?')
    .run(JSON.stringify([...existing]), sessionId);
}

export function listPipelinesForUser(userId: string): DbPipeline[] {
  return getDb().prepare(`
    SELECT pipeline.*
    FROM pipelines pipeline
    JOIN spaces space ON space.id = pipeline.space_id
    WHERE space.user_id = ?
    ORDER BY pipeline.created_at DESC
  `).all(userId) as DbPipeline[];
}

export function deletePipeline(id: string, userId: string): boolean {
  const pipeline = getPipelineById(id, userId);
  if (!pipeline) return false;
  const result = getDb().prepare('DELETE FROM pipelines WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getPlanSummaries(projectId: string): Array<DbPlan & { total_tasks: number; done_tasks: number; error_tasks: number }> {
  return getDb()
    .prepare(`
      SELECT c.*,
        COUNT(ct.id) AS total_tasks,
        SUM(CASE WHEN ct.status = 'done' THEN 1 ELSE 0 END) AS done_tasks,
        SUM(CASE WHEN ct.status = 'error' THEN 1 ELSE 0 END) AS error_tasks
      FROM plans c
      LEFT JOIN plan_steps ct ON ct.plan_id = c.id
      WHERE c.space_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `)
    .all(projectId) as Array<DbPlan & { total_tasks: number; done_tasks: number; error_tasks: number }>;
}

export function getRecentPlansForUser(userId: string, limit = 30): Array<DbPlan & { space_name: string }> {
  return getDb()
    .prepare(`
      SELECT c.*, p.name AS space_name
      FROM plans c
      JOIN spaces p ON p.id = c.space_id
      WHERE p.user_id = ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `)
    .all(userId, limit) as Array<DbPlan & { space_name: string }>;
}

export function getPlansForSpace(spaceId: string): DbPlan[] {
  return getDb()
    .prepare('SELECT * FROM plans WHERE space_id = ? ORDER BY created_at DESC')
    .all(spaceId) as DbPlan[];
}

/** @deprecated Use getPlansForSpace */
export const getPlansForProject = getPlansForSpace;

export function getPlansWithDetails(spaceId: string, limit = 20): Array<DbPlan & {
  steps: Array<DbPlanStep & { output: string | null; result: string | null }>;
}> {
  type Row = {
    c_id: string; c_space_id: string; c_session_id: string | null; c_title: string;
    c_status: DbPlan['status']; c_created_at: number; c_completed_at: number | null;
    t_id: string | null; t_title: string | null; t_agent: DbPlanStep['agent'] | null;
    t_status: DbPlanStep['status'] | null; t_execution_id: string | null;
    t_position: number | null; t_created_at: number | null; t_completed_at: number | null;
    output: string | null; task_result: string | null;
  };
  const rows = getDb()
    .prepare(`
      SELECT c.id AS c_id, c.space_id AS c_space_id, c.session_id AS c_session_id,
             c.title AS c_title, c.status AS c_status,
             c.created_at AS c_created_at, c.completed_at AS c_completed_at,
             ct.id AS t_id, ct.title AS t_title, ct.agent AS t_agent,
             ct.status AS t_status, ct.execution_id AS t_execution_id,
             ct.position AS t_position, ct.created_at AS t_created_at,
             ct.completed_at AS t_completed_at,
             e.output_log AS output, e.result AS task_result
      FROM (SELECT * FROM plans WHERE space_id = ? ORDER BY created_at DESC LIMIT ?) c
      LEFT JOIN plan_steps ct ON ct.plan_id = c.id
      LEFT JOIN executions e ON e.id = ct.execution_id
      ORDER BY c.created_at DESC, ct.position
    `)
    .all(spaceId, limit) as Row[];

  const planMap = new Map<string, DbPlan & { steps: Array<DbPlanStep & { output: string | null; result: string | null }> }>();
  for (const row of rows) {
    if (!planMap.has(row.c_id)) {
      planMap.set(row.c_id, {
        id: row.c_id, space_id: row.c_space_id, session_id: row.c_session_id,
        title: row.c_title, status: row.c_status,
        created_at: row.c_created_at, completed_at: row.c_completed_at,
        steps: [],
      });
    }
    if (row.t_id) {
      planMap.get(row.c_id)!.steps.push({
        id: row.t_id, plan_id: row.c_id, title: row.t_title!,
        agent: row.t_agent!, status: row.t_status!, execution_id: row.t_execution_id,
        position: row.t_position!, created_at: row.t_created_at!, completed_at: row.t_completed_at,
        prompt: null, depends_on: null, tool_args: null,
        output: row.output, result: row.task_result,
      });
    }
  }
  return Array.from(planMap.values());
}

export function getPlanById(id: string): DbPlan | undefined {
  return getDb()
    .prepare('SELECT * FROM plans WHERE id = ?')
    .get(id) as DbPlan | undefined;
}

export function getPlanSteps(planId: string): DbPlanStep[] {
  return getDb()
    .prepare('SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY position')
    .all(planId) as DbPlanStep[];
}

export function updatePlanStepStatus(
  stepId: string,
  status: DbPlanStep['status'],
  executionId?: string
): void {
  const now = Math.floor(Date.now() / 1000);
  const completed = status === 'done' || status === 'error' ? now : null;
  if (executionId) {
    getDb()
      .prepare('UPDATE plan_steps SET status = ?, execution_id = ?, completed_at = ? WHERE id = ?')
      .run(status, executionId, completed, stepId);
  } else {
    getDb()
      .prepare('UPDATE plan_steps SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, completed, stepId);
  }
}

export function maybeCompletePlan(planId: string): DbPlan['status'] {
  return getDb().transaction(() => {
    const plan = getPlanById(planId)!;
    if (plan.status === 'cancelled') return plan.status;

    const steps = getPlanSteps(planId);
    const allDone = steps.every(t => t.status === 'done');
    const anyError = steps.some(t => t.status === 'error');
    const anyRunning = steps.some(t => t.status === 'running');
    let newStatus: DbPlan['status'] | null = null;
    if (allDone) newStatus = 'done';
    else if (anyError && !anyRunning) newStatus = 'error';
    if (newStatus) {
      const now = Math.floor(Date.now() / 1000);
      getDb()
        .prepare('UPDATE plans SET status = ?, completed_at = ? WHERE id = ?')
        .run(newStatus, now, planId);
      return newStatus;
    }
    return plan.status;
  })();
}

// Cancels a running plan and marks any steps still waiting/running as
// errored so dispatchTool/maybeCompletePlan treat them as terminal.
export function cancelPlan(planId: string): DbPlan | undefined {
  return getDb().transaction(() => {
    const now = Math.floor(Date.now() / 1000);
    getDb()
      .prepare("UPDATE plans SET status = 'cancelled', completed_at = ? WHERE id = ? AND status = 'running'")
      .run(now, planId);
    getDb()
      .prepare("UPDATE plan_steps SET status = 'error', completed_at = ? WHERE plan_id = ? AND status IN ('waiting','running')")
      .run(now, planId);
    return getPlanById(planId);
  })();
}

export function getPlanForStep(stepId: string): DbPlan | undefined {
  return getDb()
    .prepare('SELECT c.* FROM plans c JOIN plan_steps t ON t.plan_id = c.id WHERE t.id = ?')
    .get(stepId) as DbPlan | undefined;
}

export interface DbExecution {
  id: string;
  message_id: string | null;
  space_id: string | null;
  tool: string;
  status: 'running' | 'done' | 'error';
  output_log: string;
  result: string | null;
  created_at: number;
  completed_at: number | null;
}

export function getExecutionById(id: string): DbExecution | undefined {
  return getDb()
    .prepare('SELECT * FROM executions WHERE id = ?')
    .get(id) as DbExecution | undefined;
}

export function getExpoPushToken(userId: string): string | null {
  const row = getDb()
    .prepare('SELECT expo_push_token FROM user_settings WHERE user_id = ?')
    .get(userId) as { expo_push_token: string | null } | undefined;
  return row?.expo_push_token ?? null;
}

export function setExpoPushToken(userId: string, token: string | null): void {
  getDb().prepare(`
    INSERT INTO user_settings (user_id, expo_push_token)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET expo_push_token = excluded.expo_push_token
  `).run(userId, token);
}

export function getApnsDeviceToken(userId: string): string | null {
  const row = getDb()
    .prepare('SELECT apns_device_token FROM user_settings WHERE user_id = ?')
    .get(userId) as { apns_device_token: string | null } | undefined;
  return row?.apns_device_token ?? null;
}

export function setApnsDeviceToken(userId: string, token: string | null): void {
  getDb().prepare(`
    INSERT INTO user_settings (user_id, apns_device_token)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET apns_device_token = excluded.apns_device_token
  `).run(userId, token);
}
