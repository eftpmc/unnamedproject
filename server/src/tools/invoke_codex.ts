import { spawn } from 'child_process';
import { appendOutput, requestApproval } from '../services/executor.js';
import { registerProcess, unregisterProcess } from '../lib/process-registry.js';
import { DELEGATE_FRAMING } from './agent_framing.js';

interface CodexInput {
  prompt: string;
}

interface McpServerConfig { command: string; args?: string[]; env?: Record<string, string> }

interface ToolContext {
  userId: string;
  executionId: string;
  repoPath: string;
  apiKey: string | null;
  resumeSessionId?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface CodexResult {
  result: string;
  sessionId: string | null;
}

// codex exec has no --mcp-config flag (that's a Claude Code option) — MCP
// servers are passed as `-c mcp_servers.<name>.<field>=<toml value>` overrides.
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlInlineTable(obj: Record<string, string>): string {
  const entries = Object.entries(obj).map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`);
  return `{ ${entries.join(', ')} }`;
}

function mcpServerConfigOverrides(servers: Record<string, McpServerConfig>): string[] {
  const overrides: string[] = [];
  for (const [name, cfg] of Object.entries(servers)) {
    overrides.push(`-c`, `mcp_servers.${name}.command=${tomlString(cfg.command)}`);
    if (cfg.args && cfg.args.length > 0) {
      overrides.push(`-c`, `mcp_servers.${name}.args=${JSON.stringify(cfg.args)}`);
    }
    if (cfg.env && Object.keys(cfg.env).length > 0) {
      overrides.push(`-c`, `mcp_servers.${name}.env=${tomlInlineTable(cfg.env)}`);
    }
  }
  return overrides;
}

export async function invokeCodex(input: CodexInput, ctx: ToolContext): Promise<CodexResult> {
  await requestApproval(ctx.executionId, ctx.userId, 'invoke_codex', { prompt: input.prompt }, 'agent');

  // codex exec [resume <sessionId>] --dangerously-bypass-approvals-and-sandbox --json [--skip-git-repo-check] "<prompt>"
  const args = ['exec'];
  if (ctx.resumeSessionId) {
    args.push('resume', ctx.resumeSessionId);
  }
  args.push('--dangerously-bypass-approvals-and-sandbox', '--json');
  if (!ctx.resumeSessionId) args.push('--skip-git-repo-check');
  if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
    args.push(...mcpServerConfigOverrides(ctx.mcpServers));
  }
  // codex has no append-system-prompt equivalent — fold the framing into the prompt itself.
  const prompt = ctx.resumeSessionId ? input.prompt : `${DELEGATE_FRAMING}\n\n${input.prompt}`;
  args.push(prompt);

  return new Promise((resolve, reject) => {
    const proc = spawn('codex', args, {
      cwd: ctx.repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: ctx.apiKey ? { ...process.env, OPENAI_API_KEY: ctx.apiKey } : process.env,
    });

    registerProcess(ctx.executionId, proc);

    let buffer = '';
    let sessionId: string | null = null;
    let resultText = '';
    let stderrText = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(line); } catch { continue; }

        if (event.type === 'thread.started') sessionId = (event.thread_id as string) ?? sessionId;
        if (event.type === 'item.completed') {
          const item = event.item as { type?: string; text?: string } | undefined;
          if (item?.type === 'agent_message' && item.text) {
            resultText = item.text;
            appendOutput(ctx.executionId, ctx.userId, item.text + '\n');
          }
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString();
      appendOutput(ctx.executionId, ctx.userId, chunk.toString());
    });

    proc.on('error', err => {
      unregisterProcess(ctx.executionId);
      reject(new Error(`Failed to launch codex: ${err.message}. Is the Codex CLI installed and on PATH?`));
    });

    proc.on('close', code => {
      unregisterProcess(ctx.executionId);
      if (code === 0) resolve({ result: resultText.trim() || 'Done.', sessionId });
      else reject(new Error(`codex exited with code ${code}${stderrText.trim() ? `: ${stderrText.trim()}` : ''}`));
    });
  });
}
