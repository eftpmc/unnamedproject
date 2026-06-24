import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('../../src/services/executor.js', () => ({
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));

const { createConnectionTool } = await import('../../src/tools/connection_ops.js');
const { requestApproval } = await import('../../src/services/executor.js');

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `conn-${userId}@test.com`, 'x');
});

describe('createConnectionTool', () => {
  it('masks the secret before sending it to requestApproval', async () => {
    vi.mocked(requestApproval).mockClear();
    await createConnectionTool(
      { name: 'My GitHub', type: 'github', purpose: 'github', config: { apiKey: 'ghp_supersecrettoken1234' } },
      { userId, executionId: 'e1' },
    );
    const [, , , payload] = vi.mocked(requestApproval).mock.calls[0];
    expect((payload as Record<string, unknown>).config).toMatchObject({ apiKey: expect.stringContaining('1234') });
    expect(JSON.stringify(payload)).not.toContain('ghp_supersecrettoken1234');
  });

  it('always requests approval at user tier, regardless of permission profile', async () => {
    vi.mocked(requestApproval).mockClear();
    await createConnectionTool(
      { name: 'My Key', type: 'anthropic', purpose: 'lead_agent', config: { apiKey: 'sk-ant-abc123' } },
      { userId, executionId: 'e2' },
    );
    expect(requestApproval).toHaveBeenCalledWith('e2', userId, 'create_connection', expect.anything(), 'user');
  });

  it('persists the connection once approved', async () => {
    vi.mocked(requestApproval).mockResolvedValueOnce('approved');
    const result = await createConnectionTool(
      { name: 'My MCP', type: 'mcp', purpose: 'mcp', config: { command: 'npx', args: ['-y', 'foo'] } },
      { userId, executionId: 'e3' },
    );
    const parsed = JSON.parse(result) as { id: string; type: string; purpose: string };
    expect(parsed.type).toBe('mcp');
    const row = getDb().prepare('SELECT name FROM connections WHERE id = ?').get(parsed.id);
    expect(row).toMatchObject({ name: 'My MCP' });
  });

  it('does not create a connection when the user rejects', async () => {
    vi.mocked(requestApproval).mockResolvedValueOnce('rejected');
    const before = (getDb().prepare('SELECT COUNT(*) as c FROM connections WHERE user_id = ?').get(userId) as { c: number }).c;
    const result = await createConnectionTool(
      { name: 'Denied Conn', type: 'github', purpose: 'github', config: { apiKey: 'ghp_shouldnotpersist' } },
      { userId, executionId: 'e4' },
    );
    expect(result).toBe('create_connection cancelled');
    const after = (getDb().prepare('SELECT COUNT(*) as c FROM connections WHERE user_id = ?').get(userId) as { c: number }).c;
    expect(after).toBe(before);
  });

  it('surfaces validation errors from createConnectionRecord', async () => {
    vi.mocked(requestApproval).mockResolvedValueOnce('approved');
    const result = await createConnectionTool(
      { name: 'Bad', type: 'bogus-type', purpose: 'tool', config: { apiKey: 'x' } },
      { userId, executionId: 'e5' },
    );
    expect(result).toContain('Error:');
  });
});
