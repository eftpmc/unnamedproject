import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDb, initDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { createArtifact, createTextArtifact, listProjectArtifacts, resolveArtifactContentPath } from './artifacts.js';

let projectId: string;
let userId: string;

describe('artifacts service', () => {
  beforeEach(() => {
    fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
    initDb();
    projectId = newId();
    userId = newId();
    const db = getDb();
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)')
      .run(userId, `${newId()}@test.com`, 'x');
    db.prepare('INSERT INTO projects (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)')
      .run(projectId, userId, 'Artifacts', '[]');
  });

  it('creates and lists a generic text artifact with resolvable content', async () => {
    const artifact = await createTextArtifact({
      project_id: projectId,
      kind: 'research',
      title: 'Research Summary',
      content: '# Findings\n\nUseful details.',
      status: 'review',
      metadata: { producer: 'test' },
    });

    const artifacts = listProjectArtifacts(projectId);
    expect(artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        kind: 'research',
        title: 'Research Summary',
        mime_type: 'text/markdown',
        status: 'review',
        content_url: `/projects/${projectId}/artifacts/${artifact.id}/content`,
      }),
    ]);

    const resolved = resolveArtifactContentPath(projectId, artifact.id);
    expect(resolved?.mimeType).toBe('text/markdown');
    expect(fs.readFileSync(resolved!.filePath, 'utf-8')).toContain('Useful details.');
  });

  it('creates a URL-backed media artifact without duplicating the filesystem bridge', () => {
    const mediaDir = path.join(process.env.DATA_DIR!, 'projects', projectId, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'clip.mp4'), 'fake');

    createArtifact({
      project_id: projectId,
      kind: 'media',
      title: 'Clip',
      mime_type: 'video/mp4',
      path: 'media/clip.mp4',
      url: `/projects/${projectId}/media/clip.mp4`,
    });

    const artifacts = listProjectArtifacts(projectId).filter(a => a.path === 'media/clip.mp4');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: 'media', title: 'Clip', url: `/projects/${projectId}/media/clip.mp4` });
  });
});
