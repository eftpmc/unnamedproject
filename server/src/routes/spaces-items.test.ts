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
    INSERT INTO spaces VALUES ('sp1', 'u1', 'Test', NULL, '[]');
    INSERT INTO space_items VALUES ('item1', 'sp1', 'repo', 'My Repo', NULL, NULL, NULL, 1);
    INSERT INTO space_repos VALUES ('item1', '/tmp/repo', NULL, NULL);
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

describe('POST /spaces/:spaceId/items — document type', () => {
  beforeEach(() => { testDb = setupTestDb(); });

  it('creates a document item with blocks', async () => {
    const { app, token } = await buildApp();
    const blocks = [{ type: 'text', content: 'hello' }];
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'document', name: 'My Doc', template: 'spec', blocks });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('document');
    expect(res.body.template).toBe('spec');
    expect(res.body.blocks).toEqual(blocks);
  });

  it('uses template starter blocks when blocks omitted', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'document', name: 'Spec Doc', template: 'spec' });
    expect(res.status).toBe(201);
    expect(res.body.blocks.length).toBeGreaterThan(0);
    expect(res.body.blocks[0].type).toBe('heading');
  });

  it('rejects document without name', async () => {
    const { app, token } = await buildApp();
    const res = await request(app)
      .post('/sp1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'document', template: 'document' });
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
