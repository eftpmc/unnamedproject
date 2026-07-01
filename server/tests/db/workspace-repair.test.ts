import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { closeDb, getDb, initDb } from '../../src/db/index.js';
import { APP_ROOT } from '../../src/lib/workspacePaths.js';

describe('project workspace repair', () => {
  it('moves existing app-managed project paths out of the app repository on startup', () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const dataDir = path.join(APP_ROOT, 'data', `workspace-repair-${suffix}`);
    const workspaceRoot = path.join('/tmp', `workspace-repair-${suffix}`);
    process.env.DATA_DIR = dataDir;
    process.env.UNNAMED_WORKSPACE_ROOT = workspaceRoot;

    closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    initDb(dataDir);

    const oldRepoPath = path.join(dataDir, 'projects', 'p-old');
    const oldFilesPath = path.join(oldRepoPath, 'files');
    fs.mkdirSync(oldFilesPath, { recursive: true });
    fs.writeFileSync(path.join(oldRepoPath, 'README.md'), 'old repo');
    fs.writeFileSync(path.join(oldFilesPath, 'resume.md'), 'old file');
    getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u-repair','repair@test','x')").run();
    getDb()
      .prepare("INSERT INTO projects (id,user_id,name,repo_path,files_path,origin,created_at) VALUES ('p-old','u-repair','Old',?,?, 'created', 1)")
      .run(oldRepoPath, oldFilesPath);

    closeDb();
    initDb(dataDir);

    const project = getDb().prepare("SELECT repo_path, files_path FROM projects WHERE id = 'p-old'").get() as {
      repo_path: string;
      files_path: string;
    };
    expect(project.repo_path).toBe(path.join(workspaceRoot, 'projects', 'u-repair', 'p-old'));
    expect(project.files_path).toBe(path.join(project.repo_path, 'files'));
    expect(fs.existsSync(path.join(project.repo_path, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(project.files_path, 'resume.md'))).toBe(true);
  });
});
