import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// We need to mock getDb() to return a test DB.
// Set up a test DB with the v9 schema before importing items.ts.

let testDb: Database.Database;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getDataDir: () => '/tmp/test-data',
  newId: () => `id_${Math.random().toString(36).slice(2)}`,
}));

vi.mock('../lib/ids.js', () => ({
  newId: () => `id_${Math.random().toString(36).slice(2)}`,
}));

function setupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, enabled_connection_ids TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE plans (id TEXT PRIMARY KEY, space_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE plan_steps (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, title TEXT NOT NULL);
    CREATE TABLE space_items (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('repo','file','note','document')),
      name TEXT NOT NULL,
      source_session_id TEXT,
      source_plan_id TEXT,
      source_step_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE space_repos (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      repo_path TEXT NOT NULL,
      default_branch TEXT,
      overview_blocks TEXT
    );
    CREATE TABLE space_files (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      size_bytes INTEGER,
      mime_type TEXT
    );
    CREATE TABLE space_notes (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      content TEXT NOT NULL
    );
    CREATE TABLE space_documents (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      template TEXT NOT NULL DEFAULT 'document',
      blocks TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO spaces VALUES ('space1', 'user1', 'Test Space', NULL, '[]');
  `);
  return db;
}

describe('items service', () => {
  beforeEach(async () => {
    vi.resetModules();
    testDb = setupTestDb();
  });

  it('createDocumentItem stores blocks as JSON', async () => {
    const { createDocumentItem } = await import('./items.js');
    const blocks = [{ type: 'text' as const, content: 'hello' }];
    const item = createDocumentItem({ space_id: 'space1', name: 'My Doc', template_id: 'tpl_document', blocks });
    expect(item.type).toBe('document');
    if (item.type !== 'document') throw new Error('expected document');
    expect(item.template_id).toBe('tpl_document');
    expect(item.blocks).toEqual(blocks);
    expect(item.id).toBeTruthy();
  });

  it('createDocumentItem with empty blocks stores empty array', async () => {
    const { createDocumentItem } = await import('./items.js');
    const item = createDocumentItem({ space_id: 'space1', name: 'Empty Doc', template_id: 'tpl_spec', blocks: [] });
    if (item.type !== 'document') throw new Error('expected document');
    expect(item.blocks).toEqual([]);
  });

  it('updateDocumentBlocks replaces blocks', async () => {
    const { createDocumentItem, updateDocumentBlocks, getItemById } = await import('./items.js');
    const item = createDocumentItem({ space_id: 'space1', name: 'Doc', template_id: 'tpl_document', blocks: [] });
    const newBlocks = [{ type: 'heading' as const, level: 1 as const, text: 'Title' }];
    updateDocumentBlocks(item.id, newBlocks);
    const updated = getItemById(item.id);
    expect(updated?.type).toBe('document');
    if (updated?.type === 'document') expect(updated.blocks).toEqual(newBlocks);
  });

  it('updateDocumentBlock replaces a single block by id, leaving others untouched', async () => {
    const { createDocumentItem, updateDocumentBlock, getItemById } = await import('./items.js');
    const blocks = [
      { id: 'h1', type: 'heading' as const, level: 1 as const, text: 'Title' },
      { id: 'stat1', type: 'stat' as const, label: 'Open Issues', value: '14' },
    ];
    const item = createDocumentItem({ space_id: 'space1', name: 'Doc', template_id: 'tpl_document', blocks });
    const found = updateDocumentBlock(item.id, 'stat1', { id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' });
    expect(found).toBe(true);
    const updated = getItemById(item.id);
    if (updated?.type === 'document') {
      expect(updated.blocks[0]).toEqual(blocks[0]);
      expect(updated.blocks[1]).toEqual({ id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' });
    }
  });

  it('updateDocumentBlock returns false for an unknown block id', async () => {
    const { createDocumentItem, updateDocumentBlock } = await import('./items.js');
    const item = createDocumentItem({ space_id: 'space1', name: 'Doc', template_id: 'tpl_document', blocks: [] });
    const found = updateDocumentBlock(item.id, 'nope', { type: 'text', content: 'x' });
    expect(found).toBe(false);
  });

  it('updateRepoOverviewBlocks stores and retrieves overview blocks', async () => {
    const { createRepoItem, updateRepoOverviewBlocks, getItemById } = await import('./items.js');
    const item = createRepoItem({ space_id: 'space1', name: 'My Repo', repo_path: '/tmp/repo' });
    const overview = [{ type: 'text' as const, content: 'This is the overview.' }];
    updateRepoOverviewBlocks(item.id, overview);
    const updated = getItemById(item.id);
    expect(updated?.type).toBe('repo');
    if (updated?.type === 'repo') expect(updated.overview_blocks).toEqual(overview);
  });

  it('updateTaskDone sets done=true on a matching task', async () => {
    const { createDocumentItem, updateTaskDone, getItemById } = await import('./items.js');
    const blocks = [{ type: 'task-list' as const, tasks: [{ id: 'task1', text: 'Do thing', done: false }] }];
    const item = createDocumentItem({ space_id: 'space1', name: 'Kanban', template_id: 'tpl_kanban', blocks });
    const found = updateTaskDone(item.id, 'task1', true);
    expect(found).toBe(true);
    const updated = getItemById(item.id);
    if (updated?.type === 'document') {
      const tl = updated.blocks.find(b => b.type === 'task-list');
      if (tl?.type === 'task-list') expect(tl.tasks[0].done).toBe(true);
    }
  });

  it('updateTaskDone returns false for unknown taskId', async () => {
    const { createDocumentItem, updateTaskDone } = await import('./items.js');
    const blocks = [{ type: 'task-list' as const, tasks: [{ id: 'task1', text: 'Do thing', done: false }] }];
    const item = createDocumentItem({ space_id: 'space1', name: 'K', template_id: 'tpl_document', blocks });
    const found = updateTaskDone(item.id, 'nonexistent', true);
    expect(found).toBe(false);
  });
});
