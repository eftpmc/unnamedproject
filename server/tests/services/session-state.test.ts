import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';
import { formatSessionStateBlock, recordSessionStateEvent, updateSessionState } from '../../src/services/session-state.js';

const DATA_DIR = process.env.DATA_DIR!;

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES ('state-u','state@test.com','x')").run();
  db.prepare("INSERT INTO sessions (id, user_id) VALUES ('state-s','state-u')").run();
});

afterAll(() => closeDb());

describe('session state', () => {
  it('extracts compact state from recent turns', () => {
    const db = getDb();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('state-m1','state-s','user','Organize internship applications',1)").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('state-m2','state-s','assistant','Created `index.md` and confirmed real dates. Still need to verify remaining dates.',2)").run();

    const state = updateSessionState('state-s');

    expect(state.goal).toBe('Organize internship applications');
    expect(state.current_focus).toBe('Organize internship applications');
    expect(state.facts.join(' ')).toContain('Created');
    expect(state.open_tasks.join(' ')).toContain('Created');
    expect(state.artifacts).toContain('index.md');
    expect(state.files_touched).toContain('index.md');

    const block = formatSessionStateBlock('state-s');
    expect(block).toContain('Structured session state');
    expect(block).toContain('Current focus');
    expect(block).toContain('Files touched');
    expect(block).toContain('index.md');
  });

  it('records lifecycle events without assistant transcript text', () => {
    const state = recordSessionStateEvent('state-s', {
      blockers: ['Provider session hit a usage limit.'],
      open_tasks: ['Continue from structured state.'],
      repo_state: 'Working tree has uncommitted changes in server/src/services/session-state.ts.',
      files_touched: ['server/src/services/session-state.ts'],
      verification: ['npx vitest run tests/services/session-state.test.ts passed.'],
      handoff_notes: ['Fresh provider sessions should use structured session state first.'],
      next_action: 'Start fresh.',
    });

    expect(state.blockers).toContain('Provider session hit a usage limit.');
    expect(state.open_tasks).toContain('Continue from structured state.');
    expect(state.repo_state).toContain('uncommitted changes');
    expect(state.files_touched).toContain('server/src/services/session-state.ts');
    expect(state.verification.join(' ')).toContain('vitest');
    const block = formatSessionStateBlock('state-s');
    expect(block).toContain('Handoff notes');
    expect(block).toContain('Start fresh.');
  });

  it('captures canonical handoff details from assistant summaries', () => {
    const db = getDb();
    db.prepare("INSERT INTO sessions (id, user_id) VALUES ('state-canonical','state-u')").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('canonical-m1','state-canonical','user','Continue the token saving work',20)").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('canonical-m2','state-canonical','assistant','Updated `server/src/services/session-state.ts` and `web/src/types.ts`. Working tree has uncommitted changes. Verification: npx vitest run tests/services/session-state.test.ts passed. Handoff: fresh provider sessions should continue from the checkpoint.',21)").run();

    const state = updateSessionState('state-canonical');

    expect(state.current_focus).toBe('Continue the token saving work');
    expect(state.files_touched).toContain('server/src/services/session-state.ts');
    expect(state.files_touched).toContain('web/src/types.ts');
    expect(state.repo_state).toContain('Working tree');
    expect(state.verification.join(' ')).toContain('vitest');
    expect(state.handoff_notes.join(' ')).toContain('fresh provider sessions');
  });

  it('promotes repeated browser no-op failures into blockers', () => {
    const db = getDb();
    db.prepare("INSERT INTO sessions (id, user_id) VALUES ('state-browser','state-u')").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('browser-m1','state-browser','user','try login',10)").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('browser-m2','state-browser','assistant','Still on the password screen. The click reports success but nothing happens.',11)").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('browser-m3','state-browser','user','try again',12)").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('browser-m4','state-browser','assistant','Same screen again: password click reports success, but no navigation.',13)").run();

    const state = updateSessionState('state-browser');

    expect(state.failed_attempts).toContain('browser login/password action did not progress');
    expect(state.blockers.join(' ')).toContain('Do not retry the same browser action');
    expect(state.next_action).toBe('Switch browser automation strategy or ask the user for manual intervention.');
  });
});
