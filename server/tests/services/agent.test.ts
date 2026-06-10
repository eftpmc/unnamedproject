import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { runAgentTurn } from '../../src/services/agent.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
      }),
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
let threadId: string;
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

  threadId = newId();
  db.prepare('INSERT INTO threads (id, user_id) VALUES (?,?)').run(threadId, userId);
  messageId = newId();
  db.prepare('INSERT INTO messages (id, thread_id, role, content) VALUES (?,?,?,?)').run(messageId, threadId, 'user', 'Hello');
});

describe('agent', () => {
  it('returns an assistant message string', async () => {
    const reply = await runAgentTurn(userId, threadId, messageId);
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });
});
