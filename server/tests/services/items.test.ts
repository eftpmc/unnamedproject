import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import { getDb, initDb } from '../../src/db/index.js';
import {
  createItem,
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
});

describe('items service', () => {
  it('creates and hydrates repo and file items via unified createItem', () => {
    const repo = createItem({
      space_id: 'sp1',
      name: 'my-repo',
      type: 'repo',
      page_blocks: [],
      fields: { repo_path: '/repos/my-repo', default_branch: 'main' },
    });
    const file = createItem({
      space_id: 'sp1',
      name: 'notes.txt',
      type: 'file',
      page_blocks: [],
      fields: { file_path: '/files/notes.txt', size_bytes: 42, mime_type: 'text/plain' },
    });
    const blank = createItem({ space_id: 'sp1', name: 'My Doc', type: 'blank', page_blocks: [], fields: {} });

    expect(getItemById(repo.id)).toMatchObject({ type: 'repo', fields: { repo_path: '/repos/my-repo', default_branch: 'main' } });
    expect(getItemById(file.id)).toMatchObject({ type: 'file', fields: { file_path: '/files/notes.txt', size_bytes: 42 } });
    expect(getItemById(blank.id)).toMatchObject({ type: 'blank' });
  });

  it('sets provenance fields and lists mixed items', () => {
    const generated = createItem({
      space_id: 'sp1',
      name: 'Generated Report',
      type: 'blank',
      page_blocks: [],
      fields: {},
      source_session_id: null,
    });
    expect(generated.source_session_id).toBeNull();
    const types = getItemsForSpace('sp1').map(item => item.type);
    expect(types).toContain('repo');
    expect(types).toContain('file');
    expect(types).toContain('blank');
  });

  it('throws when inserting into a non-existent space', () => {
    expect(() => createItem({
      space_id: 'missing-space',
      name: 'invalid',
      type: 'repo',
      page_blocks: [],
      fields: { repo_path: '/repos/invalid' },
    })).toThrow();
  });

  it('deletes item and it disappears from queries', () => {
    const created = createItem({ space_id: 'sp1', name: 'temp.txt', type: 'file', page_blocks: [], fields: { file_path: '/files/temp.txt' } });
    deleteItem(created.id);
    expect(getItemById(created.id)).toBeUndefined();
  });
});
