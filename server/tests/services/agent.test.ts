import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';

const DATA_DIR = process.env.DATA_DIR!;

const mockInvoke = vi.fn().mockImplementation(async (params) => {
  params.onText('Hello from provider');
  params.onSessionId('prov-sess-1');
  return { costUsd: 0.001 };
});

vi.mock('../../src/services/conversation-provider.js', () => ({
  getConversationProvider: vi.fn().mockResolvedValue({
    type: 'claude_code',
    invoke: mockInvoke,
    resolveModel: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
  }),
}));
vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));
vi.mock('../../src/services/executor.js', () => ({
  createExecution: vi.fn().mockReturnValue('exec-1'),
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));
vi.mock('../../src/mcp/auth.js', () => ({ generateMcpToken: vi.fn().mockReturnValue('mcp-tok') }));

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u1','a@b.com','x')").run();
  db.prepare("INSERT INTO sessions (id, user_id) VALUES ('s1','u1')").run();
  db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES ('m1','s1','user','hello')").run();
  db.prepare("INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES ('t1','s1','m1','running')").run();
});

afterAll(() => closeDb());

describe('runAgentTurn', () => {
  it('streams text delta and stores provider session id', async () => {
    const { broadcast } = await import('../../src/services/socket.js');
    const { runAgentTurn } = await import('../../src/services/agent.js');

    await runAgentTurn('u1', 's1', 'm1');

    const broadcastCalls = (broadcast as ReturnType<typeof vi.fn>).mock.calls;
    const deltaCall = broadcastCalls.find(([, msg]: [string, { type: string }]) => msg.type === 'message_delta');
    expect(deltaCall).toBeDefined();
    expect(deltaCall[1].delta).toBe('Hello from provider');

    const session = getDb().prepare('SELECT provider_session_id FROM sessions WHERE id = ?').get('s1') as { provider_session_id: string | null };
    expect(session.provider_session_id).toBe('prov-sess-1');
  });
});
