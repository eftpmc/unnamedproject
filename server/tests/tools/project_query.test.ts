import { describe, it, expect, vi } from 'vitest';
import { runProjectQuery } from '../../src/tools/project_query.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn((ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') cb(Buffer.from(JSON.stringify({ result: 'auth.ts handles JWT verification' }))); }) },
    stderr: { on: vi.fn() },
    on: vi.fn((ev: string, cb: (code: number) => void) => { if (ev === 'close') cb(0); }),
  })),
}));

vi.mock('../../src/db/index.js', () => ({
  getProjectForUser: vi.fn(),
}));

vi.mock('../../src/services/anthropic.js', () => ({
  getAnthropicKey: vi.fn().mockReturnValue('sk-test'),
}));

vi.mock('../../src/lib/worktree.js', () => ({
  ensureWorktree: vi.fn().mockResolvedValue({ id: 'wt1', worktree_path: '/tmp/repo-worktree', branch: 'agent/s1' }),
}));

describe('project_query', () => {
  it('returns a message when the project has no repo', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectForUser).mockReturnValue({ id: 'p1', name: 'notes', description: null, repo_path: null, enabled_connection_ids: '[]' });

    const result = await runProjectQuery({ project_id: 'p1', question: 'what does this do?', session_id: 's1' }, 'u1');
    expect(result).toContain('no repo');
  });

  it('queries the codebase when the project has a repo', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectForUser).mockReturnValue({ id: 'p1', name: 'api', description: null, repo_path: '/tmp/repo', enabled_connection_ids: '[]' });

    const result = await runProjectQuery({ project_id: 'p1', question: 'what does this do?', session_id: 's1' }, 'u1');
    expect(result).toBe('auth.ts handles JWT verification');
  });
});
