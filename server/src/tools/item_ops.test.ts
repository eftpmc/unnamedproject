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
    CREATE TABLE item_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      blocks TEXT,
      item_type TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT INTO spaces VALUES ('sp1', 'u1', 'Test Space', NULL, '[]');
    INSERT INTO space_items VALUES ('repo1', 'sp1', 'repo', 'My Repo', NULL, NULL, NULL, 1);
    INSERT INTO space_repos VALUES ('repo1', '/tmp/repo', NULL, NULL);
    INSERT INTO item_templates (id, user_id, kind, name, blocks, item_type, is_builtin) VALUES
      ('tpl_document', NULL, 'blocks', 'Document', '[{"type":"text","content":""}]', 'document', 1),
      ('tpl_spec', NULL, 'blocks', 'Spec', '[{"type":"heading","level":1,"text":"Overview"}]', 'document', 1);
  `);
  return db;
}

describe('runCreateItem', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('creates a document item and returns JSON with id', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Test Doc', type: 'document', template_id: 'tpl_spec' },
      'u1',
    ));
    expect(result.type).toBe('document');
    expect(result.template_id).toBe('tpl_spec');
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

  it('links a created item to a session and plan step when provenance is passed', async () => {
    const { runCreateItem } = await import('./item_ops.js');
    const result = JSON.parse(await runCreateItem(
      {
        space_id: 'sp1',
        name: 'Tracked Doc',
        type: 'document',
        source_session_id: 'sess1',
        source_plan_id: 'plan1',
        source_step_id: 'step1',
      },
      'u1',
    ));
    expect(result.source_session_id).toBe('sess1');
    expect(result.source_plan_id).toBe('plan1');
    expect(result.source_step_id).toBe('step1');
  });
});

describe('runUpdateItem', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('updates document blocks', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'document', template_id: 'tpl_document' },
      'u1',
    ));
    const newBlocks: Block[] = [{ type: 'text', content: 'updated' }];
    const result = JSON.parse(await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, blocks: newBlocks },
      'u1',
    ));
    expect(result.blocks).toEqual(newBlocks);
  });

  it('patches a single block by block_id without touching the rest', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const blocks: Block[] = [
      { id: 'h1', type: 'heading', level: 1, text: 'Title' },
      { id: 'stat1', type: 'stat', label: 'Open Issues', value: '14' },
    ];
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'document', template_id: 'tpl_document' },
      'u1',
    ));
    await runUpdateItem({ space_id: 'sp1', item_id: created.id, blocks }, 'u1');
    const result = JSON.parse(await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, block_id: 'stat1', block: { id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' } },
      'u1',
    ));
    expect(result.blocks[0]).toEqual(blocks[0]);
    expect(result.blocks[1]).toEqual({ id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' });
  });

  it('rejects a malformed block in a full blocks replace', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'document', template_id: 'tpl_document' },
      'u1',
    ));
    const result = await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, blocks: [{ type: 'heading', level: 9, text: 'bad' } as unknown as Block] },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
    expect(result).toMatch(/level/);
  });

  it('rejects a malformed block in a block_id patch', async () => {
    const { runCreateItem, runUpdateItem } = await import('./item_ops.js');
    const blocks: Block[] = [{ id: 'stat1', type: 'stat', label: 'Issues', value: '14' }];
    const created = JSON.parse(await runCreateItem(
      { space_id: 'sp1', name: 'Doc', type: 'document', template_id: 'tpl_document' },
      'u1',
    ));
    await runUpdateItem({ space_id: 'sp1', item_id: created.id, blocks }, 'u1');
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
      { space_id: 'sp1', name: 'Doc', type: 'document', template_id: 'tpl_document' },
      'u1',
    ));
    const result = await runUpdateItem(
      { space_id: 'sp1', item_id: created.id, block_id: 'nope', block: { type: 'text', content: 'x' } },
      'u1',
    );
    expect(result).toMatch(/^Error:/);
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

describe('runCreateItemTemplate / runUpdateItemTemplate', () => {
  beforeEach(() => { testDb = setupTestDb(); vi.resetModules(); });

  it('creates a custom template with valid blocks', async () => {
    const { runCreateItemTemplate } = await import('./item_ops.js');
    const result = JSON.parse(await runCreateItemTemplate(
      { name: 'Dashboard', blocks: [{ id: 's1', type: 'stat', label: 'Issues', value: '14' }] },
      'u1',
    ));
    expect(result.name).toBe('Dashboard');
    expect(result.kind).toBe('blocks');
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
