import { describe, it, expect, vi } from 'vitest';
import { runGitOp } from '../../src/tools/git_op.js';

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    log: vi.fn().mockResolvedValue({ all: [{ hash: 'abc123def', message: 'initial commit' }] }),
    diff: vi.fn().mockResolvedValue('--- a/file.ts\n+++ b/file.ts\n'),
    status: vi.fn().mockResolvedValue({ files: [] }),
    commit: vi.fn().mockResolvedValue({ commit: 'abc123' }),
    push: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('../../src/services/executor.js', () => ({
  requestApproval: vi.fn().mockResolvedValue({ decision: 'approved' }),
  appendOutput: vi.fn(),
}));

const ctx = { userId: 'u1', executionId: 'e1', projectId: 'p1', repoPath: '/tmp/repo' };

describe('git_op', () => {
  it('runs read op (log) without approval', async () => {
    const result = await runGitOp({ op: 'log' }, ctx);
    expect(result).toContain('initial commit');
  });

  it('runs write op (commit) after approval', async () => {
    const result = await runGitOp({ op: 'commit', message: 'fix: auth bug' }, ctx);
    expect(result).toContain('committed');
  });

  it('returns rejection message when user rejects', async () => {
    const { requestApproval } = await import('../../src/services/executor.js');
    vi.mocked(requestApproval).mockResolvedValueOnce({ decision: 'rejected' });
    const result = await runGitOp({ op: 'push', branch: 'agent/test' }, ctx);
    expect(result).toContain('rejected');
  });
});
