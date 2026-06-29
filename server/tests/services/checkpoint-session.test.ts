import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';
import { recordSessionStateEvent, getSessionState } from '../../src/services/session-state.js';

const DATA_DIR = process.env.DATA_DIR!;

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES ('cp-u','cp@test.com','x')").run();
  db.prepare("INSERT INTO sessions (id, user_id) VALUES ('cp-s','cp-u')").run();
  db.prepare("INSERT INTO sessions (id, user_id) VALUES ('cp-s2','cp-u')").run();
  db.prepare("INSERT INTO sessions (id, user_id) VALUES ('cp-s3','cp-u')").run();
});

afterAll(() => closeDb());

describe('checkpoint_session state management', () => {
  it('set_open_tasks replaces existing tasks', () => {
    recordSessionStateEvent('cp-s', { open_tasks: ['old task A', 'old task B'] });
    let state = getSessionState('cp-s');
    expect(state.open_tasks).toContain('old task A');
    expect(state.open_tasks).toContain('old task B');

    recordSessionStateEvent('cp-s', { set_open_tasks: ['new task only'] });
    state = getSessionState('cp-s');
    expect(state.open_tasks).toEqual(['new task only']);
    expect(state.open_tasks).not.toContain('old task A');
  });

  it('set_open_tasks with empty array clears all tasks', () => {
    recordSessionStateEvent('cp-s', { open_tasks: ['pending task'] });
    recordSessionStateEvent('cp-s', { set_open_tasks: [] });
    const state = getSessionState('cp-s');
    expect(state.open_tasks).toEqual([]);
  });

  it('set_blockers replaces existing blockers', () => {
    recordSessionStateEvent('cp-s2', {
      blockers: ['needs approval', 'waiting for API key'],
    });
    let state = getSessionState('cp-s2');
    expect(state.blockers).toHaveLength(2);

    recordSessionStateEvent('cp-s2', { set_blockers: ['only this blocker now'] });
    state = getSessionState('cp-s2');
    expect(state.blockers).toEqual(['only this blocker now']);
  });

  it('open_tasks (append) does not replace', () => {
    recordSessionStateEvent('cp-s3', { open_tasks: ['task 1'] });
    recordSessionStateEvent('cp-s3', { open_tasks: ['task 2'] });
    const state = getSessionState('cp-s3');
    expect(state.open_tasks).toContain('task 1');
    expect(state.open_tasks).toContain('task 2');
  });

  it('internal blockers (append) coexist with set_blockers (replace) on separate calls', () => {
    // Simulate agent.ts appending a limit-error blocker, then agent replacing via checkpoint
    recordSessionStateEvent('cp-s2', {
      blockers: ['Provider session hit a usage limit.'],
    });
    let state = getSessionState('cp-s2');
    const beforeCount = state.blockers.length;
    expect(state.blockers.some(b => b.includes('usage limit'))).toBe(true);

    // Agent then calls checkpoint_session and declares the current blocker list
    recordSessionStateEvent('cp-s2', { set_blockers: ['resolved: continuing fresh'] });
    state = getSessionState('cp-s2');
    expect(state.blockers).toEqual(['resolved: continuing fresh']);
    expect(beforeCount).toBeGreaterThan(1); // confirm we had multiple before
  });

  it('goal and next_action are preserved across set_open_tasks calls', () => {
    recordSessionStateEvent('cp-s', {
      goal: 'Build the feature',
      next_action: 'Write tests',
    });
    recordSessionStateEvent('cp-s', { set_open_tasks: ['write tests', 'review PR'] });
    const state = getSessionState('cp-s');
    expect(state.goal).toBe('Build the feature');
    expect(state.next_action).toBe('Write tests');
    expect(state.open_tasks).toContain('write tests');
  });
});
