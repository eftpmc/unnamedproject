import { describe, it, expect, vi } from 'vitest';
import { runProjectQuery } from '../../src/tools/project_query.js';

vi.mock('../../src/db/index.js', () => ({
  getProjectForUser: vi.fn(),
  getDataDir: vi.fn().mockReturnValue('/tmp/test-data'),
}));

vi.mock('../../src/services/graphify.js', () => ({
  hasGraph: vi.fn().mockResolvedValue(true),
  buildGraph: vi.fn().mockResolvedValue(undefined),
  queryGraph: vi.fn().mockResolvedValue('auth.ts handles JWT verification'),
}));

describe('project_query', () => {
  it('returns a message when project not found', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectForUser).mockReturnValue(undefined);

    const result = await runProjectQuery({ project_id: 'p1', question: 'what does this do?' }, 'u1');
    expect(result).toContain('not found');
  });

  it('returns a message when the project has no repo', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectForUser).mockReturnValue({ id: 'p1', name: 'notes', description: null, repo_path: null, enabled_connection_ids: '[]' });

    const result = await runProjectQuery({ project_id: 'p1', question: 'what does this do?' }, 'u1');
    expect(result).toContain('no repo');
  });

  it('queries the graph when the project has a repo', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectForUser).mockReturnValue({ id: 'p1', name: 'api', description: null, repo_path: '/tmp/repo', enabled_connection_ids: '[]' });

    const result = await runProjectQuery({ project_id: 'p1', question: 'where is auth handled?' }, 'u1');
    expect(result).toBe('auth.ts handles JWT verification');
  });

  it('builds the graph first if it does not exist', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    const { hasGraph, buildGraph } = await import('../../src/services/graphify.js');
    vi.mocked(getProjectForUser).mockReturnValue({ id: 'p2', name: 'api', description: null, repo_path: '/tmp/repo2', enabled_connection_ids: '[]' });
    vi.mocked(hasGraph).mockResolvedValueOnce(false);

    await runProjectQuery({ project_id: 'p2', question: 'what is this?' }, 'u1');
    expect(buildGraph).toHaveBeenCalledWith('/tmp/repo2', 'p2');
  });
});
