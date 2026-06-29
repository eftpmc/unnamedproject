import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb, getDb } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';

// Mock simple-git for worktree and merge endpoints
const mockStatus = vi.fn().mockResolvedValue({ files: [] });
const mockRaw = vi.fn().mockResolvedValue('3\n');
const mockMerge = vi.fn().mockResolvedValue({});
vi.mock('simple-git', () => ({
  default: vi.fn(() => ({ status: mockStatus, raw: mockRaw, merge: mockMerge })),
}));

let token: string;
let userId: string;
let sessionId: string;
let projectId: string;
let spaceId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const reg = await request(app)
    .post('/auth/register')
    .send({ email: `sess-new-${Date.now()}@test.com`, password: 'pass' });
  token = reg.body.token;

  const { verifyToken } = await import('../src/lib/jwt.js');
  userId = verifyToken(reg.body.token).userId;

  const sessRes = await request(app)
    .post('/sessions')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'test' });
  sessionId = sessRes.body.id;

  const db = getDb();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
    .run(newId(), sessionId, 'user', 'keep session active for route tests');

  // Create a space then a project in that space
  spaceId = newId();
  projectId = newId();
  db.prepare("INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)").run(spaceId, userId, 'myspace', '[]');
  db.prepare("INSERT INTO projects (id, space_id, user_id, name, repo_path, default_branch, origin, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(projectId, spaceId, userId, 'myproj', '/fake/repo', null, 'linked', Math.floor(Date.now() / 1000));
});

describe('PATCH /sessions/:id pinned_project_id', () => {
  it('pins a project to a session', async () => {
    const res = await request(app)
      .patch(`/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pinned_project_id: projectId });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const list = await request(app).get('/sessions').set('Authorization', `Bearer ${token}`);
    const sess = list.body.find((s: { id: string }) => s.id === sessionId);
    expect(sess.pinned_project_id).toBe(projectId);

    const events = await request(app)
      .get(`/sessions/${sessionId}/events`)
      .set('Authorization', `Bearer ${token}`);
    expect(events.status).toBe(200);
    expect(events.body.projects).toHaveLength(1);
    expect(events.body.projects[0]).toMatchObject({ id: projectId, name: 'myproj', source: 'user' });
    expect(events.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'scope_changed',
        title: 'Scoped to myproj',
        metadata: expect.objectContaining({ source: 'user' }),
      }),
    ]));
  });

  it('unpins a project (null)', async () => {
    const res = await request(app)
      .patch(`/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pinned_project_id: null });
    expect(res.status).toBe(200);

    const events = await request(app)
      .get(`/sessions/${sessionId}/events`)
      .set('Authorization', `Bearer ${token}`);
    expect(events.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'scope_changed',
        title: 'Back to Auto',
        metadata: expect.objectContaining({ source: 'user' }),
      }),
    ]));
  });

  it('keeps legacy pinned context available when switching back to auto', async () => {
    const legacy = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'legacy pin' });

    getDb()
      .prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?')
      .run(projectId, legacy.body.id);

    const res = await request(app)
      .patch(`/sessions/${legacy.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pinned_project_id: null });
    expect(res.status).toBe(200);

    const events = await request(app)
      .get(`/sessions/${legacy.body.id}/events`)
      .set('Authorization', `Bearer ${token}`);
    expect(events.body.projects).toEqual([
      expect.objectContaining({ id: projectId, name: 'myproj', source: 'user' }),
    ]);
    expect(events.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'scope_changed', title: 'Back to Auto' }),
    ]));
  });

  it('rejects pinning a project that does not belong to the user', async () => {
    const missingProjectId = newId();
    const res = await request(app)
      .patch(`/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pinned_project_id: missingProjectId });
    expect(res.status).toBe(404);

    const list = await request(app).get('/sessions').set('Authorization', `Bearer ${token}`);
    const sess = list.body.find((s: { id: string }) => s.id === sessionId);
    expect(sess.pinned_project_id).toBeNull();
  });
});

describe('GET /sessions/:id/worktree', () => {
  it('returns null when no worktree exists', async () => {
    const res = await request(app)
      .get(`/sessions/${sessionId}/worktree`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('returns worktree info when worktree exists', async () => {
    const db = getDb();
    const wtId = newId();
    db.prepare("INSERT INTO agent_worktrees (id, project_id, session_id, branch, worktree_path) VALUES (?,?,?,?,?)")
      .run(wtId, projectId, sessionId, `agent/${sessionId}`, '/fake/worktree');

    mockStatus.mockResolvedValueOnce({ files: [{ path: 'foo.ts' }] });
    mockRaw.mockResolvedValueOnce('3\n');

    const res = await request(app)
      .get(`/sessions/${sessionId}/worktree`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.branch).toBe(`agent/${sessionId}`);
    expect(res.body.project_name).toBe('myproj');
    expect(res.body.files_changed).toBe(1);
    expect(res.body.ahead).toBe(3);
    expect(res.body.has_uncommitted).toBe(true);
  });
});

describe('POST /sessions/:id/merge', () => {
  it('returns 404 when no worktree exists for a fresh session', async () => {
    const newSess = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const res = await request(app)
      .post(`/sessions/${newSess.body.id}/merge`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('merges the branch when worktree exists', async () => {
    mockMerge.mockResolvedValueOnce({});
    const res = await request(app)
      .post(`/sessions/${sessionId}/merge`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 422 on merge conflict', async () => {
    mockMerge.mockRejectedValueOnce(new Error('CONFLICT'));
    const res = await request(app)
      .post(`/sessions/${sessionId}/merge`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('CONFLICT');
  });
});
