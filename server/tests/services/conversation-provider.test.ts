import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';

const DATA_DIR = process.env.DATA_DIR!;

const invokeClaudeCodeMock = vi.fn().mockResolvedValue({ result: 'done', sessionId: 'sess-1', costUsd: 0.001 });
vi.mock('../../src/tools/invoke_claude_code.js', () => ({ invokeClaudeCode: invokeClaudeCodeMock }));
vi.mock('../../src/services/executor.js', () => ({
  createExecution: vi.fn().mockReturnValue('exec-1'),
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
}));

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  getDb().prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u1','a@b.com','x')").run();
});

afterAll(() => closeDb());

describe('ClaudeCodeProvider', () => {
  it('invokes claude code and fires onText + onSessionId callbacks', async () => {
    const { ClaudeCodeProvider } = await import('../../src/services/conversation/claude-code-provider.js');
    const provider = new ClaudeCodeProvider({ mode: 'local', model: 'claude-sonnet-4-6', permissionProfile: 'default' });

    invokeClaudeCodeMock.mockImplementationOnce(async (_input, ctx) => {
      ctx.onText?.('Hello ');
      ctx.onText?.('world');
      ctx.onSessionId?.('sess-abc');
      return { result: 'done', sessionId: 'sess-abc', costUsd: 0.002 };
    });

    const textChunks: string[] = [];
    let capturedSessionId = '';
    await provider.invoke({
      prompt: 'say hi',
      onText: (t) => textChunks.push(t),
      onSessionId: (id) => { capturedSessionId = id; },
      mcpServers: {},
    });

    expect(textChunks).toEqual(['Hello ', 'world']);
    expect(capturedSessionId).toBe('sess-abc');
  });

  it('passes resumeSessionId when provided', async () => {
    const { ClaudeCodeProvider } = await import('../../src/services/conversation/claude-code-provider.js');
    const provider = new ClaudeCodeProvider({ mode: 'local', model: 'claude-sonnet-4-6', permissionProfile: 'default' });

    await provider.invoke({
      prompt: 'continue',
      resumeSessionId: 'prev-sess',
      onText: vi.fn(),
      onSessionId: vi.fn(),
      mcpServers: {},
    });

    const ctx = invokeClaudeCodeMock.mock.calls.at(-1)?.[1];
    expect(ctx.resumeSessionId).toBe('prev-sess');
  });
});

describe('getConversationProvider', () => {
  it('falls back to ClaudeCodeProvider when no connection configured', async () => {
    const { getConversationProvider } = await import('../../src/services/conversation-provider.js');
    const provider = getConversationProvider('u1');
    expect(provider.type).toBe('claude_code');
  });
});
