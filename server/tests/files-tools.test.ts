import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb } from '../src/db/index.js';
import { createProject } from '../src/services/projects.js';
import { registerFileHandlers } from '../src/mcp/handlers/files.js';
import { getTool } from '../src/mcp/registry.js';

let projectId: string;
let filesPath: string;
const userId = 'u-filetools';
const sessionId = 'session-filetools';

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT OR IGNORE INTO users (id,email,hashed_password) VALUES (?,?,?)').run(userId, 'filetools@test.com', 'x');
  const project = await createProject({ name: 'FileToolsProj', user_id: userId });
  projectId = project.id;
  filesPath = project.files_path;
  getDb().prepare('INSERT OR IGNORE INTO sessions (id,user_id,pinned_project_id) VALUES (?,?,?)').run(sessionId, userId, projectId);
  registerFileHandlers();
});

describe('file MCP tools', () => {
  it('writes binary artifacts from base64 into project files', async () => {
    const pdfBytes = Buffer.from('%PDF-1.5\n% test pdf\n');
    const created = JSON.parse(await getTool('write_binary_file')!.handler({
      project_id: projectId,
      path: 'resumes/generated.pdf',
      title: 'Generated Resume',
      tags: { type: 'resume', status: 'final' },
      data_base64: pdfBytes.toString('base64'),
    }, userId, sessionId)) as { path: string; mime_type: string; type: string; status: string };

    expect(created.path).toBe('resumes/generated.pdf');
    expect(created.mime_type).toBe('application/pdf');
    expect(created.type).toBe('resume');
    expect(created.status).toBe('final');
    expect(fs.readFileSync(path.join(filesPath, 'resumes/generated.pdf'))).toEqual(pdfBytes);
  });

  it('promotes a local artifact into project files and registers it', async () => {
    const localPath = path.join(process.env.DATA_DIR!, 'agent-workspaces', sessionId, 'session', 'outputs', 'scratch-artifact.pdf');
    const data = Buffer.from('%PDF-1.5\n% promoted pdf\n');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, data);

    const promoted = JSON.parse(await getTool('promote_artifact')!.handler({
      project_id: projectId,
      source_path: 'session/outputs/scratch-artifact.pdf',
      path: 'resumes/promoted.pdf',
      title: 'Promoted Resume',
      tags: { type: 'resume', status: 'final' },
    }, userId, sessionId)) as { id: string; path: string; mime_type: string };

    expect(promoted.path).toBe('resumes/promoted.pdf');
    expect(promoted.mime_type).toBe('application/pdf');
    expect(fs.readFileSync(path.join(filesPath, 'resumes/promoted.pdf'))).toEqual(data);

    const listed = JSON.parse(await getTool('list_files')!.handler({ project_id: projectId, type: 'resume' }, userId, null)) as Array<{ id: string; path: string }>;
    expect(listed.map(f => f.path)).toContain('resumes/promoted.pdf');
  });
});
