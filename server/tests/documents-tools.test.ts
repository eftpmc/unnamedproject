import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { registerDocumentHandlers } from '../src/mcp/handlers/documents.js';
import { getTool } from '../src/mcp/registry.js';

const SPACE = 'space-doctools';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u','dt@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u', 'S');
  registerDocumentHandlers();
});

describe('document tools', () => {
  it('write_document then list_documents by type', async () => {
    await getTool('write_document')!.handler(
      { space_id: SPACE, path: 'a.md', title: 'A', frontmatter: { type: 'note' }, body: '# A' }, 'u', null);
    const out = await getTool('list_documents')!.handler({ space_id: SPACE, type: 'note' }, 'u', null);
    expect(JSON.parse(out)).toHaveLength(1);
  });

  it('patch_frontmatter updates status', async () => {
    const created = JSON.parse(await getTool('write_document')!.handler(
      { space_id: SPACE, path: 'b.md', title: 'B', frontmatter: { type: 'application', status: 'found' }, body: '# B' }, 'u', null));
    const patched = JSON.parse(await getTool('patch_frontmatter')!.handler(
      { id: created.id, patch: { status: 'applied' } }, 'u', null));
    expect(patched.status).toBe('applied');
  });
});
