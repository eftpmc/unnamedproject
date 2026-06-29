import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { newId } from '../lib/ids.js';
import { runMigrations, type Migration } from './migrate.js';
import { backupDatabase } from './backup.js';

let db: Database.Database;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, '../../../data');

export function getDataDir(): string {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : defaultDataDir;
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
      type TEXT NOT NULL CHECK(type IN ('github','mcp','google','chrome')),
      purpose TEXT NOT NULL DEFAULT 'tool' CHECK(purpose IN ('github','mcp','tool','google','chrome')),
      service TEXT,
      encrypted_config TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS agent_providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('claude_code','codex')),
      encrypted_config TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      enabled_connection_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      default_branch TEXT,
      origin TEXT NOT NULL CHECK(origin IN ('created','linked')),
      description TEXT,
      enabled_connection_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_projects_space ON projects(space_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT,
      status TEXT,
      mime_type TEXT NOT NULL DEFAULT 'text/markdown',
      tags TEXT NOT NULL DEFAULT '{}',
      source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(space_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_files_space_type ON files(space_id, type);

    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('schedule','webhook','manual')),
      schedule_cron TEXT,
      playbook_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_triggers_project ON triggers(project_id);

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      projects_root TEXT,
      claude_code_budget_usd REAL,
      codex_budget_usd REAL,
      claude_code_daily_budget_usd REAL,
      codex_daily_budget_usd REAL,
      permission_profile TEXT NOT NULL DEFAULT 'fast'
        CHECK(permission_profile IN ('fast','trusted','strict')),
      expo_push_token TEXT,
      apns_device_token TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      turn_id TEXT REFERENCES session_turns(id) ON DELETE SET NULL,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      tool TEXT NOT NULL CHECK(tool IN ('claude_code','codex','lead_agent','subagent')),
      cost_usd REAL NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_usage_user_tool_date ON agent_usage(user_id, tool, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_session_date ON agent_usage(session_id, created_at);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      effort TEXT NOT NULL DEFAULT 'medium' CHECK(effort IN ('low','medium','high')),
      model TEXT,
      pinned_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      summary TEXT,
      session_state TEXT,
      provider_type TEXT,
      provider_session_id TEXT,
      discovered_tools TEXT NOT NULL DEFAULT '[]',
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
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

    CREATE TABLE IF NOT EXISTS message_files (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      PRIMARY KEY (message_id, document_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_files_message ON message_files(message_id);

    CREATE TABLE IF NOT EXISTS session_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','done','error')),
      error TEXT,
      invocation_mode TEXT,
      provider_type TEXT,
      provider_session_id TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_session_turns_session_status ON session_turns(session_id, status);

    CREATE TABLE IF NOT EXISTS session_space_links (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'agent' CHECK(source IN ('agent','user','system')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (session_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
      tool TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','done','error','awaiting_approval')),
      output_log TEXT NOT NULL DEFAULT '',
      result TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN (
        'scope_changed','project_linked','space_linked','project_created',
        'artifact_created','item_created','item_updated','approval_requested','approval_resolved',
        'mcp_required','subagent_started','subagent_completed','connection_created','runtime_checkpoint'
      )),
      title TEXT NOT NULL,
      body TEXT,
      space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
      item_id TEXT,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events(session_id);

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
      embedding BLOB,
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

    CREATE TABLE IF NOT EXISTS vault_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_vault_entries_user ON vault_entries(user_id);
  `);
}

const migrations: Migration[] = [
  { version: 1, name: 'baseline', up: () => applySchema() },
  {
    version: 2,
    name: 'vault_entries',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS vault_entries (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          encrypted_value TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(user_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_vault_entries_user ON vault_entries(user_id);
      `);
    },
  },
  {
    version: 3,
    name: 'agent_usage_attribution',
    up: (database) => {
      const cols = (database.prepare("PRAGMA table_info(agent_usage)").all() as { name: string }[]).map(c => c.name);
      const addColumn = (name: string, sql: string) => {
        if (!cols.includes(name)) database.exec(`ALTER TABLE agent_usage ADD COLUMN ${sql}`);
      };
      addColumn('session_id', 'session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL');
      addColumn('turn_id', 'turn_id TEXT REFERENCES session_turns(id) ON DELETE SET NULL');
      addColumn('message_id', 'message_id TEXT REFERENCES messages(id) ON DELETE SET NULL');
      addColumn('execution_id', 'execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL');
      database.exec('CREATE INDEX IF NOT EXISTS idx_agent_usage_session_date ON agent_usage(session_id, created_at);');
    },
  },
  {
    version: 4,
    name: 'session_state',
    up: (database) => {
      const cols = (database.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(c => c.name);
      if (!cols.includes('session_state')) {
        database.exec('ALTER TABLE sessions ADD COLUMN session_state TEXT');
      }
    },
  },
  {
    version: 5,
    name: 'session_turn_observability',
    up: (database) => {
      const cols = (database.prepare("PRAGMA table_info(session_turns)").all() as { name: string }[]).map(c => c.name);
      const addColumn = (name: string, sql: string) => {
        if (!cols.includes(name)) database.exec(`ALTER TABLE session_turns ADD COLUMN ${sql}`);
      };
      addColumn('invocation_mode', 'invocation_mode TEXT');
      addColumn('provider_type', 'provider_type TEXT');
      addColumn('provider_session_id', 'provider_session_id TEXT');
    },
  },
  {
    version: 7,
    name: 'web_connections',
    noTransaction: true,
    up: (database) => {
      const cols = (database.prepare("PRAGMA table_info(connections)").all() as { name: string }[]).map(c => c.name);
      if (!cols.includes('url')) database.exec("ALTER TABLE connections ADD COLUMN url TEXT");
      if (!cols.includes('notes')) database.exec("ALTER TABLE connections ADD COLUMN notes TEXT");
      // Widen the type CHECK to include 'web' by recreating the table
      const currentSql = tableSql(database, 'connections') ?? '';
      if (currentSql.includes("'web'")) return;
      database.pragma('foreign_keys = OFF');
      database.exec(`ALTER TABLE connections RENAME TO _connections_web_tmp;`);
      database.exec(`CREATE TABLE connections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('github','mcp','google','chrome','web')),
        purpose TEXT NOT NULL DEFAULT 'tool' CHECK(purpose IN ('github','mcp','tool','google','chrome','web')),
        service TEXT,
        url TEXT,
        notes TEXT,
        encrypted_config TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(user_id, name)
      );`);
      database.exec(`INSERT INTO connections (id, user_id, name, type, purpose, service, url, notes, encrypted_config, created_at)
        SELECT id, user_id, name, type, purpose, service, url, notes, encrypted_config, created_at FROM _connections_web_tmp;`);
      database.exec(`DROP TABLE _connections_web_tmp;`);
      database.pragma('foreign_keys = ON');
    },
  },
  {
    version: 8,
    name: 'document_mime_type',
    up: (database) => {
      const cols = (database.prepare("PRAGMA table_info(documents)").all() as { name: string }[]).map(c => c.name);
      if (!cols.includes('mime_type')) {
        database.exec("ALTER TABLE documents ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'text/markdown'");
      }
    },
  },
  {
    version: 6,
    name: 'runtime_checkpoint_events',
    noTransaction: true,
    up: (database) => {
      const sql = tableSql(database, 'session_events');
      if (sql?.includes('runtime_checkpoint')) return;
      database.pragma('foreign_keys = OFF');
      database.exec('ALTER TABLE session_events RENAME TO _session_events_runtime_checkpoint_tmp;');
      database.exec(`CREATE TABLE session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN (
          'scope_changed','project_linked','space_linked','project_created',
          'artifact_created','item_created','item_updated','approval_requested','approval_resolved',
          'mcp_required','subagent_started','subagent_completed','connection_created','runtime_checkpoint'
        )),
        title TEXT NOT NULL,
        body TEXT,
        space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
        item_id TEXT,
        execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );`);
      database.exec(`
        INSERT INTO session_events (id, session_id, type, title, body, space_id, item_id, execution_id, metadata, created_at)
        SELECT id, session_id, type, title, body, space_id, item_id, execution_id, metadata, created_at
        FROM _session_events_runtime_checkpoint_tmp;
      `);
      database.exec('DROP TABLE _session_events_runtime_checkpoint_tmp;');
      database.exec('CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events(session_id);');
      database.pragma('foreign_keys = ON');
    },
  },
  {
    version: 9,
    name: 'unify_library',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS message_files (
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          document_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          PRIMARY KEY (message_id, document_id)
        );
        CREATE INDEX IF NOT EXISTS idx_message_files_message ON message_files(message_id);
      `);
      const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
      if (tables.includes('message_attachments')) {
        database.exec('DROP TABLE message_attachments;');
      }
    },
  },
  {
    version: 10,
    name: 'files_rename',
    noTransaction: true,
    up: (database) => {
      const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
      // Rename documents → files
      if (tables.includes('documents') && !tables.includes('files')) {
        database.pragma('foreign_keys = OFF');
        // Add mime_type and tags columns if missing, then rename
        const cols = (database.prepare('PRAGMA table_info(documents)').all() as { name: string }[]).map(c => c.name);
        if (!cols.includes('mime_type')) database.exec("ALTER TABLE documents ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'text/markdown'");
        if (!cols.includes('tags')) {
          if (cols.includes('frontmatter')) {
            database.exec('ALTER TABLE documents ADD COLUMN tags TEXT NOT NULL DEFAULT \'{}\'');
            database.exec('UPDATE documents SET tags = frontmatter');
          } else {
            database.exec("ALTER TABLE documents ADD COLUMN tags TEXT NOT NULL DEFAULT '{}'");
          }
        }
        database.exec('ALTER TABLE documents RENAME TO files');
        database.exec('CREATE INDEX IF NOT EXISTS idx_files_space_type ON files(space_id, type)');
        database.pragma('foreign_keys = ON');
      }
      // Rename message_documents → message_files
      if (tables.includes('message_documents') && !tables.includes('message_files')) {
        database.exec('ALTER TABLE message_documents RENAME TO message_files');
      }
    },
  },
];

function tableSql(database: Database.Database, name: string): string | undefined {
  return (database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { sql: string } | undefined)?.sql;
}

function dropPlanSystem(database: Database.Database): void {
  const planStepsExists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='plan_steps'")
    .get();
  const eventsSqlCheck = tableSql(database, 'session_events');
  if (!planStepsExists && !(eventsSqlCheck?.includes('plan_id'))) return;

  database.pragma('foreign_keys = OFF');
  database.exec('DROP TABLE IF EXISTS plan_steps; DROP TABLE IF EXISTS plans; DROP TABLE IF EXISTS pipeline_tasks; DROP TABLE IF EXISTS pipelines;');

  if (eventsSqlCheck?.includes('plan_id')) {
    const keepCols = (database.prepare("SELECT name FROM pragma_table_info('session_events')").all() as { name: string }[])
      .map(c => c.name)
      .filter(n => n !== 'plan_id')
      .join(', ');
    const evtTmp = '_session_events_drop_plans_tmp';
    database.exec(`ALTER TABLE session_events RENAME TO ${evtTmp};`);
    database.exec(`CREATE TABLE session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN (
        'scope_changed','project_linked','space_linked','project_created',
        'artifact_created','item_created','item_updated','approval_requested','approval_resolved',
        'mcp_required','subagent_started','subagent_completed','connection_created','runtime_checkpoint'
      )),
      title TEXT NOT NULL,
      body TEXT,
      space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
      item_id TEXT,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );`);
    database.exec(`INSERT INTO session_events (${keepCols}) SELECT ${keepCols} FROM ${evtTmp};`);
    database.exec(`DROP TABLE ${evtTmp};`);
  }

  database.pragma('foreign_keys = ON');
}

function dropLegacyItemTables(database: Database.Database): void {
  database.pragma('foreign_keys = OFF');
  database.exec(`
    DROP TABLE IF EXISTS item_files;
    DROP TABLE IF EXISTS space_documents;
    DROP TABLE IF EXISTS space_notes;
    DROP TABLE IF EXISTS space_files;
    DROP TABLE IF EXISTS space_repos;
    DROP TABLE IF EXISTS item_templates;
    DROP TABLE IF EXISTS space_items;
    DROP TABLE IF EXISTS artifacts;
    DROP TABLE IF EXISTS pipeline_tasks;
    DROP TABLE IF EXISTS pipelines;
    DROP TABLE IF EXISTS campaign_tasks;
    DROP TABLE IF EXISTS campaigns;
    DROP TABLE IF EXISTS scheduled_tasks;
  `);
  database.pragma('foreign_keys = ON');
}

function seedDefaultAccounts(): void {
  if (process.env.NODE_ENV === 'test') return;
  const existing = db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
  if (existing.n > 0) return;

  const accounts = [
    { email: 'zackhhi@gmail.com', password: 'test1234' },
    { email: 'test@test.com', password: 'test1234' },
  ];

  for (const { email, password } of accounts) {
    const hashed = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(newId(), email, hashed);
    console.log(`Seeded account: ${email}`);
  }
}

export function initDb(overrideDataDir?: string): void {
  const dataDir = overrideDataDir ?? getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db, migrations, {
    beforeMigrate: () => {
      const hasData = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .get();
      if (hasData) {
        console.log(`Backed up database to ${backupDatabase(db, dbPath, 'pre-migrate')} before migrating.`);
      }
    },
  });

  dropPlanSystem(db);
  dropLegacyItemTables(db);
  seedDefaultAccounts();
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function closeDb(): void {
  db?.close();
}

/**
 * Marks executions/plan steps left in 'running' from a previous process
 * (crash or restart) as errored, and removes the empty assistant messages
 * they were streaming into.
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
  project_id: string;
  session_id: string;
  branch: string;
  worktree_path: string;
  claude_session_id: string | null;
  codex_session_id: string | null;
}

export function getAgentWorktree(projectId: string, sessionId: string): DbAgentWorktree | undefined {
  return getDb()
    .prepare('SELECT * FROM agent_worktrees WHERE project_id = ? AND session_id = ?')
    .get(projectId, sessionId) as DbAgentWorktree | undefined;
}

export function createAgentWorktree(projectId: string, sessionId: string, branch: string, worktreePath: string): DbAgentWorktree {
  const id = newId();
  getDb()
    .prepare('INSERT INTO agent_worktrees (id, project_id, session_id, branch, worktree_path) VALUES (?,?,?,?,?)')
    .run(id, projectId, sessionId, branch, worktreePath);
  return getAgentWorktree(projectId, sessionId)!;
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
  | 'space_linked'
  | 'project_created'
  | 'artifact_created'
  | 'item_created'
  | 'item_updated'
  | 'approval_requested'
  | 'approval_resolved'
  | 'mcp_required'
  | 'subagent_started'
  | 'subagent_completed'
  | 'connection_created'
  | 'runtime_checkpoint';

export interface DbSessionEvent {
  id: string;
  session_id: string;
  type: SessionEventType;
  title: string;
  body: string | null;
  space_id: string | null;
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
  itemId?: string | null;
  executionId?: string | null;
  metadata?: Record<string, unknown>;
}): DbSessionEvent {
  const id = newId();
  getDb()
    .prepare(`
      INSERT INTO session_events (id, session_id, type, title, body, space_id, item_id, execution_id, metadata)
      VALUES (?,?,?,?,?,?,?,?,?)
    `)
    .run(
      id,
      input.sessionId,
      input.type,
      input.title,
      input.body ?? null,
      input.spaceId ?? null,
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
  projectId: string,
  source: 'agent' | 'user' | 'system',
): boolean {
  const result = getDb()
    .prepare(`
      INSERT OR IGNORE INTO session_space_links (session_id, project_id, source)
      VALUES (?,?,?)
    `)
    .run(sessionId, projectId, source);
  return result.changes > 0;
}

export function getSessionProjectLinks(sessionId: string): Array<DbSpace & { source: 'agent' | 'user' | 'system'; linked_at: number }> {
  return getDb()
    .prepare(`
      SELECT p.id, p.name, p.description, p.enabled_connection_ids,
             l.source, l.created_at AS linked_at
      FROM session_space_links l
      JOIN projects p ON p.id = l.project_id
      WHERE l.session_id = ?
      ORDER BY l.created_at ASC
    `)
    .all(sessionId) as Array<DbSpace & { source: 'agent' | 'user' | 'system'; linked_at: number }>;
}

export interface DbProjectRecord {
  id: string;
  name: string;
  description: string | null;
  enabled_connection_ids: string;
  user_id: string;
  space_id: string;
  repo_path: string;
}

export function getProjectByIdForUser(projectId: string, userId: string): DbProjectRecord | undefined {
  return getDb()
    .prepare('SELECT id, name, description, enabled_connection_ids, user_id, space_id, repo_path FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId) as DbProjectRecord | undefined;
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

export function recordAgentUsage(
  userId: string,
  tool: AgentUsageTool,
  costUsd: number,
  attribution: { sessionId?: string | null; turnId?: string | null; messageId?: string | null; executionId?: string | null } = {},
): void {
  if (!costUsd) return;
  getDb()
    .prepare('INSERT INTO agent_usage (id, user_id, session_id, turn_id, message_id, execution_id, tool, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), userId, attribution.sessionId ?? null, attribution.turnId ?? null, attribution.messageId ?? null, attribution.executionId ?? null, tool, costUsd);
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

export function getPlanForStep(stepId: string): DbPlan | undefined {
  return getDb()
    .prepare('SELECT c.* FROM plans c JOIN plan_steps t ON t.plan_id = c.id WHERE t.id = ?')
    .get(stepId) as DbPlan | undefined;
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

export function setSessionProviderInfo(sessionId: string, providerType: string, providerSessionId: string): void {
  getDb()
    .prepare('UPDATE sessions SET provider_type = ?, provider_session_id = ? WHERE id = ?')
    .run(providerType, providerSessionId, sessionId);
}

export interface ItemSession {
  id: string;
  title: string | null;
  last_event_at: number;
}

export function getSessionsForItem(itemId: string, userId: string, limit = 10): ItemSession[] {
  return getDb().prepare(`
    SELECT s.id, s.title, MAX(e.created_at) as last_event_at
    FROM session_events e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.item_id = ? AND s.user_id = ?
    GROUP BY s.id
    ORDER BY last_event_at DESC
    LIMIT ?
  `).all(itemId, userId, limit) as ItemSession[];
}

export function getDueTriggers(nowUnix: number): Array<{ id: string; project_id: string; schedule_cron: string | null; playbook_id: string | null; user_id: string }> {
  return getDb().prepare(`
    SELECT t.id, t.project_id, t.schedule_cron, t.playbook_id, p.user_id
    FROM triggers t JOIN projects p ON p.id = t.project_id
    WHERE t.enabled = 1 AND t.kind = 'schedule' AND t.next_run_at IS NOT NULL AND t.next_run_at <= ?
  `).all(nowUnix) as Array<{ id: string; project_id: string; schedule_cron: string | null; playbook_id: string | null; user_id: string }>;
}
