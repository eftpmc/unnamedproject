import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Block } from '../services/items.js';

let testDb: Database.Database;

vi.mock('../db/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/index.js')>();
  return { ...actual, getDb: () => testDb, getSpaceForUser: (id: string, userId: string) => {
    return testDb.prepare('SELECT * FROM spaces WHERE id = ? AND user_id = ?').get(id, userId) as any;
  }};
});

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
      source_session_id TEXT, source_plan_id TEXT, source_step_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE space_repos (item_id TEXT PRIMARY KEY, repo_path TEXT NOT NULL, default_branch TEXT, overview_blocks TEXT);
    CREATE TABLE space_files (item_id TEXT PRIMARY KEY, file_path TEXT NOT NULL, size_bytes INTEGER, mime_type TEXT);
    CREATE TABLE space_notes (item_id TEXT PRIMARY KEY, content TEXT NOT NULL);
    CREATE TABLE space_documents (item_id TEXT PRIMARY KEY, template TEXT NOT NULL DEFAULT 'document', blocks TEXT NOT NULL DEFAULT '[]');
    INSERT INTO spaces VALUES ('sp1', 'u1', 'Test Space', NULL, '[]');
    INSERT INTO space_items VALUES ('repo1', 'sp1', 'repo', 'My Repo', NULL, NULL, NULL, 1);
    INSERT INTO space_repos VALUES ('repo1', '/tmp/repo', NULL, NULL);
  `);
  return db;
}

describe('runCreateItem', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('creates a document item and returns JSON with id', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Test Doc', type: 'document', template: 'spec' },
      'u1',
    ));
    expect(result.type).toBe('document');
    expect(result.template).toBe('spec');
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.id).toBeTruthy();
  });

  it('returns error for unknown space', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = await runCreateItem({ space_id: 'bad', name: 'X', type: 'document' }, 'u1');
    expect(result).toMatch(/^Error:/);
  });

  it('creates a note item', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'My Note', type: 'note', content: 'hello world' },
      'u1',
    ));
    expect(result.type).toBe('note');
    expect(result.content).toBe('hello world');
  });
});

describe('runUpdateItem', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('updates document blocks', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'document', template: 'document' },
      'u1',
    ));
    const newBlocks: Block[] = [{ type: 'text', content: 'updated' }];
    const result = JSON.parse(await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, blocks: newBlocks },
      'u1',
    ));
    expect(result.blocks).toEqual(newBlocks);
  });

  it('updates note content', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'My Note', type: 'note', content: 'original' },
      'u1',
    ));
    const result = JSON.parse(await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, content: 'updated content' },
      'u1',
    ));
    expect(result.content).toBe('updated content');
  });

  it('updates repo overview_blocks', async () => {
    const { runUpdateItem } = await import('./item_ops.js');
    const overview: Block[] = [{ type: 'text', content: 'overview' }];
    const result = JSON.parse(await runUpdateItem(
      { space_id: 'sp1', item_id: 'repo1', overview_blocks: overview },
      'u1',
    ));
    expect(result.overview_blocks).toEqual(overview);
  });
});

describe('runReadItem', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('reads a repo item', async () => {
    const { runReadItem } = await import('./item_ops.js');
    const result = JSON.parse(await runReadItem({ space_id: 'sp1', item_id: 'repo1' }, 'u1'));
    expect(result.type).toBe('repo');
    expect(result.repo_path).toBe('/tmp/repo');
  });

  it('returns error for unknown item', async () => {
    const { runReadItem } = await import('./item_ops.js');
    const result = await runReadItem({ space_id: 'sp1', item_id: 'nope' }, 'u1');
    expect(result).toMatch(/^Error:/);
  });
});
