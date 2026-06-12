import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';

vi.mock('../../src/services/graphify.js', () => ({
  buildGraph: vi.fn().mockResolvedValue(undefined),
}));

import { initDb, getDb, setAgentBudget, recordAgentUsage, getMonthlyUsage } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { runAgentPipeline, type AgentPipelineCtx } from '../../src/services/agent_pipeline.js';
import { buildGraph } from '../../src/services/graphify.js';

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `pipeline-${userId}@test.com`, 'x');
});

function makeCtx(overrides: Partial<AgentPipelineCtx> = {}): AgentPipelineCtx {
  return { userId, tool: 'claude_code', repoPath: '/repo', projectId: 'proj-1', graphKey: null, ...overrides };
}

describe('runAgentPipeline', () => {
  it('runs the core and records usage when no budget is set', async () => {
    const ctx = makeCtx();
    await runAgentPipeline(ctx, async () => {
      ctx.result = 'Done.';
      ctx.costUsd = 1.5;
    });
    expect(ctx.result).toBe('Done.');
    expect(getMonthlyUsage(userId, 'claude_code')).toBeGreaterThanOrEqual(1.5);
  });

  it('triggers a graph rebuild on success', async () => {
    const ctx = makeCtx({ projectId: 'proj-graph' });
    await runAgentPipeline(ctx, async () => {
      ctx.result = 'Done.';
      ctx.costUsd = 0;
    });
    expect(buildGraph).toHaveBeenCalledWith('/repo', 'proj-graph', null);
  });

  it('does not rebuild the graph when the core returns an error', async () => {
    vi.mocked(buildGraph).mockClear();
    const ctx = makeCtx({ projectId: 'proj-error' });
    await runAgentPipeline(ctx, async () => {
      ctx.result = 'Error: something broke';
    });
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it('short-circuits before running the core when the monthly budget is exhausted', async () => {
    const budgetUserId = newId();
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(budgetUserId, `pipeline-budget-${budgetUserId}@test.com`, 'x');
    setAgentBudget(budgetUserId, 'codex', 10);
    recordAgentUsage(budgetUserId, 'codex', 10);

    const core = vi.fn(async () => {});
    const ctx = makeCtx({ userId: budgetUserId, tool: 'codex' });
    await runAgentPipeline(ctx, core);

    expect(core).not.toHaveBeenCalled();
    expect(ctx.result).toContain('monthly budget for Codex');
  });

  it('allows the run when spend is below budget', async () => {
    const okUserId = newId();
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(okUserId, `pipeline-ok-${okUserId}@test.com`, 'x');
    setAgentBudget(okUserId, 'codex', 10);
    recordAgentUsage(okUserId, 'codex', 5);

    const ctx = makeCtx({ userId: okUserId, tool: 'codex' });
    await runAgentPipeline(ctx, async () => {
      ctx.result = 'Done.';
      ctx.costUsd = 1;
    });

    expect(ctx.result).toBe('Done.');
    expect(getMonthlyUsage(okUserId, 'codex')).toBeCloseTo(6);
  });
});
