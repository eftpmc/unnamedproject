import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb, recordAgentUsage, setAgentBudget } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { buildContext, getToolSubset } from '../../src/services/context.js';
import { DEFAULT_INTENT } from '../../src/services/intent.js';
import type { Intent } from '../../src/services/intent.js';
import { toolDefinitions } from '../../src/tools/definitions.js';

const userId = newId();
let sessionId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `ctx-${userId}@test.com`, 'x');
  sessionId = newId();
  getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
});

const codeIntent: Intent = { ...DEFAULT_INTENT, domain: 'code', scope: 'delegate' };
const writingIntent: Intent = { ...DEFAULT_INTENT, domain: 'writing', scope: 'inline' };
const researchIntent: Intent = { ...DEFAULT_INTENT, domain: 'research', scope: 'inline' };

describe('buildContext', () => {
  it('always includes base identity and approval tier content', () => {
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('orchestrator');
    expect(ctx).toContain('auto-approved');
  });

  it('always includes research discipline block', () => {
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('web_fetch');
    expect(ctx).toContain('web_search');
  });

  it('includes worktree isolation guidance for code domain', () => {
    const ctx = buildContext(userId, sessionId, codeIntent);
    expect(ctx).toContain('worktree');
    expect(ctx).toContain('invoke_claude_code');
  });

  it('includes write_file guidance for writing domain', () => {
    const ctx = buildContext(userId, sessionId, writingIntent);
    expect(ctx).toContain('write_file');
    expect(ctx).not.toContain('invoke_claude_code');
  });

  it('includes citation guidance for research domain', () => {
    const ctx = buildContext(userId, sessionId, researchIntent);
    expect(ctx).toContain('Cite');
  });

  it('includes agent usage block for code domain, reflecting budgets and spend', () => {
    setAgentBudget(userId, 'claude_code', 20);
    recordAgentUsage(userId, 'claude_code', 5);
    recordAgentUsage(userId, 'codex', 1.5);

    const ctx = buildContext(userId, sessionId, codeIntent);
    expect(ctx).toContain('Agent usage this month');
    expect(ctx).toContain('Claude Code (invoke_claude_code): $5.00 / $20.00 used (25%)');
    expect(ctx).toContain('Codex (invoke_codex): $1.50 spent (no budget set)');
  });

  it('omits agent usage block for non-code, non-multi domains', () => {
    const ctx = buildContext(userId, sessionId, writingIntent);
    expect(ctx).not.toContain('Agent usage this month');
  });

  it('includes session summary when present', () => {
    getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run('Earlier we discussed auth', sessionId);
    const ctx = buildContext(userId, sessionId, DEFAULT_INTENT);
    expect(ctx).toContain('Earlier we discussed auth');
    getDb().prepare('UPDATE sessions SET summary = NULL WHERE id = ?').run(sessionId);
  });
});

describe('getToolSubset', () => {
  it('code domain includes invoke_claude_code and git_op', () => {
    const tools = getToolSubset(codeIntent);
    const names = tools.map(t => t.name);
    expect(names).toContain('invoke_claude_code');
    expect(names).toContain('git_op');
  });

  it('code domain includes web_search (research tools are universal)', () => {
    const tools = getToolSubset(codeIntent);
    expect(tools.map(t => t.name)).toContain('web_search');
  });

  it('writing domain excludes invoke_claude_code', () => {
    const tools = getToolSubset(writingIntent);
    expect(tools.map(t => t.name)).not.toContain('invoke_claude_code');
  });

  it('research domain excludes invoke_claude_code and git_op', () => {
    const tools = getToolSubset(researchIntent);
    const names = tools.map(t => t.name);
    expect(names).not.toContain('invoke_claude_code');
    expect(names).not.toContain('git_op');
  });

  it('general domain returns all tools', () => {
    const tools = getToolSubset(DEFAULT_INTENT); // domain=general
    expect(tools.length).toBe(toolDefinitions.length);
  });

  it('multi domain returns all tools', () => {
    const multiIntent: Intent = { ...DEFAULT_INTENT, domain: 'multi' };
    const tools = getToolSubset(multiIntent);
    expect(tools.length).toBe(toolDefinitions.length);
  });
});
