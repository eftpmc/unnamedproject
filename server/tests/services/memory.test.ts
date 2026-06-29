import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { rememberFact, recallFact, forgetFact, recallAll, projectNameFor, recallRelevant } from '../../src/services/memory.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('../../src/services/embeddings.js', () => ({
  embed: vi.fn().mockResolvedValue(new Float32Array(384)),
  cosineSimilarity: (a: Float32Array, b: Float32Array) => {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  },
  bufferToFloat32Array: (buf: Buffer) => new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
  float32ArrayToBuffer: (arr: Float32Array) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength),
}));

const userId = newId();

function makeProject(ownerId: string, name: string): string {
  const spaceId = newId();
  const projectId = newId();
  getDb().prepare("INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)").run(spaceId, ownerId, name, '[]');
  getDb().prepare("INSERT INTO projects (id, space_id, user_id, name, repo_path, default_branch, origin, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(projectId, spaceId, ownerId, name, `/tmp/${projectId}`, null, 'linked', Math.floor(Date.now() / 1000));
  return projectId;
}

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `mem-${userId}@test.com`, 'x');
});

describe('memory', () => {
  it('stores and recalls a fact', () => {
    rememberFact(userId, 'user', 'preferred_model', 'claude-opus-4-8');
    expect(recallFact(userId, 'user', 'preferred_model')).toBe('claude-opus-4-8');
  });

  it('updates an existing key', () => {
    rememberFact(userId, 'user', 'preferred_model', 'claude-sonnet-4-6');
    expect(recallFact(userId, 'user', 'preferred_model')).toBe('claude-sonnet-4-6');
  });

  it('returns null for missing key', () => {
    expect(recallFact(userId, 'user', 'nonexistent')).toBeNull();
  });

  it('keeps separate values per type for the same key', () => {
    rememberFact(userId, 'user', 'shared_key', 'user-value');
    rememberFact(userId, 'feedback', 'shared_key', 'feedback-value');
    expect(recallFact(userId, 'user', 'shared_key')).toBe('user-value');
    expect(recallFact(userId, 'feedback', 'shared_key')).toBe('feedback-value');
  });

  it('returns all entries for a user, optionally filtered by type', () => {
    rememberFact(userId, 'reference', 'bug_tracker', 'Linear project INGEST');
    const all = recallAll(userId);
    expect(all.some(e => e.type === 'user' && e.key === 'preferred_model')).toBe(true);
    expect(all.some(e => e.type === 'feedback' && e.key === 'shared_key')).toBe(true);
    expect(all.some(e => e.type === 'reference' && e.key === 'bug_tracker')).toBe(true);

    const onlyFeedback = recallAll(userId, 'feedback');
    expect(onlyFeedback.every(e => e.type === 'feedback')).toBe(true);
    expect(onlyFeedback.some(e => e.key === 'shared_key')).toBe(true);
  });

  it('forgets a fact', () => {
    rememberFact(userId, 'user', 'temp_fact', 'temporary');
    expect(forgetFact(userId, 'user', 'temp_fact')).toBe(true);
    expect(recallFact(userId, 'user', 'temp_fact')).toBeNull();
    expect(forgetFact(userId, 'user', 'temp_fact')).toBe(false);
  });

  it('stores project-linked entries with a project_id', () => {
    const projectId = makeProject(userId, 'demo-project');
    rememberFact(userId, 'project', 'auth_status', 'blocked on legal review', projectId);
    const all = recallAll(userId, 'project');
    const entry = all.find(e => e.key === 'auth_status');
    expect(entry?.project_id).toBe(projectId);
    expect(projectNameFor(userId, projectId)).toBe('demo-project');
  });

  it('projectNameFor returns null for null project_id', () => {
    expect(projectNameFor(userId, null)).toBeNull();
  });
});

describe('recallRelevant', () => {
  const relUserId = newId();

  beforeAll(() => {
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(relUserId, `rel-${relUserId}@test.com`, 'x');
    rememberFact(relUserId, 'feedback', 'always_commit', 'commit after every change');
    rememberFact(relUserId, 'user', 'preferred_language', 'TypeScript');
    rememberFact(relUserId, 'user', 'slack_workspace', 'company.slack.com');
    rememberFact(relUserId, 'reference', 'bug_tracker', 'Linear INGEST project for pipeline bugs');
    rememberFact(relUserId, 'reference', 'design_system', 'Figma link for UI components');
  });

  it('always includes all feedback entries', async () => {
    const result = await recallRelevant(relUserId, 'explain research');
    expect(result.some(e => e.type === 'feedback' && e.key === 'always_commit')).toBe(true);
  });

  it('filters project memories to pinned project when provided', async () => {
    const projectId = makeProject(relUserId, `proj-${relUserId}`);
    rememberFact(relUserId, 'project', 'auth_decision', 'using JWT with RS256', projectId);
    rememberFact(relUserId, 'project', 'other_note', 'unrelated project fact');

    const withPin = await recallRelevant(relUserId, 'fix code', projectId);
    expect(withPin.some(e => e.type === 'project' && e.key === 'auth_decision')).toBe(true);
    expect(withPin.some(e => e.type === 'project' && e.key === 'other_note')).toBe(false);
  });

  it('caps user memories at 10 entries', async () => {
    const bigUserId = newId();
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(bigUserId, `big-${bigUserId}@test.com`, 'x');
    for (let i = 0; i < 15; i++) {
      rememberFact(bigUserId, 'user', `key_${i}`, `value ${i}`);
    }
    const result = await recallRelevant(bigUserId, 'fix code');
    expect(result.filter(e => e.type === 'user').length).toBeLessThanOrEqual(10);
  });
});
