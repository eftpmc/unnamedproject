import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { runAgentTurn } from '../../src/services/agent.js';
import { newId } from '../../src/lib/ids.js';

const streamMock = vi.fn().mockImplementation(() => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const stream = {
    on: (event: string, cb: (...args: unknown[]) => void) => {
      (listeners[event] ??= []).push(cb);
      return stream;
    },
    finalMessage: async () => {
      for (const cb of listeners.text ?? []) cb('Hello! How can I help?');
      return {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
      };
    },
  };
  return stream;
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      stream: streamMock,
    },
  })),
}));

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));
vi.mock('../../src/services/executor.js', () => ({
  createExecution: vi.fn().mockReturnValue('exec-1'),
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));

const userId = newId();
let sessionId: string;
let messageId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const db = getDb();
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `agent-${userId}@test.com`, 'x');

  // Insert Anthropic connection (encrypted config)
  const { encrypt, deriveKey } = await import('../../src/lib/crypto.js');
  db.prepare('INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)')
    .run(newId(), userId, 'main', 'anthropic', encrypt(JSON.stringify({ apiKey: 'sk-test' }), deriveKey()));

  sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
  messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(messageId, sessionId, 'user', 'Hello');
});

describe('agent', () => {
  it('persists an assistant message', async () => {
    await runAgentTurn(userId, sessionId, messageId);
    const rows = getDb().prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'assistant'").all(sessionId) as { content: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].content).toBe('Hello! How can I help?');
  });

  it('uses a stable Anthropic messages payload', async () => {
    streamMock.mockClear();
    await runAgentTurn(userId, sessionId, messageId);

    const payload = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      max_tokens: 4096,
      messages: expect.any(Array),
      tools: expect.any(Array),
    });
    expect(payload).not.toHaveProperty('effort');
    expect(payload).not.toHaveProperty('thinking');
  });

  it('includes available projects and project tools in the system prompt', async () => {
    const db = getDb();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(newId(), userId, 'demo', 'Demo project', null, '[]');

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'hi');

    await runAgentTurn(userId, sessionId, msgId);

    const call = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    expect(call.system).toContain('Available projects');
    expect(call.system).toContain('demo');
    expect(call.tools.some((t: { name: string }) => t.name === 'create_project')).toBe(true);
    expect(call.tools.some((t: { name: string }) => t.name === 'delete_project')).toBe(true);
  });
});
