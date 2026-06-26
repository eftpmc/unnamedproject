import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';

vi.mock('../../src/services/graphify.js', () => ({
  buildGraph: vi.fn().mockResolvedValue(undefined),
}));

import { initDb, getDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';
import { runAgentPipeline, type AgentPipelineCtx } from '../../src/services/agent_pipeline.js';
import { buildGraph } from '../../src/services/graphify.js';

const userId = newId();

beforeAll(() => {
  process.env.DATA_DIR = `/tmp/agent-pipeline-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `pipeline-${userId}@test.com`, 'x');
});

function makeCtx(overrides: Partial<AgentPipelineCtx> = {}): AgentPipelineCtx {
  return { userId, tool: 'claude_code', repoPath: '/repo', projectId: 'proj-1', graphKey: null, ...overrides };
}

describe('runAgentPipeline', () => {
  it('runs the core and records usage', async () => {
    const ctx = makeCtx();
    await runAgentPipeline(ctx, async () => {
      ctx.result = 'Done.';
      ctx.costUsd = 1.5;
    });
    expect(ctx.result).toBe('Done.');
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

});
