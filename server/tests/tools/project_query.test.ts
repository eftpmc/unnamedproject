import { describe, it, expect, vi } from 'vitest';
import { runProjectQuery } from '../../src/tools/project_query.js';

vi.mock('../../src/services/graphify.js', () => ({
  queryGraph: vi.fn().mockResolvedValue('graph result'),
}));

vi.mock('../../src/db/index.js', () => ({
  getProjectForUser: vi.fn(),
}));

describe('project_query', () => {
  it('returns a message when the project has no repo', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectForUser).mockReturnValue({ id: 'p1', name: 'notes', description: null, repo_path: null, enabled_connection_ids: '[]' });

    const result = await runProjectQuery({ project_id: 'p1', question: 'what does this do?' }, 'u1');
    expect(result).toContain('no repo');
  });

  it('queries the graph when the project has a repo', async () => {
    const { getProjectForUser } = await import('../../src/db/index.js');
    vi.mocked(getProjectForUser).mockReturnValue({ id: 'p1', name: 'api', description: null, repo_path: '/tmp/repo', enabled_connection_ids: '[]' });

    const result = await runProjectQuery({ project_id: 'p1', question: 'what does this do?' }, 'u1');
    expect(result).toBe('graph result');
  });
});
