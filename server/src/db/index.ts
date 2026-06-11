import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { newId } from '../lib/ids.js';

let db: Database.Database;

export function getDataDir(): string {
  return process.env.DATA_DIR ?? './data';
}

export function initDb(): void {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema();
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
      projects_root TEXT
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
      agent TEXT NOT NULL CHECK(agent IN ('claude_code','codex','mcp','file_write','git','github')),
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK(status IN ('waiting','running','done','error')),
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
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
}

/**
 * Marks executions/campaign tasks left in 'running' from a previous process
 * (crash or restart) as errored, and removes the empty assistant messages
 * they were streaming into — an empty assistant message would otherwise be
 * sent back to the Anthropic API on the next turn and be rejected.
 */
export function reconcileOrphanedExecutions(): void {
  const db = getDb();
  const stale = db.prepare("SELECT id, message_id FROM executions WHERE status = 'running'").all() as
    { id: string; message_id: string | null }[];
  if (stale.length === 0) return;

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

  db.prepare("UPDATE campaign_tasks SET status = 'error', completed_at = unixepoch() WHERE status = 'running'").run();
  console.log(`Reconciled ${stale.length} orphaned execution(s) from a previous run.`);
}

export interface DbProject {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string;
}

export function getProjectForUser(projectId: string, userId: string): DbProject | undefined {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId) as DbProject | undefined;
}

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

export function getProjectsForUser(userId: string): DbProject[] {
  return getDb()
    .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE user_id = ?')
    .all(userId) as DbProject[];
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

export interface DbScheduledTask {
  id: string;
  type: string;
  interval_hours: number;
  enabled: number;
  next_run_at: number;
  last_run_at: number | null;
}

export function getScheduledTasksForUser(userId: string): DbScheduledTask[] {
  return getDb()
    .prepare('SELECT id, type, interval_hours, enabled, next_run_at, last_run_at FROM scheduled_tasks WHERE user_id = ?')
    .all(userId) as DbScheduledTask[];
}

export function getScheduledTaskForUser(id: string, userId: string): DbScheduledTask | undefined {
  return getDb()
    .prepare('SELECT id, type, interval_hours, enabled, next_run_at, last_run_at FROM scheduled_tasks WHERE id = ? AND user_id = ?')
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

export function createScheduledTask(userId: string, type: string, intervalHours: number): string {
  const id = newId();
  const nextRunAt = Math.floor(Date.now() / 1000) + intervalHours * 3600;
  getDb()
    .prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, next_run_at) VALUES (?,?,?,?,?)')
    .run(id, userId, type, intervalHours, nextRunAt);
  return id;
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

export interface DbCampaign {
  id: string;
  project_id: string;
  session_id: string | null;
  title: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  created_at: number;
  completed_at: number | null;
}

export interface DbCampaignTask {
  id: string;
  campaign_id: string;
  title: string;
  agent: 'claude_code' | 'codex' | 'mcp' | 'file_write' | 'git' | 'github';
  status: 'waiting' | 'running' | 'done' | 'error';
  execution_id: string | null;
  position: number;
  created_at: number;
  completed_at: number | null;
}

export function createCampaign(
  projectId: string,
  sessionId: string | null,
  title: string,
  tasks: Array<{ title: string; agent: DbCampaignTask['agent'] }>
): { campaign: DbCampaign; tasks: DbCampaignTask[] } {
  return getDb().transaction(() => {
    const id = newId();
    getDb()
      .prepare('INSERT INTO campaigns (id, project_id, session_id, title) VALUES (?,?,?,?)')
      .run(id, projectId, sessionId, title);
    const insertTask = getDb().prepare(
      'INSERT INTO campaign_tasks (id, campaign_id, title, agent, position) VALUES (?,?,?,?,?)'
    );
    tasks.forEach((t, i) => {
      insertTask.run(newId(), id, t.title, t.agent, i);
    });
    const campaign = getDb()
      .prepare('SELECT * FROM campaigns WHERE id = ?')
      .get(id) as DbCampaign;
    return { campaign, tasks: getCampaignTasks(id) };
  })();
}

export function getCampaignsForProject(projectId: string): DbCampaign[] {
  return getDb()
    .prepare('SELECT * FROM campaigns WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as DbCampaign[];
}

export function getCampaignById(id: string): DbCampaign | undefined {
  return getDb()
    .prepare('SELECT * FROM campaigns WHERE id = ?')
    .get(id) as DbCampaign | undefined;
}

export function getCampaignTasks(campaignId: string): DbCampaignTask[] {
  return getDb()
    .prepare('SELECT * FROM campaign_tasks WHERE campaign_id = ? ORDER BY position')
    .all(campaignId) as DbCampaignTask[];
}

export function updateCampaignTaskStatus(
  taskId: string,
  status: DbCampaignTask['status'],
  executionId?: string
): void {
  const now = Math.floor(Date.now() / 1000);
  const completed = status === 'done' || status === 'error' ? now : null;
  if (executionId) {
    getDb()
      .prepare('UPDATE campaign_tasks SET status = ?, execution_id = ?, completed_at = ? WHERE id = ?')
      .run(status, executionId, completed, taskId);
  } else {
    getDb()
      .prepare('UPDATE campaign_tasks SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, completed, taskId);
  }
}

export function maybeCompleteCampaign(campaignId: string): DbCampaign['status'] {
  const tasks = getCampaignTasks(campaignId);
  const allDone = tasks.every(t => t.status === 'done');
  const anyError = tasks.some(t => t.status === 'error');
  const anyRunning = tasks.some(t => t.status === 'running');
  let newStatus: DbCampaign['status'] | null = null;
  if (allDone) newStatus = 'done';
  else if (anyError && !anyRunning) newStatus = 'error';
  if (newStatus) {
    const now = Math.floor(Date.now() / 1000);
    getDb()
      .prepare('UPDATE campaigns SET status = ?, completed_at = ? WHERE id = ?')
      .run(newStatus, now, campaignId);
  }
  const campaign = getCampaignById(campaignId)!;
  return campaign.status;
}
