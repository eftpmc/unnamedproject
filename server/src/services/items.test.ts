import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getDataDir: () => '/tmp/test-data',
}));

vi.mock('../lib/ids.js', () => ({
  newId: () => `id_${Math.random().toString(36).slice(2)}`,
}));

function setupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE spaces (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, enabled_connection_ids TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE space_items (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      source_session_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      page_blocks TEXT NOT NULL DEFAULT '[]',
      fields TEXT NOT NULL DEFAULT '{}'
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

  it('createItem stores page_blocks and fields', async () => {
    const { createItem } = await import('./items.js');
    const blocks = [{ type: 'text' as const, content: 'hello' }];
    const item = createItem({
      space_id: 'space1',
      name: 'My Spec',
      type: 'spec',
      page_blocks: blocks,
      fields: {},
    });
    expect(item.type).toBe('spec');
    expect(item.page_blocks).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'hello' })]));
    expect(item.fields).toEqual({});
    expect(item.id).toBeTruthy();
  });

  it('createItem stores typed fields', async () => {
    const { createItem } = await import('./items.js');
    const item = createItem({
      space_id: 'space1',
      name: 'My Repo',
      type: 'repo',
      page_blocks: [],
      fields: { repo_path: '/some/path', default_branch: 'main' },
    });
    expect(item.fields.repo_path).toBe('/some/path');
    expect(item.fields.default_branch).toBe('main');
  });

  it('createItem with empty fields stores empty object', async () => {
    const { createItem } = await import('./items.js');
    const item = createItem({ space_id: 'space1', name: 'Empty', type: 'blank', page_blocks: [], fields: {} });
    expect(item.fields).toEqual({});
  });

  it('updateItemPageBlocks replaces page_blocks', async () => {
    const { createItem, updateItemPageBlocks, getItemById } = await import('./items.js');
    const item = createItem({ space_id: 'space1', name: 'Doc', type: 'blank', page_blocks: [], fields: {} });
    const newBlocks = [{ type: 'heading' as const, level: 1 as const, text: 'Title' }];
    updateItemPageBlocks(item.id, newBlocks);
    const updated = getItemById(item.id);
    expect(updated?.page_blocks).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Title' })]));
  });

  it('updateItemFields patches fields', async () => {
    const { createItem, updateItemFields, getItemById } = await import('./items.js');
    const item = createItem({
      space_id: 'space1',
      name: 'Repo',
      type: 'repo',
      page_blocks: [],
      fields: { repo_path: '/old', default_branch: 'main' },
    });
    updateItemFields(item.id, { repo_path: '/new' });
    const updated = getItemById(item.id);
    expect(updated?.fields.repo_path).toBe('/new');
    expect(updated?.fields.default_branch).toBe('main'); // patch, not replace
  });

  it('updateItemPageBlock replaces a single block by id, leaving others untouched', async () => {
    const { createItem, updateItemPageBlocks, updateItemPageBlock, getItemById } = await import('./items.js');
    const item = createItem({ space_id: 'space1', name: 'Doc', type: 'blank', page_blocks: [], fields: {} });
    const blocks = [
      { type: 'text' as const, content: 'first', id: 'b1' },
      { type: 'text' as const, content: 'second', id: 'b2' },
    ];
    updateItemPageBlocks(item.id, blocks);
    updateItemPageBlock(item.id, 'b1', { type: 'text', content: 'updated', id: 'b1' });
    const updated = getItemById(item.id);
    expect(updated?.page_blocks[0]).toMatchObject({ content: 'updated' });
    expect(updated?.page_blocks[1]).toMatchObject({ content: 'second' });
  });

  it('getItemById returns undefined for unknown id', async () => {
    const { getItemById } = await import('./items.js');
    expect(getItemById('nonexistent')).toBeUndefined();
  });

  it('getItemsForSpace returns all items in the space', async () => {
    const { createItem, getItemsForSpace } = await import('./items.js');
    createItem({ space_id: 'space1', name: 'First', type: 'blank', page_blocks: [], fields: {} });
    createItem({ space_id: 'space1', name: 'Second', type: 'blank', page_blocks: [], fields: {} });
    const items = getItemsForSpace('space1');
    expect(items.length).toBe(2);
    expect(items.map(i => i.name).sort()).toEqual(['First', 'Second']);
  });
});
