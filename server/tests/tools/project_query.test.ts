import { describe, it, expect, vi } from 'vitest';
import { runProjectQuery } from '../../src/tools/project_query.js';

vi.mock('../../src/db/index.js', () => ({
  getProjectByIdForUser: vi.fn(),
}));

vi.mock('../../src/services/projects.js', () => ({
  getProject: vi.fn(),
}));

vi.mock('../../src/services/graphify.js', () => ({
  hasGraph: vi.fn().mockResolvedValue(true),
  buildGraph: vi.fn().mockResolvedValue(undefined),
  queryGraph: vi.fn().mockResolvedValue('auth.ts handles JWT verification'),
}));

describe('project_query', () => {
  it('returns a message when project not found', async () => {
    const { getProjectByIdForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectByIdForUser).mockReturnValue(undefined);

    const result = await runProjectQuery({ project_id: 'p1', question: 'what does this do?' }, 'u1');
    expect(result).toContain('not found');
  });

  it('queries the graph when the project has a repo_path', async () => {
    const { getProjectByIdForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectByIdForUser).mockReturnValue(
      { id: 'proj-1', space_id: 's1', user_id: 'u1', name: 'api', repo_path: '/tmp/repo', description: null, enabled_connection_ids: '[]' },
    );

    const result = await runProjectQuery({ project_id: 'proj-1', question: 'where is auth handled?' }, 'u1');
    expect(result).toBe('auth.ts handles JWT verification');
  });

  it('builds the graph first if it does not exist', async () => {
    const { getProjectByIdForUser } = await import('../../src/db/index.js');
    const { hasGraph, buildGraph } = await import('../../src/services/graphify.js');
    vi.mocked(getProjectByIdForUser).mockReturnValue(
      { id: 'proj-2', space_id: 's2', user_id: 'u1', name: 'api', repo_path: '/tmp/repo2', description: null, enabled_connection_ids: '[]' },
    );
    vi.mocked(hasGraph).mockResolvedValueOnce(false);

    await runProjectQuery({ project_id: 'proj-2', question: 'what is this?' }, 'u1');
    expect(buildGraph).toHaveBeenCalledWith('/tmp/repo2', 'proj-2');
  });
});
