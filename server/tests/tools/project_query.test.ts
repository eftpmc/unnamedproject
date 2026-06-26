import { describe, it, expect, vi } from 'vitest';
import { runProjectQuery } from '../../src/tools/project_query.js';

vi.mock('../../src/db/index.js', () => ({
  getSpaceForUser: vi.fn(),
  getDataDir: vi.fn().mockReturnValue('/tmp/test-data'),
}));

vi.mock('../../src/services/items.js', () => ({
  getItemById: vi.fn(),
}));

vi.mock('../../src/services/graphify.js', () => ({
  hasGraph: vi.fn().mockResolvedValue(true),
  buildGraph: vi.fn().mockResolvedValue(undefined),
  queryGraph: vi.fn().mockResolvedValue('auth.ts handles JWT verification'),
}));

describe('project_query', () => {
  it('returns a message when project not found', async () => {
    const { getSpaceForUser } = await import('../../src/db/index.js');
    vi.mocked(getSpaceForUser).mockReturnValue(undefined);

    const result = await runProjectQuery({ space_id: 'p1', item_id: 'item-1', question: 'what does this do?' }, 'u1');
    expect(result).toContain('not found');
  });

  it('returns a message when the space has no repo', async () => {
    const { getSpaceForUser } = await import('../../src/db/index.js');
    const { getItemById } = await import('../../src/services/items.js');
    vi.mocked(getSpaceForUser).mockReturnValue({ id: 'p1', name: 'notes', description: null, enabled_connection_ids: '[]' });
    vi.mocked(getItemById).mockReturnValue(undefined);

    const result = await runProjectQuery({ space_id: 'p1', item_id: 'item-1', question: 'what does this do?' }, 'u1');
    expect(result).toContain('not found');
  });

  it('queries the graph when the space has a repo', async () => {
    const { getSpaceForUser } = await import('../../src/db/index.js');
    const { getItemById } = await import('../../src/services/items.js');
    vi.mocked(getSpaceForUser).mockReturnValue({ id: 'p1', name: 'api', description: null, enabled_connection_ids: '[]' });
    vi.mocked(getItemById).mockReturnValue(
      { id: 'item-1', space_id: 'p1', type: 'repo', name: 'api', fields: { repo_path: '/tmp/repo' }, page_blocks: [], created_at: 0, source_session_id: null },
    );

    const result = await runProjectQuery({ space_id: 'p1', item_id: 'item-1', question: 'where is auth handled?' }, 'u1');
    expect(result).toBe('auth.ts handles JWT verification');
  });

  it('builds the graph first if it does not exist', async () => {
    const { getSpaceForUser } = await import('../../src/db/index.js');
    const { getItemById } = await import('../../src/services/items.js');
    const { hasGraph, buildGraph } = await import('../../src/services/graphify.js');
    vi.mocked(getSpaceForUser).mockReturnValue({ id: 'p2', name: 'api', description: null, enabled_connection_ids: '[]' });
    vi.mocked(getItemById).mockReturnValue(
      { id: 'item-2', space_id: 'p2', type: 'repo', name: 'api', fields: { repo_path: '/tmp/repo2' }, page_blocks: [], created_at: 0, source_session_id: null },
    );
    vi.mocked(hasGraph).mockResolvedValueOnce(false);

    await runProjectQuery({ space_id: 'p2', item_id: 'item-2', question: 'what is this?' }, 'u1');
    expect(buildGraph).toHaveBeenCalledWith('/tmp/repo2', 'item-2', undefined);
  });
});
