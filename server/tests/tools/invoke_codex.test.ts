import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { invokeCodex } from '../../src/tools/invoke_codex.js';

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

describe('invoke_codex', () => {
  it('returns parsed result and session id on success', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeCodex(
      { prompt: 'fix the login bug' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }) + '\n'));
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'fixed the bug' } }) + '\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result).toEqual({ result: 'fixed the bug', sessionId: 'thread-123', costUsd: 0 });
  });

  it('passes model override to the CLI', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeCodex(
      { prompt: 'do the thing', model: 'gpt-5' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const idx = args.indexOf('-m');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('gpt-5');
  });

  it('uses a minimal env by default and does not leak unrelated secrets', async () => {
    process.env.UNRELATED_SECRET = 'do-not-leak';
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeCodex(
      { prompt: 'do the thing' },
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

    const promise = invokeCodex(
      { prompt: 'do the thing' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', permissionProfile: 'strict' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('passes mcp servers as -c overrides, not the unsupported --mcp-config flag', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeCodex(
      { prompt: 'do the thing' },
      {
        userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo',
        mcpServers: { myserver: { command: 'npx', args: ['-y', 'some-pkg'], env: { TOKEN: 'abc' } } },
      }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).not.toContain('--mcp-config');
    expect(args).toContain('mcp_servers.myserver.command="npx"');
    expect(args).toContain('mcp_servers.myserver.args=["-y","some-pkg"]');
    expect(args).toContain('mcp_servers.myserver.env={ "TOKEN" = "abc" }');
  });

  it('passes HTTP MCP auth headers using Codex config.toml http_headers', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeCodex(
      { prompt: 'use gmail' },
      {
        userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo',
        mcpServers: { app: { url: 'http://localhost:3000/mcp', headers: { Authorization: 'Bearer mcp-token' } } },
      }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('mcp_servers.app.url="http://localhost:3000/mcp"');
    expect(args).toContain('mcp_servers.app.http_headers={ "Authorization" = "Bearer mcp-token" }');
    expect(args).not.toContain('mcp_servers.app.headers={ "Authorization" = "Bearer mcp-token" }');
    expect(args).not.toContain('mcp_servers.app.type="http"');
  });

  it('prepends delegate framing to the prompt for a fresh session', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeCodex(
      { prompt: 'do the thing' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const prompt = args[args.length - 1];
    expect(prompt).toContain('full authority');
    expect(prompt).toContain('do the thing');
  });

  it('does not re-inject framing when resuming a session', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeCodex(
      { prompt: 'continue please' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo', resumeSessionId: 'thread-123' }
    );
    await new Promise(setImmediate);
    proc.emit('close', 0);
    await promise;

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const prompt = args[args.length - 1];
    expect(prompt).toBe('continue please');
  });

  it('includes stderr output in the rejection on non-zero exit', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeCodex(
      { prompt: 'do the thing' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);
    proc.stderr.emit('data', Buffer.from('boom: something went wrong'));
    proc.emit('close', 1);

    await expect(promise).rejects.toThrow(/boom: something went wrong/);
  });

  it('rejects with a helpful message when the codex binary is missing', async () => {
    const proc = makeProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const promise = invokeCodex(
      { prompt: 'do the thing' },
      { userId: 'u1', executionId: 'e1', repoPath: '/tmp/repo' }
    );
    await new Promise(setImmediate);
    proc.emit('error', new Error('spawn codex ENOENT'));

    await expect(promise).rejects.toThrow(/Codex CLI installed and on PATH/);
  });
});
