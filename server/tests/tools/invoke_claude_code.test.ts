import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { invokeClaudeCode } from '../../src/tools/invoke_claude_code.js';

function makeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../src/services/executor.js', () => ({ appendOutput: vi.fn(), requestApproval: vi.fn().mockResolvedValue({ decision: 'approved' }) }));
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

  it('omits the bypass permission flag outside self-modification mode', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', permissionProfile: 'trusted' }
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).not.toContain('--permission-mode');
  });

  it('uses bypass permissions only for self-modification mode', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', permissionProfile: 'self_modify' }
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--permission-mode');
    expect(args).toContain('bypassPermissions');
  });

  it('sets a git ceiling outside self-modification mode', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', permissionProfile: 'fast' }
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.emit('close', 0);
    await promise;

    const options = vi.mocked(spawn).mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.GIT_CEILING_DIRECTORIES?.split(path.delimiter)).toContain('/tmp/repo');
  });

  it('uses an isolated home and temp directory in strict profile', async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'strict-claude-'));
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath, permissionProfile: 'strict' }
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.emit('close', 0);
    await promise;

    const options = vi.mocked(spawn).mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.HOME).toBe(path.join(repoPath, '.unnamed', 'delegate-runtime', 'home'));
    expect(options.env.TMPDIR).toBe(path.join(repoPath, '.unnamed', 'delegate-runtime', 'tmp'));
    expect(options.env.XDG_CONFIG_HOME).toBe(path.join(repoPath, '.unnamed', 'delegate-runtime', 'home', '.config'));
  });

  it('passes only the configured provider API key into the delegate env', async () => {
    process.env.UNRELATED_SECRET = 'do-not-leak';
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', apiKey: 'sk-ant-test' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const options = vi.mocked(spawn).mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(options.env.UNRELATED_SECRET).toBeUndefined();
    delete process.env.UNRELATED_SECRET;
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

  it('allows built-in tools and leaves MCP tool access to the server', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'run the daily scan' },
      {
        userId: 'u1',
        executionId: 'e1',
        repoPath: '/tmp/repo',
        mcpServers: { app: { url: 'http://localhost:3000/mcp', headers: { Authorization: 'Bearer token' } } },
      }
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const allowedIdx = args.indexOf('--allowedTools');
    expect(allowedIdx).toBeGreaterThanOrEqual(0);
    const allowedTools = args[allowedIdx + 1].split(',');
    expect(allowedTools).toEqual(expect.arrayContaining(['Read', 'WebFetch', 'WebSearch', 'Bash(ls *)']));
    expect(allowedTools).toContain('mcp__app__*');

    proc.emit('close', 0);
    await promise;
  });

  it('adds external project backing directories to Claude allowed dirs', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeClaudeCode(
      { prompt: 'inspect project files' },
      {
        userId: 'u1',
        executionId: 'e1',
        repoPath: '/tmp/session-workspace',
        allowedDirs: ['/tmp/project-files', '/tmp/project-worktree', '/tmp/project-files'],
      }
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const addDirIdx = args.indexOf('--add-dir');
    expect(addDirIdx).toBeGreaterThanOrEqual(0);
    expect(args.slice(addDirIdx + 1, addDirIdx + 3)).toEqual(['/tmp/project-files', '/tmp/project-worktree']);

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

  it('kills the subprocess when the AbortSignal fires', async () => {
    const proc = makeProc();
    proc.kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const controller = new AbortController();
    const promise = invokeClaudeCode(
      { prompt: 'long task' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', signal: controller.signal }
    );
    await new Promise(setImmediate);

    controller.abort();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    proc.emit('close', 0);
    await promise.catch(() => {});
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
