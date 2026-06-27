import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { buildContext } from '../../src/services/context.js';
import { DEFAULT_INTENT } from '../../src/services/intent.js';
import type { Intent } from '../../src/services/intent.js';

const userId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `ctx-${userId}@test.com`, 'x');
  sessionId = newId();
  getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
});

const codeIntent: Intent = { ...DEFAULT_INTENT, domain: 'code' };
const writingIntent: Intent = { ...DEFAULT_INTENT, domain: 'writing' };
const researchIntent: Intent = { ...DEFAULT_INTENT, domain: 'research' };

describe('buildContext', () => {
  it('always includes base identity and approval tier content', async () => {
    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('personal AI assistant');
    expect(ctx).toContain('Auto-approved');
  });

  it('always includes research discipline block', async () => {
    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('Research discipline');
    expect(ctx).toContain('Web search');
  });

  it('includes worktree isolation guidance for code domain', async () => {
    const ctx = await buildContext(userId, sessionId, codeIntent, '');
    // Permission block mentions isolated worktrees; code domain mandates git_op commit
    expect(ctx).toContain('worktree');
    expect(ctx).toContain('git_op');
  });

  it('includes write_document guidance for writing domain', async () => {
    const ctx = await buildContext(userId, sessionId, writingIntent, '');
    expect(ctx).toContain('write_document');
    // The writing domain guidance must steer away from delegating to coding agents.
    expect(ctx).toContain('Do not invoke coding agents');
  });

  it('includes citation guidance for research domain', async () => {
    const ctx = await buildContext(userId, sessionId, researchIntent, '');
    expect(ctx).toContain('Cite');
  });

  it('omits agent usage block for non-code, non-multi domains', async () => {
    const ctx = await buildContext(userId, sessionId, writingIntent, '');
    expect(ctx).not.toContain('## Agent usage');
  });

  it('includes session summary when present', async () => {
    getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run('Earlier we discussed auth', sessionId);
    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('Earlier we discussed auth');
    getDb().prepare('UPDATE sessions SET summary = NULL WHERE id = ?').run(sessionId);
  });

  it('includes project name and id in project context', async () => {
    const spaceId = newId();
    getDb()
      .prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(spaceId, userId, 'sandbox-demo', 'A sandbox project', '[]');
    getDb().prepare('UPDATE sessions SET pinned_space_id = ? WHERE id = ?').run(spaceId, sessionId);

    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).toContain('sandbox-demo');
    expect(ctx).toContain(spaceId);

    getDb().prepare('UPDATE sessions SET pinned_space_id = NULL WHERE id = ?').run(sessionId);
  });

  it('project context block does not reference a project type label', async () => {
    const spaceId = newId();
    getDb()
      .prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(spaceId, userId, 'type-check-project', 'Testing no type label', '[]');
    getDb().prepare('UPDATE sessions SET pinned_space_id = ? WHERE id = ?').run(spaceId, sessionId);

    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    expect(ctx).not.toMatch(/type:\s*(default|video)/);

    getDb().prepare('UPDATE sessions SET pinned_space_id = NULL WHERE id = ?').run(sessionId);
  });

  it('includes document guidance for a Space with no projects or documents', async () => {
    const spaceId = newId();
    getDb()
      .prepare('INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)')
      .run(spaceId, userId, 'empty-space', '[]');
    getDb().prepare('UPDATE sessions SET pinned_space_id = ? WHERE id = ?').run(spaceId, sessionId);

    const ctx = await buildContext(userId, sessionId, DEFAULT_INTENT, '');
    // New doctrine: space without projects should mention create_project or documents
    expect(ctx).toMatch(/create_project|write_document|No projects/);

    getDb().prepare('UPDATE sessions SET pinned_space_id = NULL WHERE id = ?').run(sessionId);
    getDb().prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
  });
});
