import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { documentsDir, ensureDocumentsRepo, commitDocuments, resolveInDocuments } from '../src/lib/spaceFs.js';

describe('spaceFs', () => {
  beforeAll(() => { fs.mkdirSync(process.env.DATA_DIR!, { recursive: true }); });

  it('initializes a git repo in documents dir', async () => {
    await ensureDocumentsRepo('space-a');
    expect(fs.existsSync(path.join(documentsDir('space-a'), '.git'))).toBe(true);
  });

  it('commits document changes', async () => {
    await ensureDocumentsRepo('space-b');
    fs.writeFileSync(path.join(documentsDir('space-b'), 'note.md'), '# hi\n');
    await commitDocuments('space-b', 'add note');
    const log = await simpleGit(documentsDir('space-b')).log();
    expect(log.total).toBe(1);
    expect(log.latest?.message).toBe('add note');
  });

  it('rejects path escape', () => {
    expect(() => resolveInDocuments('space-a', '../../etc/passwd')).toThrow();
  });
});
