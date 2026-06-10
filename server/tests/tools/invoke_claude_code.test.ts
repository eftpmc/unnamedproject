import { describe, it, expect, vi } from 'vitest';
import { invokeClaudeCode } from '../../src/tools/invoke_claude_code.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn((ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') cb(Buffer.from('fixed the bug')); }) },
    stderr: { on: vi.fn() },
    on: vi.fn((ev: string, cb: (code: number) => void) => { if (ev === 'close') cb(0); }),
  })),
}));

vi.mock('../../src/services/executor.js', () => ({ appendOutput: vi.fn() }));

describe('invoke_claude_code', () => {
  it('returns stdout output on success', async () => {
    const result = await invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', apiKey: 'sk-test' }
    );
    expect(result).toBe('fixed the bug');
  });
});
