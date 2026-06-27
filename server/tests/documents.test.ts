import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { writeDocument, readDocument, listDocuments, patchFrontmatter, deleteDocument } from '../src/services/documents.js';

const SPACE = 'space-docs';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u1','docs@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u1', 'Docs');
});

describe('documents service', () => {
  it('writes a document to disk and indexes frontmatter', async () => {
    const doc = await writeDocument({
      space_id: SPACE, path: 'application-acme.md', title: 'Acme',
      frontmatter: { type: 'application', status: 'applied', company: 'Acme' },
      body: '# Acme\nNotes',
    });
    expect(doc.type).toBe('application');
    expect(doc.status).toBe('applied');
    const back = await readDocument(doc.id);
    expect(back?.body).toContain('# Acme');
    expect(back?.frontmatter.company).toBe('Acme');
  });

  it('filters by type and frontmatter field', async () => {
    await writeDocument({ space_id: SPACE, path: 'resume.md', title: 'Resume', frontmatter: { type: 'resume' }, body: '# Resume' });
    const apps = listDocuments(SPACE, { type: 'application' });
    expect(apps.map(d => d.path)).toContain('application-acme.md');
    expect(apps.map(d => d.path)).not.toContain('resume.md');
    const acme = listDocuments(SPACE, { frontmatter: { company: 'Acme' } });
    expect(acme).toHaveLength(1);
  });

  it('patches frontmatter and reflects in index + file', async () => {
    const [app] = listDocuments(SPACE, { type: 'application' });
    const updated = await patchFrontmatter(app.id, { status: 'interview' });
    expect(updated?.status).toBe('interview');
    const back = await readDocument(app.id);
    expect(back?.frontmatter.status).toBe('interview');
  });

  it('deletes a document', async () => {
    const doc = await writeDocument({ space_id: SPACE, path: 'tmp.md', title: 'Tmp', body: 'x' });
    expect(await deleteDocument(doc.id)).toBe(true);
    expect(await readDocument(doc.id)).toBeUndefined();
  });
});
