import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb, getDb } from '../src/db/index.js';

let token: string;
let projectId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `campaigns-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
  const proj = await request(app)
    .post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'test-project', enabled_connection_ids: [] });
  projectId = proj.body.id;
});

describe('campaigns DB', () => {
  it('campaigns table exists with correct columns', () => {
    const cols = getDb()
      .prepare("SELECT name FROM pragma_table_info('campaigns')")
      .all() as { name: string }[];
    const names = cols.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('project_id');
    expect(names).toContain('session_id');
    expect(names).toContain('title');
    expect(names).toContain('status');
    expect(names).toContain('created_at');
    expect(names).toContain('completed_at');
  });

  it('campaign_tasks table exists with correct columns', () => {
    const cols = getDb()
      .prepare("SELECT name FROM pragma_table_info('campaign_tasks')")
      .all() as { name: string }[];
    const names = cols.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('campaign_id');
    expect(names).toContain('title');
    expect(names).toContain('agent');
    expect(names).toContain('status');
    expect(names).toContain('execution_id');
    expect(names).toContain('position');
  });
});
