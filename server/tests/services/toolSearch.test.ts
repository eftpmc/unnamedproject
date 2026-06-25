import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/toolRegistry.js', () => ({
  getRegistrySearchPool: vi.fn(() => [
    { name: 'mcp_abc12345_create_pr', description: 'Create a GitHub pull request' },
  ]),
}));

describe('searchTools', () => {
  it('matches first-party tools by description keyword', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'retrieve memory entries');
    expect(results.map(r => r.name)).toContain('recall');
  });

  it('matches MCP registry tools by description keyword', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'github pull request');
    expect(results.map(r => r.name)).toContain('mcp_abc12345_create_pr');
  });

  it('never returns delegate_to_agent or tool_search', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'spawn a sub agent to search tools');
    expect(results.map(r => r.name)).not.toContain('delegate_to_agent');
    expect(results.map(r => r.name)).not.toContain('tool_search');
  });

  it('returns an empty array for a query matching nothing', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'zzz_no_such_capability_zzz');
    expect(results).toEqual([]);
  });

  it('caps results at the given limit', async () => {
    const { searchTools } = await import('../../src/services/toolSearch.js');
    const results = searchTools('user-1', 'project', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
