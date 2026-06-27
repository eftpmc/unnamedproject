import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { registerProjectHandlers } from '../src/mcp/handlers/projects.js';
import { getTool } from '../src/mcp/registry.js';

const SPACE = 'space-projtools';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u','pt@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u', 'S');
  registerProjectHandlers();
});

describe('project tools', () => {
  it('create_project then list_projects', async () => {
    const created = JSON.parse(await getTool('create_project')!.handler({ space_id: SPACE, name: 'Repo' }, 'u', null));
    expect(created.origin).toBe('created');
    const list = JSON.parse(await getTool('list_projects')!.handler({ space_id: SPACE }, 'u', null));
    expect(list.map((p: { id: string }) => p.id)).toContain(created.id);
  });
});
