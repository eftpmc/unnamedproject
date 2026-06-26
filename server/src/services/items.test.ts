import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

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
    CREATE TABLE space_items (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      source_session_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      page_blocks TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE space_repos (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      repo_path TEXT NOT NULL,
      default_branch TEXT
    );
    CREATE TABLE space_files (
      item_id TEXT PRIMARY KEY REFERENCES space_items(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      size_bytes INTEGER,
      mime_type TEXT
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

  it('createTemplateItem stores page_blocks as JSON', async () => {
    const { createTemplateItem } = await import('./items.js');
    const blocks = [{ type: 'text' as const, content: 'hello' }];
    const item = createTemplateItem({ space_id: 'space1', name: 'My Doc', type: 'spec', page_blocks: blocks });
    expect(item.type).toBe('spec');
    expect(item.page_blocks).toEqual(blocks);
    expect(item.id).toBeTruthy();
  });

  it('createTemplateItem with empty blocks stores empty array', async () => {
    const { createTemplateItem } = await import('./items.js');
    const item = createTemplateItem({ space_id: 'space1', name: 'Empty', type: 'blank', page_blocks: [] });
    expect(item.page_blocks).toEqual([]);
  });

  it('updateItemPageBlocks replaces page_blocks', async () => {
    const { createTemplateItem, updateItemPageBlocks, getItemById } = await import('./items.js');
    const item = createTemplateItem({ space_id: 'space1', name: 'Doc', type: 'blank', page_blocks: [] });
    const newBlocks = [{ type: 'heading' as const, level: 1 as const, text: 'Title' }];
    updateItemPageBlocks(item.id, newBlocks);
    const updated = getItemById(item.id);
    expect(updated?.page_blocks).toEqual(newBlocks);
  });

  it('updateItemPageBlock replaces a single block by id, leaving others untouched', async () => {
    const { createTemplateItem, updateItemPageBlocks, updateItemPageBlock, getItemById } = await import('./items.js');
    const blocks = [
      { id: 'h1', type: 'heading' as const, level: 1 as const, text: 'Title' },
      { id: 'stat1', type: 'stat' as const, label: 'Open Issues', value: '14' },
    ];
    const item = createTemplateItem({ space_id: 'space1', name: 'Doc', type: 'blank', page_blocks: [] });
    updateItemPageBlocks(item.id, blocks);
    const found = updateItemPageBlock(item.id, 'stat1', { id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' });
    expect(found).toBe(true);
    const updated = getItemById(item.id);
    expect(updated?.page_blocks[0]).toEqual(blocks[0]);
    expect(updated?.page_blocks[1]).toEqual({ id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' });
  });

  it('updateItemPageBlock returns false for an unknown block id', async () => {
    const { createTemplateItem, updateItemPageBlock } = await import('./items.js');
    const item = createTemplateItem({ space_id: 'space1', name: 'Doc', type: 'blank', page_blocks: [] });
    const found = updateItemPageBlock(item.id, 'nope', { type: 'text', content: 'x' });
    expect(found).toBe(false);
  });

  it('repo item has page_blocks from space_items', async () => {
    const { createRepoItem, updateItemPageBlocks, getItemById } = await import('./items.js');
    const item = createRepoItem({ space_id: 'space1', name: 'My Repo', repo_path: '/tmp/repo' });
    expect(item.repo_path).toBe('/tmp/repo');
    expect(item.page_blocks).toEqual([]);
    const blocks = [{ type: 'text' as const, content: 'overview' }];
    updateItemPageBlocks(item.id, blocks);
    const updated = getItemById(item.id);
    expect(updated?.page_blocks).toEqual(blocks);
  });

  it('updateTaskDone sets done=true on a matching task', async () => {
    const { createTemplateItem, updateTaskDone, getItemById } = await import('./items.js');
    const blocks = [{ type: 'task-list' as const, tasks: [{ id: 'task1', text: 'Do thing', done: false }] }];
    const item = createTemplateItem({ space_id: 'space1', name: 'Kanban', type: 'kanban', page_blocks: blocks });
    const found = updateTaskDone(item.id, 'task1', true);
    expect(found).toBe(true);
    const updated = getItemById(item.id);
    const tl = updated?.page_blocks.find(b => b.type === 'task-list');
    if (tl?.type === 'task-list') expect(tl.tasks[0].done).toBe(true);
  });

  it('updateTaskDone returns false for unknown taskId', async () => {
    const { createTemplateItem, updateTaskDone } = await import('./items.js');
    const blocks = [{ type: 'task-list' as const, tasks: [{ id: 'task1', text: 'Do thing', done: false }] }];
    const item = createTemplateItem({ space_id: 'space1', name: 'K', type: 'blank', page_blocks: blocks });
    const found = updateTaskDone(item.id, 'nonexistent', true);
    expect(found).toBe(false);
  });
});
