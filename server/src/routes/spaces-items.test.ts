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
    INSERT INTO spaces VALUES ('sp1', 'u1', 'Test', NULL, '[]');
    INSERT INTO space_items VALUES ('item1', 'sp1', 'repo', 'My Repo', NULL, NULL, NULL, 1);
    INSERT INTO space_repos VALUES ('item1', '/tmp/repo', NULL, NULL);
    INSERT INTO item_templates (id, user_id, kind, name, blocks, item_type, is_builtin) VALUES
      ('tpl_document', NULL, 'blocks', 'Document', '[{"type":"text","content":""}]', 'document', 1),
      ('tpl_spec', NULL, 'blocks', 'Spec', '[{"type":"heading","level":1,"text":"Overview"}]', 'document', 1);
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
      .patch('/item-templates/tpl_document')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocks: [{ type: 'list', items: 'not-an-array' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/items/);
  });
});

describe('POST /spaces/:spaceId/items — document type', () => {
  beforeEach(() => { testDb = setupTestDb(); });

  it('creates a document item from a template', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'document', name: 'My Doc', template_id: 'tpl_spec' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('document');
    expect(res.body.template_id).toBe('tpl_spec');
    expect(res.body.blocks.length).toBeGreaterThan(0);
    expect(res.body.blocks[0].type).toBe('heading');
  });

  it('uses the plain Document template when template_id omitted', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'document', name: 'Plain Doc' });
    expect(res.status).toBe(201);
    expect(res.body.template_id).toBe('tpl_document');
  });

  it('404s for an unknown template_id', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'document', name: 'Doc', template_id: 'tpl_nope' });
    expect(res.status).toBe(404);
  });

  it('rejects document without name', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'document', template_id: 'tpl_document' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /spaces/:spaceId/items/:itemId — blocks', () => {
  beforeEach(() => { testDb = setupTestDb(); });

  it('updates blocks on a document item', async () => {
    // first create a document
    const db = testDb;
    db.prepare("INSERT INTO space_items VALUES ('doc1','sp1','document','D',NULL,NULL,NULL,1)").run();
    db.prepare("INSERT INTO space_documents VALUES ('doc1','document','[]')").run();

    const { app, token } = await buildApp();
    const blocks = [{ type: 'heading', level: 1, text: 'Hi' }];
    const res = await request(app)
      .patch('/sp1/items/doc1')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocks });
    expect(res.status).toBe(200);
    expect(res.body.blocks).toEqual(blocks);
  });

  it('400s a blocks replace with a malformed block', async () => {
    const db = testDb;
    db.prepare("INSERT INTO space_items VALUES ('doc6','sp1','document','D',NULL,NULL,NULL,1)").run();
    db.prepare("INSERT INTO space_documents VALUES ('doc6','document','[]')").run();

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc6')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocks: [{ type: 'heading', level: 9, text: 'bad' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/level/);
  });

  it('400s a block_id patch with a malformed block', async () => {
    const db = testDb;
    const blocks = JSON.stringify([{ id: 'stat1', type: 'stat', label: 'Open Issues', value: '14' }]);
    db.prepare("INSERT INTO space_items VALUES ('doc7','sp1','document','D',NULL,NULL,NULL,1)").run();
    db.prepare("INSERT INTO space_documents VALUES ('doc7','document',?)").run(blocks);

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
    db.prepare("INSERT INTO space_items VALUES ('doc4','sp1','document','D',NULL,NULL,NULL,1)").run();
    db.prepare("INSERT INTO space_documents VALUES ('doc4','document',?)").run(blocks);

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc4')
      .set('Authorization', `Bearer ${token}`)
      .send({ block_id: 'stat1', block: { id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' } });
    expect(res.status).toBe(200);
    expect(res.body.blocks[0]).toEqual({ id: 'h1', type: 'heading', level: 1, text: 'Title' });
    expect(res.body.blocks[1]).toEqual({ id: 'stat1', type: 'stat', label: 'Open Issues', value: '9' });
  });

  it('404s patching an unknown block_id', async () => {
    const db = testDb;
    db.prepare("INSERT INTO space_items VALUES ('doc5','sp1','document','D',NULL,NULL,NULL,1)").run();
    db.prepare("INSERT INTO space_documents VALUES ('doc5','document','[]')").run();

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc5')
      .set('Authorization', `Bearer ${token}`)
      .send({ block_id: 'nope', block: { type: 'text', content: 'x' } });
    expect(res.status).toBe(404);
  });

  it('updates overview_blocks on a repo item', async () => {
    const { app, token } = await buildApp();
    const overview = [{ type: 'text', content: 'Overview' }];
    const res = await request(app)
      .patch('/sp1/items/item1')
      .set('Authorization', `Bearer ${token}`)
      .send({ overview_blocks: overview });
    expect(res.status).toBe(200);
    expect(res.body.overview_blocks).toEqual(overview);
  });
});

describe('PATCH /spaces/:spaceId/items/:itemId/tasks/:taskId', () => {
  beforeEach(() => { testDb = setupTestDb(); });

  it('marks a task done', async () => {
    const db = testDb;
    const blocks = JSON.stringify([{ type: 'task-list', tasks: [{ id: 't1', text: 'Do it', done: false }] }]);
    db.prepare("INSERT INTO space_items VALUES ('doc2','sp1','document','K',NULL,NULL,NULL,1)").run();
    db.prepare("INSERT INTO space_documents VALUES ('doc2','kanban',?)").run(blocks);

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc2/tasks/t1')
      .set('Authorization', `Bearer ${token}`)
      .send({ done: true });
    expect(res.status).toBe(200);
    expect(res.body.blocks[0].tasks[0].done).toBe(true);
  });

  it('returns 404 for unknown taskId', async () => {
    const db = testDb;
    db.prepare("INSERT INTO space_items VALUES ('doc3','sp1','document','K',NULL,NULL,NULL,1)").run();
    db.prepare("INSERT INTO space_documents VALUES ('doc3','kanban','[]')").run();

    const { app, token } = await buildApp();
    const res = await request(app)
      .patch('/sp1/items/doc3/tasks/nope')
      .set('Authorization', `Bearer ${token}`)
      .send({ done: true });
    expect(res.status).toBe(404);
  });
});
