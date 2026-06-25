import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs/promises';
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
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);

    const resultEvent = JSON.stringify({ type: 'result', result: 'fixed the bug', session_id: 'sess-123', total_cost_usd: 0.042 });
    proc.stdout.emit('data', Buffer.from(resultEvent + '\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result).toEqual({ result: 'fixed the bug', sessionId: 'sess-123', costUsd: 0.042 });
  });

  it('appends delegate framing on a fresh session but not when resuming', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toContain('full authority');
  });

  it('passes model override to the CLI', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug', model: 'opus' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('opus');
  });

  it('uses a minimal env by default and does not leak unrelated secrets', async () => {
    process.env.UNRELATED_SECRET = 'do-not-leak';
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const options = vi.mocked(spawn).mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.UNRELATED_SECRET).toBeUndefined();
    delete process.env.UNRELATED_SECRET;
  });

  it('omits the bypass permission flag in strict profile', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', permissionProfile: 'strict' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).not.toContain('--permission-mode');
  });

  it('passes MCP servers via a config file and separates the prompt from variadic options', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      {
        userId: 'u1',
        executionId: 'e1',
        repoPath: '/tmp/repo',
        mcpServers: { browser: { command: 'node', args: ['server.js'] } },
      }
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const mcpIdx = args.indexOf('--mcp-config');
    expect(mcpIdx).toBeGreaterThanOrEqual(0);
    expect(args[mcpIdx + 1]).toMatch(/mcp\.json$/);
    await expect(fs.readFile(args[mcpIdx + 1], 'utf-8')).resolves.toContain('"browser"');
    expect(args.slice(-2)).toEqual(['--', 'fix the login bug']);

    proc.emit('close', 0);
    await promise;
  });

  it('does not append framing when resuming a session', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'continue please' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', resumeSessionId: 'sess-123' }
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
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
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
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);
    proc.emit('error', new Error('spawn claude ENOENT'));

    await expect(promise).rejects.toThrow(/Claude Code CLI installed and on PATH/);
  });
});
