import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { registerDocumentHandlers } from '../src/mcp/handlers/documents.js';
import { getTool } from '../src/mcp/registry.js';
import { newId } from '../src/lib/ids.js';

let projectId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const spaceId = newId();
  projectId = newId();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u','dt@test.com','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(spaceId, 'u', 'DocToolsSpace');
  getDb().prepare("INSERT INTO projects (id,space_id,user_id,name,repo_path,default_branch,origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(projectId, spaceId, 'u', 'DocToolsProj', '/tmp/doctools', null, 'linked', Math.floor(Date.now() / 1000));
  registerDocumentHandlers();
});

describe('document tools', () => {
  it('write_document then list_documents by type', async () => {
    await getTool('write_document')!.handler(
      { project_id: projectId, path: 'a.md', title: 'A', frontmatter: { type: 'note' }, body: '# A' }, 'u', null);
    const out = await getTool('list_documents')!.handler({ project_id: projectId, type: 'note' }, 'u', null);
    expect(JSON.parse(out)).toHaveLength(1);
  });

  it('patch_frontmatter updates status', async () => {
    const created = JSON.parse(await getTool('write_document')!.handler(
      { project_id: projectId, path: 'b.md', title: 'B', frontmatter: { type: 'application', status: 'found' }, body: '# B' }, 'u', null));
    const patched = JSON.parse(await getTool('patch_frontmatter')!.handler(
      { id: created.id, patch: { status: 'applied' } }, 'u', null));
    expect(patched.status).toBe('applied');
  });
});
