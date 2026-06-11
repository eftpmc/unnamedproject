import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { rememberFact, recallFact, forgetFact, recallAll, projectNameFor } from '../../src/services/memory.js';
import { newId } from '../../src/lib/ids.js';

const userId = newId();

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
    const projectId = newId();
    getDb().prepare('INSERT INTO projects (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)')
      .run(projectId, userId, 'demo-project', '[]');

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
