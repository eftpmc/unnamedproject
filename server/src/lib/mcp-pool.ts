import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

interface Pending {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface McpConn {
  proc: ChildProcess;
  pending: Map<number, Pending>;
  nextId: number;
  buf: string;
}

const pool = new Map<string, Promise<McpConn>>();

function createConn(command: string, args: string[], env: Record<string, string>): Promise<McpConn> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const conn: McpConn = { proc, pending: new Map(), nextId: 1, buf: '' };

    proc.stdout!.on('data', (chunk: Buffer) => {
      conn.buf += chunk.toString();
      let idx;
      while ((idx = conn.buf.indexOf('\n')) !== -1) {
        const line = conn.buf.slice(0, idx).trim();
        conn.buf = conn.buf.slice(idx + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(line); } catch { continue; }
        const id = msg.id as number | undefined;
        if (id !== undefined) {
          const p = conn.pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            conn.pending.delete(id);
            if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
            else p.resolve(JSON.stringify(msg.result ?? null));
          }
        }
      }
    });

    proc.on('close', () => {
      for (const p of conn.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('MCP server process exited'));
      }
      conn.pending.clear();
    });

    proc.on('error', (err) => reject(err));

    // MCP initialization handshake
    const initId = 0;
    const initTimer = setTimeout(() => {
      conn.pending.delete(initId);
      reject(new Error('MCP initialization timed out'));
    }, 15000);
    conn.pending.set(initId, {
      resolve: () => {
        clearTimeout(initTimer);
        proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }) + '\n');
        resolve(conn);
      },
      reject: (err) => { clearTimeout(initTimer); reject(err); },
      timer: initTimer,
    });
    proc.stdin!.write(JSON.stringify({
      jsonrpc: '2.0', id: initId, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'agent', version: '1.0' } },
    }) + '\n');
  });
}

function sendRequest(conn: McpConn, method: string, params: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = conn.nextId++;
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      reject(new Error('MCP request timed out after 30s'));
    }, 30000);
    conn.pending.set(id, { resolve, reject, timer });
    conn.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

export async function callMcpTool(
  connectionId: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<string> {
  let connPromise = pool.get(connectionId);
  if (!connPromise) {
    connPromise = createConn(command, args, env).catch(err => {
      pool.delete(connectionId);
      throw err;
    });
    pool.set(connectionId, connPromise);
  }
  const conn = await connPromise;
  try {
    return await sendRequest(conn, 'tools/call', { name: toolName, arguments: toolInput });
  } catch (err) {
    pool.delete(connectionId);
    throw err;
  }
}

export function closeMcpConnections(): void {
  for (const p of pool.values()) {
    p.then(c => c.proc.kill()).catch(() => {});
  }
  pool.clear();
}
