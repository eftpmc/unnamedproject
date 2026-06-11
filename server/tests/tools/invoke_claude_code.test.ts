import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { invokeClaudeCode } from '../../src/tools/invoke_claude_code.js';

function makeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../src/services/executor.js', () => ({ appendOutput: vi.fn(), requestApproval: vi.fn().mockResolvedValue('approved') }));
vi.mock('../../src/lib/process-registry.js', () => ({ registerProcess: vi.fn(), unregisterProcess: vi.fn() }));

beforeEach(() => {
  vi.mocked(spawn).mockReset();
});

describe('invoke_claude_code', () => {
  it('returns parsed result and session id from stream-json result event', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', apiKey: 'sk-test' }
    );
    await new Promise(setImmediate);

    const resultEvent = JSON.stringify({ type: 'result', result: 'fixed the bug', session_id: 'sess-123' });
    proc.stdout.emit('data', Buffer.from(resultEvent + '\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result).toEqual({ result: 'fixed the bug', sessionId: 'sess-123' });
  });

  it('appends delegate framing on a fresh session but not when resuming', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', apiKey: 'sk-test' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toContain('full authority');
  });

  it('does not append framing when resuming a session', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'continue please' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', apiKey: 'sk-test', resumeSessionId: 'sess-123' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).not.toContain('--append-system-prompt');
  });

  it('includes stderr output in the rejection on non-zero exit with no result', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', apiKey: 'sk-test' }
    );
    await new Promise(setImmediate);
    proc.stderr.emit('data', Buffer.from('boom: auth error'));
    proc.emit('close', 1);

    await expect(promise).rejects.toThrow(/boom: auth error/);
  });

  it('rejects with a helpful message when the claude binary is missing', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', apiKey: 'sk-test' }
    );
    await new Promise(setImmediate);
    proc.emit('error', new Error('spawn claude ENOENT'));

    await expect(promise).rejects.toThrow(/Claude Code CLI installed and on PATH/);
  });
});
