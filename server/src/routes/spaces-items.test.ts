import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

// Set JWT_SECRET before any module is imported so signToken/verifyToken use it
process.env.JWT_SECRET = 'test-secret-for-spaces-items';

let testDb: Database.Database;

vi.mock('../db/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/index.js')>();
  return { ...actual, getDb: () => testDb };
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
    INSERT INTO spaces VALUES ('sp1', 'u1', 'Test', NULL, '[]');
    INSERT INTO space_items (id, space_id, type, name, source_session_id, created_at, page_blocks, fields)
      VALUES ('item1', 'sp1', 'repo', 'My Repo', NULL, 1, '[]', '{"repo_path":"/tmp/repo"}');
    INSERT INTO item_templates (id, user_id, kind, name, blocks, schema, capabilities, is_builtin) VALUES
      ('tpl_blank', NULL, 'blocks', 'Blank', '[]', '{}', '[]', 1),
      ('tpl_spec', NULL, 'blocks', 'Spec', '[{"type":"heading","level":1,"text":"Overview"}]', '{}', '[]', 1);
  `);
  return db;
}

async function buildApp() {
  vi.resetModules();
  const { default: spacesRouter } = await import('./spaces.js');
  const { signToken } = await import('../lib/jwt.js');
  const app = express();
  app.use(express.json());
  app.use('/', spacesRouter);
  const token = signToken('u1');
  return { app, token };
}

describe('POST/PATCH /spaces/item-templates', () => {
  beforeEach(() => { testDb = setupTestDb(); });

  it('400s creating a template with a malformed block', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/item-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', blocks: [{ type: 'progress', value: 'fifty' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value/);
  });

  it('400s updating a template with a malformed block', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/item-templates/tpl_blank')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocks: [{ type: 'list', items: 'not-an-array' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/items/);
  });
});

describe('POST /spaces/:spaceId/items — template type', () => {
  beforeEach(() => { testDb = setupTestDb(); });

  it('creates an item from a template', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'tpl_spec', name: 'My Doc' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('tpl_spec');
    expect(res.body.page_blocks.length).toBeGreaterThan(0);
    expect(res.body.page_blocks[0].type).toBe('heading');
  });

  it('creates an item with blank template', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'tpl_blank', name: 'Plain Doc' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('tpl_blank');
    expect(res.body.page_blocks).toEqual([]);
  });

  it('404s for an unknown type', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'tpl_nope', name: 'Doc' });
    expect(res.status).toBe(404);
  });

  it('rejects item without name', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'tpl_blank' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /spaces/:spaceId/items/:itemId — blocks', () => {
  beforeEach(() => { testDb = setupTestDb(); });

  it('updates page_blocks on a template item', async () => {
    const db = testDb;
    db.prepare("INSERT INTO space_items (id, space_id, type, name, page_blocks) VALUES ('doc1','sp1','tpl_blank','D','[]')").run();

    const { app, token } = await buildApp();
    const blocks = [{ type: 'heading', level: 1, text: 'Hi' }];
    const res = await request(app)
      .patch('/sp1/items/doc1')
      .set('Authorization', `Bearer ${token}`)
      .send({ page_blocks: blocks });
    expect(res.status).toBe(200);
    expect(res.body.page_blocks[0]).toMatchObject(blocks[0]);
  });

  it('400s a page_blocks replace with a malformed block', async () => {
    const db = testDb;
    db.prepare("INSERT INTO space_items (id, space_id, type, name, page_blocks) VALUES ('doc6','sp1','tpl_blank','D','[]')").run();

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc6')
      .set('Authorization', `Bearer ${token}`)
      .send({ page_blocks: [{ type: 'heading', level: 9, text: 'bad' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/level/);
  });

  it('400s a block_id patch with a malformed block', async () => {
    const db = testDb;
    const blocks = JSON.stringify([{ id: 'stat1', type: 'stat', label: 'Open Issues', value: '14' }]);
    db.prepare("INSERT INTO space_items (id, space_id, type, name, page_blocks) VALUES ('doc7','sp1','tpl_blank','D',?)").run(blocks);

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc7')
      .set('Authorization', `Bearer ${token}`)
      .send({ block_id: 'stat1', block: { id: 'stat1', type: 'stat' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/);
  });

  it('patches a single block by block_id', async () => {
    const db = testDb;
    const blocks = JSON.stringify([
      { id: 'h1', type: 'heading', level: 1, text: 'Title' },
      { id: 'stat1', type: 'stat', label: 'Open Issues', value: '14' },
    ]);
    db.prepare("INSERT INTO space_items (id, space_id, type, name, page_blocks) VALUES ('doc4','sp1','tpl_blank','D',?)").run(blocks);

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc4')
      .set('Authorization', `Bearer ${token}`)
      .send({ block_id: 'stat1', block: { id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' } });
    expect(res.status).toBe(200);
    expect(res.body.page_blocks[0]).toEqual({ id: 'h1', type: 'heading', level: 1, text: 'Title' });
    expect(res.body.page_blocks[1]).toEqual({ id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' });
  });

  it('404s patching an unknown block_id', async () => {
    const db = testDb;
    db.prepare("INSERT INTO space_items (id, space_id, type, name, page_blocks) VALUES ('doc5','sp1','tpl_blank','D','[]')").run();

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc5')
      .set('Authorization', `Bearer ${token}`)
      .send({ block_id: 'nope', block: { type: 'text', content: 'x' } });
    expect(res.status).toBe(404);
  });

  it('updates page_blocks on a repo item', async () => {
    const { app, token } = await buildApp();
    const overview = [{ type: 'text', content: 'Overview' }];
    const res = await request(app)
      .patch('/sp1/items/item1')
      .set('Authorization', `Bearer ${token}`)
      .send({ page_blocks: overview });
    expect(res.status).toBe(200);
    expect(res.body.page_blocks[0]).toMatchObject(overview[0]);
  });
});

describe('PATCH /spaces/:spaceId/items/:itemId/tasks/:taskId', () => {
  beforeEach(() => { testDb = setupTestDb(); });

  it('marks a task done', async () => {
    const db = testDb;
    const blocks = JSON.stringify([{ type: 'task-list', tasks: [{ id: 't1', text: 'Do it', done: false }] }]);
    db.prepare("INSERT INTO space_items (id, space_id, type, name, page_blocks) VALUES ('doc2','sp1','tpl_blank','K',?)").run(blocks);

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc2/tasks/t1')
      .set('Authorization', `Bearer ${token}`)
      .send({ done: true });
    expect(res.status).toBe(200);
    expect(res.body.page_blocks[0].tasks[0].done).toBe(true);
  });

  it('returns 404 for unknown taskId', async () => {
    const db = testDb;
    db.prepare("INSERT INTO space_items (id, space_id, type, name, page_blocks) VALUES ('doc3','sp1','tpl_blank','K','[]')").run();

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc3/tasks/nope')
      .set('Authorization', `Bearer ${token}`)
      .send({ done: true });
    expect(res.status).toBe(404);
  });
});
