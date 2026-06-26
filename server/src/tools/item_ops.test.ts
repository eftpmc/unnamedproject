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
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      source_session_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      page_blocks TEXT NOT NULL DEFAULT '[]',
      fields TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE item_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      blocks TEXT,
      schema TEXT NOT NULL DEFAULT '{}',
      capabilities TEXT NOT NULL DEFAULT '[]',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT INTO spaces VALUES ('sp1', 'u1', 'Test Space', NULL, '[]');
    INSERT INTO space_items (id, space_id, type, name, source_session_id, created_at, page_blocks, fields)
      VALUES ('repo1', 'sp1', 'repo', 'My Repo', NULL, 1, '[]',
        '{"repo_path":"/tmp/repo","default_branch":null}');
    INSERT INTO item_templates (id, user_id, kind, name, blocks, schema, capabilities, is_builtin) VALUES
      ('tpl_document', NULL, 'blocks', 'Document', '[{"type":"text","content":""}]', '{}', '[]', 1),
      ('tpl_spec', NULL, 'blocks', 'Spec', '[{"type":"heading","level":1,"text":"Overview"}]', '{}', '[]', 1),
      ('repo', NULL, 'blocks', 'Repo', '[]',
        '{"repo_path":{"type":"string","required":true},"default_branch":{"type":"string","required":false}}',
        '["git-aware","file-readable"]', 1);
  `);
  return db;
}

describe('runCreateItem', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('creates a template item and returns JSON with id', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Test Doc', type: 'tpl_spec' },
      'u1',
    ));
    expect(result.type).toBe('tpl_spec');
    expect(result.page_blocks.length).toBeGreaterThan(0);
    expect(result.id).toBeTruthy();
  });

  it('returns error for unknown space', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = await runCreateItem({ space_id: 'bad', name: 'X', type: 'tpl_document' }, 'u1');
    expect(result).toMatch(/^Error:/);
  });

  it('returns error for unknown type', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = await runCreateItem({ space_id: 'sp1', name: 'X', type: 'nonexistent' }, 'u1');
    expect(result).toMatch(/^Error:/);
  });

  it('links a created item to a session when provenance is passed', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Tracked Doc', type: 'tpl_spec', source_session_id: 'sess1' },
      'u1',
    ));
    expect(result.source_session_id).toBe('sess1');
  });

  it('creates a repo item with fields', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'My Repo', type: 'repo', fields: { repo_path: '/tmp/myrepo' } },
      'u1',
    ));
    expect(result.fields.repo_path).toBe('/tmp/myrepo');
  });

  it('returns error when required field missing', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = await runCreateItem(
      { space_id: 'sp1', name: 'Bad Repo', type: 'repo', fields: {} },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
    expect(result).toMatch(/repo_path/);
  });
});

describe('runUpdateItem', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('updates page_blocks', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'tpl_document' },
      'u1',
    ));
    const newBlocks: Block[] = [{ type: 'text', content: 'updated' }];
    const result = JSON.parse(await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, page_blocks: newBlocks },
      'u1',
    ));
    expect(result.page_blocks[0]).toMatchObject({ type: 'text', content: 'updated' });
  });

  it('patches a single block by block_id without touching the rest', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const blocks: Block[] = [
      { id: 'h1', type: 'heading', level: 1, text: 'Title' },
      { id: 'stat1', type: 'stat', label: 'Open Issues', value: '14' },
    ];
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'tpl_document' },
      'u1',
    ));
    await runUpdateItem({ space_id: 'sp1', item_id: created.id, page_blocks: blocks }, 'u1');
    const result = JSON.parse(await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, block_id: 'stat1', block: { id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' } },
      'u1',
    ));
    expect(result.page_blocks[0]).toMatchObject({ id: 'h1', text: 'Title' });
    expect(result.page_blocks[1]).toMatchObject({ id: 'stat1', value: '9' });
  });

  it('rejects a malformed block in a full page_blocks replace', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'tpl_document' },
      'u1',
    ));
    const result = await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, page_blocks: [{ type: 'heading', level: 9, text: 'bad' } as unknown as Block] },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
    expect(result).toMatch(/level/);
  });

  it('rejects a malformed block in a block_id patch', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const blocks: Block[] = [{ id: 'stat1', type: 'stat', label: 'Issues', value: '14' }];
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'tpl_document' },
      'u1',
    ));
    await runUpdateItem({ space_id: 'sp1', item_id: created.id, page_blocks: blocks }, 'u1');
    const result = await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, block_id: 'stat1', block: { id: 'stat1', type: 'stat' } as unknown as Block },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
    expect(result).toMatch(/label/);
  });

  it('returns an error patching an unknown block_id', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'tpl_document' },
      'u1',
    ));
    const result = await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, block_id: 'nope', block: { type: 'text', content: 'x' } },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
  });

  it('updates repo page_blocks', async () => {
    const { runUpdateItem } = await import('./item_ops.js');
    const overview: Block[] = [{ type: 'text', content: 'overview' }];
    const result = JSON.parse(await runUpdateItem(
      { space_id: 'sp1', item_id: 'repo1', page_blocks: overview },
      'u1',
    ));
    expect(result.page_blocks[0]).toMatchObject({ content: 'overview' });
  });

  it('patches item fields', async () => {
    const { runUpdateItem } = await import('./item_ops.js');
    const result = JSON.parse(await runUpdateItem(
      { space_id: 'sp1', item_id: 'repo1', fields: { default_branch: 'main' } },
      'u1',
    ));
    expect(result.fields.repo_path).toBe('/tmp/repo'); // untouched
    expect(result.fields.default_branch).toBe('main'); // patched
  });
});

describe('runReadItem', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('reads a repo item with fields', async () => {
    const { runReadItem } = await import('./item_ops.js');
    const result = JSON.parse(await runReadItem({ space_id: 'sp1', item_id: 'repo1' }, 'u1'));
    expect(result.type).toBe('repo');
    expect(result.fields.repo_path).toBe('/tmp/repo');
  });

  it('returns error for unknown item', async () => {
    const { runReadItem } = await import('./item_ops.js');
    const result = await runReadItem({ space_id: 'sp1', item_id: 'nope' }, 'u1');
    expect(result).toMatch(/^Error:/);
  });
});

describe('runCreateItemTemplate / runUpdateItemTemplate', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('creates a custom template with valid blocks', async () => {
    const { runCreateItemTemplate } = await import('./item_ops.js');
    const result = JSON.parse(await runCreateItemTemplate(
      { name: 'Dashboard', blocks: [{ id: 's1', type: 'stat', label: 'Issues', value: '14' }] },
      'u1',
    ));
    expect(result.name).toBe('Dashboard');
  });

  it('rejects creating a template with a malformed block', async () => {
    const { runCreateItemTemplate } = await import('./item_ops.js');
    const result = await runCreateItemTemplate(
      { name: 'Bad', blocks: [{ type: 'chart', chartType: 'bar', data: [{ label: 'A' }] } as unknown as Block] },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
    expect(result).toMatch(/data\[0\]/);
  });

  it('rejects updating a template with a malformed block', async () => {
    const { runUpdateItemTemplate } = await import('./item_ops.js');
    const result = await runUpdateItemTemplate({
      template_id: 'tpl_document',
      blocks: [{ type: 'callout', variant: 'urgent', content: 'x' } as unknown as Block],
    });
    expect(result).toMatch(/^Error:/);
    expect(result).toMatch(/variant/);
  });
});

describe('runDefineItemType', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('creates a new custom type', async () => {
    const { runDefineItemType } = await import('./item_ops.js');
    const result = JSON.parse(await runDefineItemType(
      {
        name: 'Bookmark',
        schema: { url: { type: 'string', required: true } },
        capabilities: ['web-fetchable'],
        blocks: [{ type: 'text', content: '' }],
      },
      'u1',
    ));
    expect(result.name).toBe('Bookmark');
    expect(result.capabilities).toEqual(['web-fetchable']);
    expect(result.schema.url).toBeDefined();
  });

  it('rejects unknown capability', async () => {
    const { runDefineItemType } = await import('./item_ops.js');
    const result = await runDefineItemType(
      { name: 'Bad', schema: {}, capabilities: ['auto-syncing'], blocks: [] },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
    expect(result).toMatch(/auto-syncing/);
  });

  it('rejects capability missing its required field', async () => {
    const { runDefineItemType } = await import('./item_ops.js');
    const result = await runDefineItemType(
      { name: 'Bad', schema: {}, capabilities: ['file-readable'], blocks: [] },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
    expect(result).toMatch(/file_path/);
  });

  it('rejects redefining a builtin type', async () => {
    const { runDefineItemType } = await import('./item_ops.js');
    const result = await runDefineItemType(
      { name: 'Repo', schema: { repo_path: { type: 'string', required: true } }, capabilities: ['git-aware'], blocks: [] },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
    expect(result).toMatch(/builtin/);
  });
});
