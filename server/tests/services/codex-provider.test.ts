import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, closeDb } from '../../src/db/index.js';

const DATA_DIR = process.env.DATA_DIR!;

const invokeCodexMock = vi.fn().mockResolvedValue({ result: 'done', sessionId: 'sess-1', costUsd: 0 });
vi.mock('../../src/tools/invoke_codex.js', () => ({ invokeCodex: invokeCodexMock }));
vi.mock('../../src/services/executor.js', () => ({
  createExecution: vi.fn().mockReturnValue('exec-1'),
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
}));

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
});

afterAll(() => closeDb());

describe('CodexProvider', () => {
  it('invokes codex and fires onText callback', async () => {
    const { CodexProvider } = await import('../../src/services/conversation/codex-provider.js');
    const provider = new CodexProvider({ model: 'codex-mini-latest', permissionProfile: 'default' });

    invokeCodexMock.mockImplementationOnce(async (_input, ctx) => {
      ctx.onText?.('codex says hi');
      ctx.onSessionId?.('thread-xyz');
      return { result: 'done', sessionId: 'thread-xyz', costUsd: 0 };
    });

    const chunks: string[] = [];
    let sessionId = '';
    await provider.invoke({
      prompt: 'hello',
      onText: (t) => chunks.push(t),
      onSessionId: (id) => { sessionId = id; },
      mcpServers: {},
    });

    expect(chunks).toEqual(['codex says hi']);
    expect(sessionId).toBe('thread-xyz');
  });
});
