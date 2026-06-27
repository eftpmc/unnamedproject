import { describe, it, expect, vi } from 'vitest';
import { runProjectQuery } from '../../src/tools/project_query.js';

vi.mock('../../src/db/index.js', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined) }),
  }),
  getSpaceForUser: vi.fn(),
  getDataDir: vi.fn().mockReturnValue('/tmp/test-data'),
}));

vi.mock('../../src/services/projects.js', () => ({
  getProject: vi.fn(),
}));

vi.mock('../../src/services/graphify.js', () => ({
  hasGraph: vi.fn().mockResolvedValue(true),
  buildGraph: vi.fn().mockResolvedValue(undefined),
  queryGraph: vi.fn().mockResolvedValue('auth.ts handles JWT verification'),
}));

vi.mock('../../src/routes/connections.js', () => ({
  getDecryptedConfig: vi.fn().mockReturnValue({}),
}));

describe('project_query', () => {
  it('returns a message when space not found', async () => {
    const { getSpaceForUser } = await import('../../src/db/index.js');
    vi.mocked(getSpaceForUser).mockReturnValue(undefined);

    const result = await runProjectQuery({ space_id: 'p1', item_id: 'proj-1', question: 'what does this do?' }, 'u1');
    expect(result).toContain('not found');
  });

  it('returns a message when the project is not in the space', async () => {
    const { getSpaceForUser } = await import('../../src/db/index.js');
    const { getProject } = await import('../../src/services/projects.js');
    vi.mocked(getSpaceForUser).mockReturnValue({ id: 'p1', name: 'notes', description: null, enabled_connection_ids: '[]' });
    vi.mocked(getProject).mockReturnValue(undefined);

    const result = await runProjectQuery({ space_id: 'p1', item_id: 'proj-1', question: 'what does this do?' }, 'u1');
    expect(result).toContain('not found');
  });

  it('queries the graph when the project has a repo_path', async () => {
    const { getSpaceForUser } = await import('../../src/db/index.js');
    const { getProject } = await import('../../src/services/projects.js');
    vi.mocked(getSpaceForUser).mockReturnValue({ id: 'p1', name: 'api', description: null, enabled_connection_ids: '[]' });
    vi.mocked(getProject).mockReturnValue(
      { id: 'proj-1', space_id: 'p1', name: 'api', repo_path: '/tmp/repo', default_branch: null, origin: null, created_at: 0 },
    );

    const result = await runProjectQuery({ space_id: 'p1', item_id: 'proj-1', question: 'where is auth handled?' }, 'u1');
    expect(result).toBe('auth.ts handles JWT verification');
  });

  it('builds the graph first if it does not exist', async () => {
    const { getSpaceForUser } = await import('../../src/db/index.js');
    const { getProject } = await import('../../src/services/projects.js');
    const { hasGraph, buildGraph } = await import('../../src/services/graphify.js');
    vi.mocked(getSpaceForUser).mockReturnValue({ id: 'p2', name: 'api', description: null, enabled_connection_ids: '[]' });
    vi.mocked(getProject).mockReturnValue(
      { id: 'proj-2', space_id: 'p2', name: 'api', repo_path: '/tmp/repo2', default_branch: null, origin: null, created_at: 0 },
    );
    vi.mocked(hasGraph).mockResolvedValueOnce(false);

    await runProjectQuery({ space_id: 'p2', item_id: 'proj-2', question: 'what is this?' }, 'u1');
    expect(buildGraph).toHaveBeenCalledWith('/tmp/repo2', 'proj-2');
  });
});
