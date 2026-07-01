import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Track stdout emitters so tests can push responses
const stdoutEmitters: EventEmitter[] = [];
const stdinWrites: string[][] = [];
const spawnOptions: Array<Record<string, unknown>> = [];
const spawnedProcesses: Array<{ kill: ReturnType<typeof vi.fn> }> = [];

vi.mock('child_process', () => ({
  spawn: vi.fn((_command: string, _args: string[], options: Record<string, unknown>) => {
    const stdout = new EventEmitter();
    const closeListeners: Array<() => void> = [];
    const writes: string[] = [];
    stdoutEmitters.push(stdout);
    stdinWrites.push(writes);
    spawnOptions.push(options);

    const proc = {
      stdout,
      stderr: new EventEmitter(),
      stdin: {
        write: (data: string) => {
          writes.push(data);
          const msg = JSON.parse(data.trim());
          // Auto-respond to initialize
          if (msg.method === 'initialize') {
            setTimeout(() => {
              stdout.emit('data', Buffer.from(
                JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05' } }) + '\n'
              ));
            }, 0);
          }
        },
      },
      on: (ev: string, cb: () => void) => {
        if (ev === 'close') closeListeners.push(cb);
      },
      kill: vi.fn(() => closeListeners.forEach(cb => cb())),
    };
    spawnedProcesses.push(proc);
    return proc;
  }),
}));

import { callMcpTool, listMcpTools, closeMcpConnection, closeMcpConnections } from '../../src/lib/mcp-pool.js';

afterEach(() => {
  closeMcpConnections();
  stdoutEmitters.length = 0;
  stdinWrites.length = 0;
  spawnOptions.length = 0;
  spawnedProcesses.length = 0;
});

describe('mcp-pool', () => {
  it('sends initialize handshake then tools/call and returns result', async () => {
    const callPromise = callMcpTool('conn-a', 'node', ['srv.js'], {}, 'echo', { msg: 'hi' });

    // Wait for init to complete (auto-responded above), then respond to tools/call
    await new Promise(r => setTimeout(r, 10));

    // Find the tools/call request id
    const calls = stdinWrites[0];
    const toolsCallMsg = calls.map(c => JSON.parse(c.trim())).find(m => m.method === 'tools/call');
    expect(toolsCallMsg).toBeDefined();
    expect(toolsCallMsg.params.name).toBe('echo');

    // Emit the tools/call response
    stdoutEmitters[0].emit('data', Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: toolsCallMsg.id, result: { content: [{ type: 'text', text: 'world' }] } }) + '\n'
    ));

    const result = await callPromise;
    expect(result).toContain('world');
  });

  it('rejects on MCP error response', async () => {
    const callPromise = callMcpTool('conn-b', 'node', ['srv.js'], {}, 'fail_tool', {});

    await new Promise(r => setTimeout(r, 10));

    const calls = stdinWrites[0];
    const toolsCallMsg = calls.map(c => JSON.parse(c.trim())).find(m => m.method === 'tools/call');

    stdoutEmitters[0].emit('data', Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: toolsCallMsg.id, error: { code: -32601, message: 'Method not found' } }) + '\n'
    ));

    await expect(callPromise).rejects.toThrow('Method not found');
  });

  it('sends initialized notification after init response', async () => {
    const callPromise = callMcpTool('conn-c', 'node', ['srv.js'], {}, 'ping', {});

    await new Promise(r => setTimeout(r, 10));

    const msgs = stdinWrites[0].map(c => JSON.parse(c.trim()));
    const initNotif = msgs.find(m => m.method === 'initialized' && m.id === undefined);
    expect(initNotif).toBeDefined();

    // Complete the call to avoid hanging
    const toolsCallMsg = msgs.find(m => m.method === 'tools/call');
    stdoutEmitters[0].emit('data', Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: toolsCallMsg.id, result: {} }) + '\n'
    ));
    await callPromise;
  });

  it('reuses connection for subsequent calls on same connectionId', async () => {
    const { spawn } = await import('child_process');

    const p1 = callMcpTool('conn-d', 'node', ['srv.js'], {}, 'tool1', {});
    await new Promise(r => setTimeout(r, 10));

    const t1 = stdinWrites[0].map(c => JSON.parse(c.trim())).find(m => m.method === 'tools/call');
    stdoutEmitters[0].emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: t1.id, result: { x: 1 } }) + '\n'));
    await p1;

    const callsBefore = (spawn as ReturnType<typeof vi.fn>).mock.calls.length;

    const p2 = callMcpTool('conn-d', 'node', ['srv.js'], {}, 'tool2', {});
    await new Promise(r => setTimeout(r, 10));

    // spawn should NOT have been called again
    expect((spawn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);

    const t2 = stdinWrites[0].map(c => JSON.parse(c.trim())).find(m => m.method === 'tools/call' && m.params.name === 'tool2');
    stdoutEmitters[0].emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: t2.id, result: { x: 2 } }) + '\n'));
    await p2;
  });

  it('includes inputSchema in returned tool info', async () => {
    const toolsPromise = listMcpTools('conn-e', 'node', ['srv.js'], {});

    await new Promise(r => setTimeout(r, 10));

    const toolsListMsg = stdinWrites[0].map(c => JSON.parse(c.trim())).find(m => m.method === 'tools/list');
    expect(toolsListMsg).toBeDefined();

    stdoutEmitters[0].emit('data', Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: toolsListMsg.id,
      result: { tools: [{ name: 'create_pr', description: 'Create a PR', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }] },
    }) + '\n'));

    const tools = await toolsPromise;
    expect(tools[0].name).toBe('create_pr');
    expect(tools[0].description).toBe('Create a PR');
    expect(tools[0].inputSchema).toEqual({ type: 'object', properties: { title: { type: 'string' } } });
  });

  it('defaults inputSchema to an empty object schema when missing', async () => {
    const toolsPromise = listMcpTools('conn-f', 'node', ['srv.js'], {});

    await new Promise(r => setTimeout(r, 10));

    const toolsListMsg = stdinWrites[0].map(c => JSON.parse(c.trim())).find(m => m.method === 'tools/list');

    stdoutEmitters[0].emit('data', Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: toolsListMsg.id,
      result: { tools: [{ name: 'no_schema_tool' }] },
    }) + '\n'));

    const tools = await toolsPromise;
    expect(tools[0].inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('does not leak unrelated process env into MCP child processes', async () => {
    process.env.UNRELATED_SECRET = 'do-not-leak';
    const toolsPromise = listMcpTools('conn-g', 'node', ['srv.js'], { EXPLICIT_TOKEN: 'ok' }, '/tmp/mcp-cwd');

    await new Promise(r => setTimeout(r, 10));

    expect(spawnOptions[0].cwd).toBe('/tmp/mcp-cwd');
    const env = spawnOptions[0].env as NodeJS.ProcessEnv;
    expect(env.EXPLICIT_TOKEN).toBe('ok');
    expect(env.UNRELATED_SECRET).toBeUndefined();

    const toolsListMsg = stdinWrites[0].map(c => JSON.parse(c.trim())).find(m => m.method === 'tools/list');
    stdoutEmitters[0].emit('data', Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: toolsListMsg.id,
      result: { tools: [] },
    }) + '\n'));
    await toolsPromise;
    delete process.env.UNRELATED_SECRET;
  });

  it('can close a single pooled connection without clearing others', async () => {
    const p1 = listMcpTools('conn-h1', 'node', ['srv.js'], {});
    const p2 = listMcpTools('conn-h2', 'node', ['srv.js'], {});
    await new Promise(r => setTimeout(r, 10));

    for (const writes of stdinWrites) {
      const toolsListMsg = writes.map(c => JSON.parse(c.trim())).find(m => m.method === 'tools/list');
      const emitter = stdoutEmitters[stdinWrites.indexOf(writes)];
      emitter.emit('data', Buffer.from(JSON.stringify({
        jsonrpc: '2.0', id: toolsListMsg.id,
        result: { tools: [] },
      }) + '\n'));
    }

    await Promise.all([p1, p2]);
    closeMcpConnection('conn-h1');

    await vi.waitFor(() => expect(spawnedProcesses[0].kill).toHaveBeenCalledTimes(1));
    expect(spawnedProcesses[1].kill).not.toHaveBeenCalled();

    const p3 = listMcpTools('conn-h2', 'node', ['srv.js'], {});
    await new Promise(r => setTimeout(r, 10));
    const secondConnWrites = stdinWrites[1];
    const toolsListMsg = secondConnWrites.map(c => JSON.parse(c.trim())).filter(m => m.method === 'tools/list').at(-1);
    stdoutEmitters[1].emit('data', Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: toolsListMsg.id,
      result: { tools: [] },
    }) + '\n'));
    await p3;
    expect(spawnedProcesses).toHaveLength(2);
  });
});
