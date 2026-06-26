import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import { getDb, initDb } from '../../src/db/index.js';
import {
  createDocumentItem,
  createFileItem,
  createRepoItem,
  deleteItem,
  getItemById,
  getItemsForSpace,
} from '../../src/services/items.js';

beforeAll(() => {
  process.env.DATA_DIR = `/tmp/items-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u1', 'a@b.com', 'h')").run();
  db.prepare("INSERT INTO spaces (id, user_id, name) VALUES ('sp1', 'u1', 'Space One')").run();
  expect(db.pragma('foreign_key_check')).toEqual([]);
});

describe('items service', () => {
  it('creates and hydrates every subtype', () => {
    const repo = createRepoItem({
      space_id: 'sp1',
      name: 'my-repo',
      repo_path: '/repos/my-repo',
      default_branch: 'main',
    });
    const file = createFileItem({
      space_id: 'sp1',
      name: 'notes.txt',
      file_path: '/files/notes.txt',
      size_bytes: 42,
      mime_type: 'text/plain',
    });
    const doc = createDocumentItem({ space_id: 'sp1', name: 'My Doc', template_id: 'tpl_blank', blocks: [] });

    expect(getItemById(repo.id)).toMatchObject({ type: 'repo', repo_path: '/repos/my-repo', default_branch: 'main' });
    expect(getItemById(file.id)).toMatchObject({ type: 'file', file_path: '/files/notes.txt', size_bytes: 42 });
    expect(getItemById(doc.id)).toMatchObject({ type: 'document', template_id: 'tpl_blank', blocks: [] });
  });

  it('sets provenance fields and lists mixed items', () => {
    const generated = createDocumentItem({
      space_id: 'sp1',
      name: 'Generated Report',
      template_id: 'tpl_blank',
      blocks: [],
      source_session_id: null,
    });
    expect(generated).toMatchObject({
      source_session_id: null,
    });
    expect(getItemsForSpace('sp1').map(item => item.type)).toEqual(
      expect.arrayContaining(['repo', 'file', 'document']),
    );
  });

  it('rolls back the base row when subtype creation fails', () => {
    const before = (getDb().prepare('SELECT COUNT(*) AS count FROM space_items').get() as { count: number }).count;
    expect(() => createRepoItem({
      space_id: 'missing-space',
      name: 'invalid',
      repo_path: '/repos/invalid',
    })).toThrow();
    const after = (getDb().prepare('SELECT COUNT(*) AS count FROM space_items').get() as { count: number }).count;
    expect(after).toBe(before);
  });

  it('deletes the subtype row through cascade', () => {
    const created = createFileItem({ space_id: 'sp1', name: 'temp.txt', file_path: '/files/temp.txt' });
    deleteItem(created.id);
    expect(getItemById(created.id)).toBeUndefined();
    expect(getDb().prepare('SELECT 1 FROM space_files WHERE item_id = ?').get(created.id)).toBeUndefined();
  });
});
