import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { projectFilesDir, ensureFilesRepo, commitFiles, resolveInFiles } from '../src/lib/spaceFs.js';

describe('spaceFs', () => {
  beforeAll(() => { fs.mkdirSync(process.env.DATA_DIR!, { recursive: true }); });

  it('initializes a git repo in project files dir', async () => {
    const filesPath = projectFilesDir('project-a');
    await ensureFilesRepo(filesPath);
    expect(fs.existsSync(path.join(filesPath, '.git'))).toBe(true);
  });

  it('commits file changes', async () => {
    const filesPath = projectFilesDir('project-b');
    await ensureFilesRepo(filesPath);
    fs.writeFileSync(path.join(filesPath, 'note.md'), '# hi\n');
    await commitFiles(filesPath, 'add note');
    const log = await simpleGit(filesPath).log();
    expect(log.total).toBe(1);
    expect(log.latest?.message).toBe('add note');
  });

  it('rejects path escape', () => {
    expect(() => resolveInFiles(projectFilesDir('project-a'), '../../etc/passwd')).toThrow();
  });
});
