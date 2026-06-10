import { spawn } from 'child_process';

interface McpInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface ToolContext {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function callMcp(input: McpInput, ctx: ToolContext): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ctx.command, ctx.args ?? [], {
      env: { ...process.env, ...ctx.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: input.tool_name, arguments: input.tool_input },
    });

    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => console.error('[mcp]', d.toString()));

    proc.on('close', () => {
      try {
        const lines = out.trim().split('\n');
        for (const line of lines) {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            resolve(JSON.stringify(msg.result));
            return;
          }
        }
        resolve(out.trim());
      } catch {
        resolve(out.trim());
      }
    });

    proc.stdin.write(request + '\n');
    proc.stdin.end();
  });
}
