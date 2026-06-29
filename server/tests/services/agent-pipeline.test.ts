/**
 * Integration test for the cost + session-state → invocation-mode pipeline.
 * Tests the exact DB queries from agent.ts (lines ~169-181) without invoking
 * the provider, to catch regressions in how cost and blockers flow into mode selection.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';
import { recordSessionStateEvent, getSessionState } from '../../src/services/session-state.js';
import { selectInvocationMode } from '../../src/services/invocation-policy.js';

const DATA_DIR = process.env.DATA_DIR!;

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES ('ap-u','ap@test.com','x')").run();
  db.prepare("INSERT INTO sessions (id, user_id, provider_session_id) VALUES ('ap-s1','ap-u','prov-123')").run();
  db.prepare("INSERT INTO sessions (id, user_id, provider_session_id) VALUES ('ap-s2','ap-u','prov-456')").run();
  db.prepare("INSERT INTO sessions (id, user_id, provider_session_id) VALUES ('ap-s3','ap-u','prov-789')").run();
});

afterAll(() => closeDb());

function queryCost(sessionId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM agent_usage WHERE session_id = ?')
    .get(sessionId) as { total: number };
  return row.total;
}

describe('agent turn pipeline: cost + state → invocation mode', () => {
  it('session with no usage cost resumes normally under message threshold', () => {
    const cost = queryCost('ap-s1');
    const state = getSessionState('ap-s1');
    const mode = selectInvocationMode({
      providerSessionId: 'prov-123',
      prompt: 'keep going',
      messageCount: 5,
      sessionCostUsd: cost,
      blockers: state.blockers,
    });
    expect(cost).toBe(0);
    expect(mode).toBe('resume_provider_session');
  });

  it('session exceeding cost threshold triggers fresh start', () => {
    const db = getDb();
    db.prepare("INSERT INTO agent_usage (id, user_id, tool, cost_usd, session_id) VALUES ('au-1','ap-u','claude_code',3.00,'ap-s2')").run();

    const cost = queryCost('ap-s2');
    const state = getSessionState('ap-s2');
    const mode = selectInvocationMode({
      providerSessionId: 'prov-456',
      prompt: 'keep going',
      messageCount: 5,
      sessionCostUsd: cost,
      blockers: state.blockers,
    });
    expect(cost).toBe(3.00);
    expect(mode).toBe('fresh_with_summary');
  });

  it('loop blocker in session state forces fresh regardless of cost', () => {
    recordSessionStateEvent('ap-s3', {
      blockers: ['browser click action reported success without progress repeatedly. Do not retry the same browser action; switch strategy or ask for manual intervention.'],
    });

    const cost = queryCost('ap-s3'); // no usage rows — cost is 0
    const state = getSessionState('ap-s3');
    const mode = selectInvocationMode({
      providerSessionId: 'prov-789',
      prompt: 'try again',
      messageCount: 3,
      sessionCostUsd: cost,
      blockers: state.blockers,
    });
    expect(cost).toBe(0);
    expect(state.blockers.some(b => /repeatedly/i.test(b))).toBe(true);
    expect(mode).toBe('fresh_with_summary');
  });

  it('accumulated cost across multiple usage rows is summed correctly', () => {
    const db = getDb();
    db.prepare("INSERT INTO agent_usage (id, user_id, tool, cost_usd, session_id) VALUES ('au-2','ap-u','claude_code',0.80,'ap-s1')").run();
    db.prepare("INSERT INTO agent_usage (id, user_id, tool, cost_usd, session_id) VALUES ('au-3','ap-u','codex',0.90,'ap-s1')").run();
    db.prepare("INSERT INTO agent_usage (id, user_id, tool, cost_usd, session_id) VALUES ('au-4','ap-u','claude_code',1.00,'ap-s1')").run();

    const cost = queryCost('ap-s1');
    expect(cost).toBeCloseTo(2.70, 5);

    const state = getSessionState('ap-s1');
    const mode = selectInvocationMode({
      providerSessionId: 'prov-123',
      prompt: 'continue',
      messageCount: 8,
      sessionCostUsd: cost,
      blockers: state.blockers,
    });
    expect(mode).toBe('fresh_with_summary');
  });
});
